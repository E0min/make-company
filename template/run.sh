#!/usr/bin/env bash
# 가상 회사 시작 — config.json 기반 동적 에이전트 생성
set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

if [ ! -f "$CONFIG" ]; then
  echo "  config.json 없음: $CONFIG"
  exit 1
fi

# config.json 검증 및 파싱
_config_vals=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        config = json.load(f)
    for key in ['session_name', 'project', 'agents']:
        if key not in config:
            print('ERROR: config.json에 필수 키 없음: ' + key, file=sys.stderr)
            sys.exit(1)
    if not isinstance(config['agents'], list) or len(config['agents']) == 0:
        print('ERROR: agents 배열이 비어있습니다', file=sys.stderr)
        sys.exit(1)
    for i, a in enumerate(config['agents']):
        for k in ['id', 'engine', 'label']:
            if k not in a:
                print(f'ERROR: agent[{i}]에 필수 키 없음: {k}', file=sys.stderr)
                sys.exit(1)
    print(config['session_name'])
    print(config['project'])
    print(str(len(config['agents'])))
except json.JSONDecodeError as e:
    print(f'ERROR: config.json 파싱 오류: {e}', file=sys.stderr)
    sys.exit(1)
" "$CONFIG") || exit 1

SESSION=$(echo "$_config_vals" | sed -n '1p')
PROJECT=$(echo "$_config_vals" | sed -n '2p')
AGENT_COUNT=$(echo "$_config_vals" | sed -n '3p')

echo ""
echo "  $PROJECT 가상 회사 시작 ($AGENT_COUNT 에이전트)"
echo ""

# 런타임 디렉토리 초기화
mkdir -p "$COMPANY_DIR"/{inbox,outbox,channel,logs,state,scripts,state/tasks}

# 로그 회전: 1MB 초과 시 .archive로 이동
mkdir -p "$COMPANY_DIR/.archive"
for log in "$COMPANY_DIR/channel/general.md" "$COMPANY_DIR/logs/router.log"; do
  if [ -f "$log" ] && [ "$(wc -c < "$log" 2>/dev/null | tr -d ' ')" -gt 1048576 ]; then
    mv "$log" "$COMPANY_DIR/.archive/$(basename "$log").$(date +%s)"
    echo "  로그 회전: $(basename "$log")"
  fi
done

# 에이전트 ID 목록 추출
AGENT_IDS=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    print(a['id'])
" "$CONFIG")

> "$COMPANY_DIR/channel/general.md"
for agent_id in $AGENT_IDS; do
  > "$COMPANY_DIR/inbox/${agent_id}.md"
  > "$COMPANY_DIR/outbox/${agent_id}.md"
  > "$COMPANY_DIR/state/${agent_id}.state"
  # 페르소나 사칭 방지: 소유자만 읽기/쓰기
  chmod 600 "$COMPANY_DIR/inbox/${agent_id}.md" "$COMPANY_DIR/outbox/${agent_id}.md" 2>/dev/null
done

# cost.json 초기화 (Cost Guardrail)
echo '{}' > "$COMPANY_DIR/state/cost.json"
chmod 600 "$COMPANY_DIR/state/cost.json" 2>/dev/null

# 잔류 lock 디렉토리 정리
find "$COMPANY_DIR/inbox" "$COMPANY_DIR/outbox" "$COMPANY_DIR/state" -type d -name "*.lock.d" -exec rmdir {} + 2>/dev/null

# 잔류 restart_count 초기화
rm -f "$COMPANY_DIR/state/restart_count_"* 2>/dev/null

