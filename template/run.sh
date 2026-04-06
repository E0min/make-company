#!/usr/bin/env bash
# MindLink 가상 회사 시작 — config.json 기반 동적 에이전트 생성
set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

if [ ! -f "$CONFIG" ]; then
  echo "  config.json 없음: $CONFIG"
  exit 1
fi

# config.json 파싱 (python3 사용)
SESSION=$(python3 -c "import json; print(json.load(open('$CONFIG'))['session_name'])")
PROJECT=$(python3 -c "import json; print(json.load(open('$CONFIG'))['project'])")
AGENT_COUNT=$(python3 -c "import json; print(len(json.load(open('$CONFIG'))['agents']))")

echo ""
echo "  $PROJECT 가상 회사 시작 ($AGENT_COUNT 에이전트)"
echo ""

# 런타임 디렉토리 초기화
mkdir -p "$COMPANY_DIR"/{inbox,outbox,channel,logs,state,scripts}

# 에이전트 ID 목록 추출
AGENT_IDS=$(python3 -c "
import json
agents = json.load(open('$CONFIG'))['agents']
for a in agents:
    print(a['id'])
")

> "$COMPANY_DIR/channel/general.md"
for agent_id in $AGENT_IDS; do
  > "$COMPANY_DIR/inbox/${agent_id}.md"
  > "$COMPANY_DIR/outbox/${agent_id}.md"
  > "$COMPANY_DIR/state/${agent_id}.state"
done

# 스크립트 실행 권한
chmod +x "$COMPANY_DIR/router.sh" "$COMPANY_DIR/monitor.sh" "$COMPANY_DIR/kickoff.sh" "$COMPANY_DIR/stop.sh" 2>/dev/null
chmod +x "$COMPANY_DIR/agents/run-agent.sh" "$COMPANY_DIR/agents/run-gemini.sh" 2>/dev/null
chmod +x "$COMPANY_DIR/scripts/"*.sh 2>/dev/null

# 스킬 인덱스 사전 빌드
bash "$COMPANY_DIR/scripts/build-skill-index.sh" 2>/dev/null || true

# 기존 세션 종료
tmux kill-session -t "$SESSION" 2>/dev/null || true

# 새 tmux 세션 (윈도우 0: 모니터)
tmux new-session -d -s "$SESSION" -n "Monitor" -x 200 -y 55

# 에이전트 윈도우 동적 생성
win_idx=0
python3 -c "
import json
agents = json.load(open('$CONFIG'))['agents']
for a in agents:
    print(f\"{a['id']}|{a['engine']}|{a['label']}\")
" | while IFS='|' read -r agent_id engine label; do
  win_idx=$((win_idx + 1))
  tmux new-window -t "$SESSION" -n "$label"

  if [ "$engine" = "gemini" ]; then
    tmux send-keys -t "${SESSION}:${win_idx}" \
      "bash '${COMPANY_DIR}/agents/run-gemini.sh'" Enter
  else
    tmux send-keys -t "${SESSION}:${win_idx}" \
      "bash '${COMPANY_DIR}/agents/run-agent.sh' '${agent_id}'" Enter
  fi
done

# 라우터 윈도우 (마지막 + 1)
router_win=$((AGENT_COUNT + 1))
tmux new-window -t "$SESSION" -n "Router"
tmux send-keys -t "${SESSION}:${router_win}" \
  "bash '${COMPANY_DIR}/router.sh'" Enter

# 모니터 실행 (윈도우 0)
tmux send-keys -t "${SESSION}:0" \
  "bash '${COMPANY_DIR}/monitor.sh'" Enter

echo "  회사 시작 완료"
echo ""
echo "  접속:    tmux attach -t $SESSION"
echo "  태스크:  bash .claude/company/kickoff.sh '요청'"
echo "  종료:    bash .claude/company/stop.sh"
echo ""
