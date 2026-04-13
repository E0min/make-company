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
    print(str(config.get('lazy_spawn', False)))
    print(str(config.get('max_concurrent_agents', 4)))
except json.JSONDecodeError as e:
    print(f'ERROR: config.json 파싱 오류: {e}', file=sys.stderr)
    sys.exit(1)
" "$CONFIG") || exit 1

SESSION=$(echo "$_config_vals" | sed -n '1p')
PROJECT=$(echo "$_config_vals" | sed -n '2p')
AGENT_COUNT=$(echo "$_config_vals" | sed -n '3p')
LAZY_SPAWN=$(echo "$_config_vals" | sed -n '4p')
MAX_CONCURRENT=$(echo "$_config_vals" | sed -n '5p')

echo ""
if [ "$LAZY_SPAWN" = "True" ]; then
  echo "  $PROJECT 가상 회사 시작 ($AGENT_COUNT 에이전트, lazy spawn: max $MAX_CONCURRENT 동시)"
else
  echo "  $PROJECT 가상 회사 시작 ($AGENT_COUNT 에이전트)"
fi
echo ""

# 버전 업데이트 체크 (백그라운드, 비차단)
_version_file="$COMPANY_DIR/.version"
if [ -f "$_version_file" ]; then
  (
    _current=$(cat "$_version_file" 2>/dev/null)
    _latest=$(git ls-remote --heads https://github.com/leeyoungmin/virtual-company.git main 2>/dev/null | cut -c1-7)
    if [ -n "$_latest" ] && [ "$_current" != "$_latest" ] && [ "$_current" != "unknown" ]; then
      echo ""
      echo "  ⚡ 새 버전 사용 가능: $_current → $_latest"
      echo "     bash .claude/company/update.sh"
      echo ""
    fi
  ) &
fi

# 런타임 디렉토리 초기화
mkdir -p "$COMPANY_DIR"/{inbox,outbox,channel,logs,state,scripts,state/tasks,state/tickets,state/workflows}

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
chmod +x "$COMPANY_DIR/router.sh" "$COMPANY_DIR/monitor.sh" "$COMPANY_DIR/kickoff.sh" "$COMPANY_DIR/stop.sh" "$COMPANY_DIR/spawn-manager.sh" 2>/dev/null
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

# 팀 디렉토리 + CLAUDE.md + .claude/rules/ 초기화
_project_dir="$(cd "$COMPANY_DIR/../.." && pwd)"
python3 -c "
import json, sys, os

config = json.load(open(sys.argv[1]))
teams = config.get('teams', {})
project_dir = sys.argv[2]

# 프로젝트 루트 .claude/rules/teams/ 디렉토리 (paths 기반 팀별 룰)
rules_dir = os.path.join(project_dir, '.claude', 'rules', 'teams')
os.makedirs(rules_dir, exist_ok=True)

for team_id, team_info in teams.items():
    label = team_info.get('label', team_id)
    desc = team_info.get('description', '')

    # 1. teams/{team}/docs/ 디렉토리
    team_dir = os.path.join(project_dir, 'teams', team_id)
    os.makedirs(os.path.join(team_dir, 'docs'), exist_ok=True)

    # 2. teams/{team}/CLAUDE.md — 팀 컨텍스트 (계층적 로드)
    claude_md = os.path.join(team_dir, 'CLAUDE.md')
    if not os.path.exists(claude_md):
        with open(claude_md, 'w') as f:
            f.write(f'# {label}\n\n')
            if desc:
                f.write(f'{desc}\n\n')
            f.write('## 팀 컨텍스트\n\n')
            f.write('<!-- 이 팀의 기술 스택, 아키텍처, 공유 문서를 여기에 정의하세요 -->\n')
            f.write('<!-- 이 파일은 팀 에이전트가 작업 시 자동 로드됩니다 -->\n')
        print(f'  팀 CLAUDE.md 생성: teams/{team_id}/CLAUDE.md')

    # 3. .claude/rules/teams/{team}.md — 팀 전용 룰 (paths 스코핑)
    rule_file = os.path.join(rules_dir, f'{team_id}.md')
    if not os.path.exists(rule_file):
        with open(rule_file, 'w') as f:
            f.write('---\n')
            f.write(f'paths:\n')
            f.write(f'  - \"teams/{team_id}/**\"\n')
            f.write('---\n\n')
            f.write(f'# {label} 규칙\n\n')
            if desc:
                f.write(f'{desc}\n\n')
            f.write('<!-- 이 규칙은 에이전트가 teams/' + team_id + '/ 파일을 읽을 때만 로드됩니다 -->\n')
            f.write('<!-- 팀 컨벤션, 코딩 스타일, 워크플로우 규칙을 여기에 정의하세요 -->\n')
        print(f'  팀 룰 생성: .claude/rules/teams/{team_id}.md')
" "$CONFIG" "$_project_dir" 2>/dev/null || true

# 기존 세션 종료
tmux kill-session -t "$SESSION" 2>/dev/null || true

# 새 tmux 세션 (윈도우 0: 모니터)
tmux new-session -d -s "$SESSION" -n "Monitor" -x 200 -y 55

# 에이전트 윈도우 동적 생성 (temp file로 subshell 문제 회피, bash 3.x 호환)
_agent_list="$COMPANY_DIR/.tmp_agents_$$"
trap 'rm -f "$_agent_list"' EXIT

if [ "$LAZY_SPAWN" = "True" ]; then
  # lazy spawn: protected 에이전트만 즉시 시작
  python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    if a.get('protected', False):
        print(f\"{a['id']}|{a['engine']}|{a['label']}\")
" "$CONFIG" > "$_agent_list"
else
  # 기존 방식: 모든 에이전트 즉시 시작
  python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    print(f\"{a['id']}|{a['engine']}|{a['label']}\")
" "$CONFIG" > "$_agent_list"
fi

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

# lazy spawn 런타임 디렉토리 초기화
if [ "$LAZY_SPAWN" = "True" ]; then
  mkdir -p "$COMPANY_DIR/state/spawn"
  rm -f "$COMPANY_DIR/state/spawn"/*.win "$COMPANY_DIR/state/spawn/queue" 2>/dev/null
fi

# 라우터 윈도우 (마지막 에이전트 + 1)
router_win=$((win_idx + 1))
tmux new-window -t "$SESSION" -n "Router"
tmux send-keys -t "${SESSION}:${router_win}" \
  "bash '${COMPANY_DIR}/router.sh'" Enter

# Spawn Manager 윈도우 (lazy spawn 활성화 시)
next_win=$((router_win + 1))
if [ "$LAZY_SPAWN" = "True" ]; then
  tmux new-window -t "$SESSION" -n "Spawner"
  tmux send-keys -t "${SESSION}:${next_win}" \
    "bash '${COMPANY_DIR}/spawn-manager.sh'" Enter
  next_win=$((next_win + 1))
fi

# DAG 스케줄러 윈도우
dag_win=$next_win
if [ -f "$COMPANY_DIR/dag-scheduler.sh" ]; then
  tmux new-window -t "$SESSION" -n "DAG"
  tmux send-keys -t "${SESSION}:${dag_win}" \
    "bash '${COMPANY_DIR}/dag-scheduler.sh'" Enter
fi

# Dashboard 윈도우 (DAG + 1) — supervisor 패턴 (죽으면 자동 재시작)
DASHBOARD_PORT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$CONFIG" 2>/dev/null || echo 7777)
if [ -f "$COMPANY_DIR/dashboard/server.py" ]; then
  dash_win=$((dag_win + 1))
  tmux new-window -t "$SESSION" -n "Dashboard"
  tmux send-keys -t "${SESSION}:${dash_win}" \
    "while true; do python3 '${COMPANY_DIR}/dashboard/server.py' || sleep 5; done" Enter
fi

# 모니터 실행 (윈도우 0)
tmux send-keys -t "${SESSION}:0" \
  "bash '${COMPANY_DIR}/monitor.sh'" Enter

# 브라우저 자동 오픈 (config의 dashboard_auto_open 활성화 시)
DASHBOARD_AUTO_OPEN=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_auto_open',True))" "$CONFIG" 2>/dev/null || echo True)
if [ "$DASHBOARD_AUTO_OPEN" = "True" ] && [ -f "$COMPANY_DIR/dashboard/server.py" ]; then
  # 서버가 뜰 때까지 잠깐 기다림
  (sleep 3 && {
    if command -v open >/dev/null 2>&1; then
      open "http://localhost:${DASHBOARD_PORT}"  # macOS
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:${DASHBOARD_PORT}" >/dev/null 2>&1  # Linux
    fi
  }) &
fi

echo "  회사 시작 완료"
echo ""
echo "  접속:     tmux attach -t $SESSION"
echo "  대시보드: http://localhost:${DASHBOARD_PORT}"
echo "  태스크:   bash .claude/company/kickoff.sh '요청'"
echo "  종료:     bash .claude/company/stop.sh"
echo ""
