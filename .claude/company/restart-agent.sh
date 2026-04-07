#!/usr/bin/env bash
# 개별 에이전트 재시작 (zombie watcher 방지)

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
AGENT_ID="$1"

if [ -z "$AGENT_ID" ]; then
  echo ""
  echo "  사용법: restart-agent.sh <agent_id>"
  echo "  예시:   restart-agent.sh pm"
  echo ""
  exit 1
fi

SESSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['session_name'])" "$CONFIG" 2>/dev/null)

if [ -z "$SESSION" ]; then
  echo "  오류: config.json에서 세션명을 읽을 수 없습니다"
  exit 1
fi

# 에이전트의 윈도우 인덱스 찾기
WIN_IDX=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for i, a in enumerate(agents):
    if a['id'] == sys.argv[2]:
        print(i + 1)
        sys.exit(0)
print('')
" "$CONFIG" "$AGENT_ID")

if [ -z "$WIN_IDX" ]; then
  echo "  오류: 에이전트 '$AGENT_ID'를 config.json에서 찾을 수 없습니다"
  exit 1
fi

ENGINE=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
agent = next((a for a in agents if a['id'] == sys.argv[2]), None)
print(agent['engine'] if agent else '')
" "$CONFIG" "$AGENT_ID")

echo "  $AGENT_ID 재시작 중... (윈도우 $WIN_IDX, 엔진 $ENGINE)"

# restart_count 표시 (자동 복구 추적)
if [ -f "$COMPANY_DIR/state/restart_count_${AGENT_ID}" ]; then
  _rc=$(cat "$COMPANY_DIR/state/restart_count_${AGENT_ID}" 2>/dev/null)
  echo "  재시작 횟수: ${_rc}/3"
fi

# 기존 pane 강제 종료 후 재생성 (zombie watcher 방지)
# respawn-pane -k: pane의 모든 프로세스를 kill하고 새 쉘 시작
tmux respawn-pane -t "${SESSION}:${WIN_IDX}" -k 2>/dev/null
sleep 2

# state/inbox/outbox 초기화
printf 'booting %s' "$(date +%s)" > "$COMPANY_DIR/state/${AGENT_ID}.state"
> "$COMPANY_DIR/inbox/${AGENT_ID}.md"
> "$COMPANY_DIR/outbox/${AGENT_ID}.md"
# 잔류 temp 파일 정리
rm -f "$COMPANY_DIR/.snap_${AGENT_ID}."* "$COMPANY_DIR/inbox/${AGENT_ID}.md.processing."* 2>/dev/null

# 에이전트 재시작
if [ "$ENGINE" = "gemini" ]; then
  tmux send-keys -t "${SESSION}:${WIN_IDX}" \
    "bash '${COMPANY_DIR}/agents/run-gemini.sh'" Enter
else
  tmux send-keys -t "${SESSION}:${WIN_IDX}" \
    "bash '${COMPANY_DIR}/agents/run-agent.sh' '${AGENT_ID}'" Enter
fi

echo "  ✅ $AGENT_ID 재시작 완료"