# crash 후 잔류한 .processing 파일 정리 (메시지 유실 방지)
for f in "$COMPANY_DIR"/inbox/*.processing.* "$COMPANY_DIR"/outbox/*.processing.*; do
  if [ -f "$f" ]; then
    echo "  경고: 잔류 .processing 파일 정리: $(basename "$f")"
    rm -f "$f"
  fi
done

# 스크립트 실행 권한
chmod +x "$COMPANY_DIR/router.sh" "$COMPANY_DIR/monitor.sh" "$COMPANY_DIR/kickoff.sh" "$COMPANY_DIR/stop.sh" 2>/dev/null
chmod +x "$COMPANY_DIR/agents/run-agent.sh" "$COMPANY_DIR/agents/run-gemini.sh" 2>/dev/null
chmod +x "$COMPANY_DIR/scripts/"*.sh 2>/dev/null

# 스킬 인덱스 사전 빌드
bash "$COMPANY_DIR/scripts/build-skill-index.sh" 2>/dev/null || true

# knowledge/ 디렉토리 초기화 + INDEX 생성
mkdir -p "$COMPANY_DIR/knowledge/decisions" "$COMPANY_DIR/knowledge/conventions"
if [ ! -f "$COMPANY_DIR/knowledge/README.md" ] && [ -f "$COMPANY_DIR/knowledge-init/README.md" ]; then
  cp "$COMPANY_DIR/knowledge-init/README.md" "$COMPANY_DIR/knowledge/README.md"
fi
bash "$COMPANY_DIR/scripts/update-knowledge-index.sh" "$COMPANY_DIR/knowledge" 2>/dev/null || true

# 기존 세션 종료
tmux kill-session -t "$SESSION" 2>/dev/null || true

# 새 tmux 세션 (윈도우 0: 모니터)
tmux new-session -d -s "$SESSION" -n "Monitor" -x 200 -y 55

# 에이전트 윈도우 동적 생성 (temp file로 subshell 문제 회피, bash 3.x 호환)
_agent_list="$COMPANY_DIR/.tmp_agents_$$"
trap 'rm -f "$_agent_list"' EXIT
python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    print(f\"{a['id']}|{a['engine']}|{a['label']}\")
" "$CONFIG" > "$_agent_list"

win_idx=0
while IFS='|' read -r agent_id engine label; do
  win_idx=$((win_idx + 1))
  tmux new-window -t "$SESSION" -n "$label"

  if [ "$engine" = "gemini" ]; then
    tmux send-keys -t "${SESSION}:${win_idx}" \
      "bash '${COMPANY_DIR}/agents/run-gemini.sh'" Enter
  else
    tmux send-keys -t "${SESSION}:${win_idx}" \
      "bash '${COMPANY_DIR}/agents/run-agent.sh' '${agent_id}'" Enter
  fi
done < "$_agent_list"
rm -f "$_agent_list"

# 라우터 윈도우 (마지막 에이전트 + 1)
router_win=$((win_idx + 1))
tmux new-window -t "$SESSION" -n "Router"
tmux send-keys -t "${SESSION}:${router_win}" \
  "bash '${COMPANY_DIR}/router.sh'" Enter

# DAG 스케줄러 윈도우 (라우터 + 1)
if [ -f "$COMPANY_DIR/dag-scheduler.sh" ]; then
  dag_win=$((router_win + 1))
  tmux new-window -t "$SESSION" -n "DAG"
  tmux send-keys -t "${SESSION}:${dag_win}" \
    "bash '${COMPANY_DIR}/dag-scheduler.sh'" Enter
fi

# Dashboard 윈도우 (DAG + 1) — supervisor 패턴 (죽으면 자동 재시작)
if [ -f "$COMPANY_DIR/dashboard/server.py" ]; then
  dash_win=$((dag_win + 1))
  tmux new-window -t "$SESSION" -n "Dashboard"
  tmux send-keys -t "${SESSION}:${dash_win}" \
    "while true; do python3 '${COMPANY_DIR}/dashboard/server.py' || sleep 5; done" Enter
fi

# 모니터 실행 (윈도우 0)
tmux send-keys -t "${SESSION}:0" \
  "bash '${COMPANY_DIR}/monitor.sh'" Enter

echo "  회사 시작 완료"
echo ""
echo "  접속:    tmux attach -t $SESSION"
echo "  태스크:  bash .claude/company/kickoff.sh '요청'"
echo "  종료:    bash .claude/company/stop.sh"
echo ""
