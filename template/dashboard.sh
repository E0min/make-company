#!/usr/bin/env bash
# Virtual Company 대시보드 — 에이전트 활동을 tmux 윈도우로 표시
# 메인 Claude(CEO)가 Agent tool 호출 시 agent-output/{id}.log에 기록 → 여기서 표시

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
OUTPUT_DIR="$COMPANY_DIR/agent-output"
ACTIVITY_LOG="$COMPANY_DIR/activity.log"
SESSION="vc-dashboard"

if [ ! -f "$CONFIG" ]; then
  echo "❌ config.json 없음. /company setup을 먼저 실행하세요."
  exit 1
fi

# config에서 에이전트 목록 추출 (ceo 제외 — 메인 Claude가 CEO)
AGENTS=$(python3 -c "
import json
agents = json.load(open('$CONFIG'))['agents']
print(' '.join(a for a in agents if a != 'ceo'))
")

# 출력 파일 초기화
mkdir -p "$OUTPUT_DIR"
for agent in $AGENTS; do
  touch "$OUTPUT_DIR/${agent}.log"
done
touch "$ACTIVITY_LOG"

# 기존 세션 종료
tmux kill-session -t "$SESSION" 2>/dev/null || true

# ── 레이아웃: 윈도우 0 = 모니터 (상단: activity, 하단: 에이전트 그리드) ──

tmux new-session -d -s "$SESSION" -n "Monitor" -x 200 -y 55

# 상단: activity log (30%)
tmux send-keys -t "$SESSION:0" \
  "clear; printf '\\n  📊 Virtual Company Activity Monitor\\n  ──────────────────────────────────\\n\\n'; tail -f '$ACTIVITY_LOG'" Enter

# 각 에이전트를 별도 윈도우로
idx=0
for agent in $AGENTS; do
  LABEL=$(python3 -c "print('$agent'.replace('-',' ').title())")
  idx=$((idx + 1))
  tmux new-window -t "$SESSION" -n "$LABEL"
  tmux send-keys -t "$SESSION:${idx}" \
    "clear; printf '\\n  🤖 $LABEL\\n  ──────────────\\n  상태: ⏳ 대기중\\n\\n'; tail -f '$OUTPUT_DIR/${agent}.log'" Enter
done

# 모니터 윈도우로 돌아감
tmux select-window -t "$SESSION:0"

echo ""
echo "  ✅ 대시보드 시작 완료"
echo ""
echo "  접속:    tmux attach -t $SESSION"
echo "  종료:    tmux kill-session -t $SESSION"
echo ""
echo "  윈도우 목록:"
echo "  0: Monitor (activity.log)"
for agent in $AGENTS; do
  LABEL=$(python3 -c "print('$agent'.replace('-',' ').title())")
  echo "  $(echo "$AGENTS" | tr ' ' '\n' | grep -n "^${agent}$" | cut -d: -f1): $LABEL"
done
echo ""
