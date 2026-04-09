#!/usr/bin/env bash
# vc-launch.sh — Virtual Company v2 통합 런처
# 사용: claude -company (zsh 함수가 호출)
#       또는 직접: bash vc-launch.sh
#
# 하는 일:
#   1. .claude/company 없으면 /company setup 안내
#   2. tmux 세션 생성 (vc-{프로젝트명})
#   3. 윈도우 0: claude CLI (여기서 /company run 사용)
#   4. 윈도우 1: Monitor (activity.log)
#   5. 윈도우 2~N: 에이전트별 output 모니터링
#   6. 웹 대시보드 서버 백그라운드 시작 (포트 7777)
#   7. claude 윈도우로 점프 후 attach

set -e

PROJECT_DIR="$(pwd)"
COMPANY_DIR="$PROJECT_DIR/.claude/company"
CONFIG="$COMPANY_DIR/config.json"
ACTIVITY_LOG="$COMPANY_DIR/activity.log"
OUTPUT_DIR="$COMPANY_DIR/agent-output"
DASHBOARD_SERVER="$COMPANY_DIR/dashboard/server.py"
DASHBOARD_PORT="${VC_DASHBOARD_PORT:-7777}"

# ━━━ 색상 ━━━
_g='\033[32m' _y='\033[33m' _r='\033[31m' _d='\033[2m' _0='\033[0m'

# ━━━ 1. 회사 설치 확인 ━━━
if [ ! -f "$CONFIG" ]; then
  echo -e "${_y}▸${_0} Virtual Company가 설정되어 있지 않습니다."
  echo -e "  Claude Code에서 ${_g}/company setup${_0} 을 먼저 실행하세요."
  echo ""
  echo -e "  ${_d}또는 수동 설치:${_0}"
  echo "    mkdir -p .claude/agents .claude/company/agent-memory .claude/company/agent-output"
  echo "    cp ~/.claude/agents/*.md .claude/agents/"
  echo "    cp ~/.claude/workflows/*.yml .claude/workflows/ 2>/dev/null"
  echo ""
  echo -e "  그래도 Claude Code를 실행할까요? (y/n) "
  read -r ans
  if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
    exit 0
  fi
  # 최소 구조 생성 — 글로벌 에이전트 전부 포함
  mkdir -p "$COMPANY_DIR/agent-memory" "$COMPANY_DIR/agent-output" "$PROJECT_DIR/.claude/agents" "$PROJECT_DIR/.claude/workflows"
  touch "$ACTIVITY_LOG"
  # 글로벌 에이전트 복사
  if [ -d "$HOME/.claude/agents" ]; then
    for f in "$HOME/.claude/agents"/*.md; do
      [ -f "$f" ] && cp -n "$f" "$PROJECT_DIR/.claude/agents/" 2>/dev/null
    done
  fi
  # 글로벌 워크플로우 복사
  if [ -d "$HOME/.claude/workflows" ]; then
    for f in "$HOME/.claude/workflows"/*.yml; do
      [ -f "$f" ] && cp -n "$f" "$PROJECT_DIR/.claude/workflows/" 2>/dev/null
    done
  fi
  # 에이전트 목록 자동 감지
  _AGENTS=$(ls "$PROJECT_DIR/.claude/agents/"*.md 2>/dev/null | xargs -I{} basename {} .md | python3 -c "import sys; print(','.join(['\"'+l.strip()+'\"' for l in sys.stdin if l.strip()]))" 2>/dev/null || echo '"ceo"')
  echo '{"project":"'"$(basename "$PROJECT_DIR")"'","tech_stack":"auto","agents":['"$_AGENTS"'],"language":"ko"}' > "$CONFIG"
  echo -e "  ${_g}✅${_0} 자동 설정 완료 ($(echo "$_AGENTS" | tr -cd ',' | wc -c | tr -d ' ' | xargs -I{} expr {} + 1)명)"
fi

# ━━━ 2. 프로젝트명 + 세션명 ━━━
PROJECT_NAME=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('project','company'))" 2>/dev/null || basename "$PROJECT_DIR")
SESSION="vc-${PROJECT_NAME}"
# tmux 세션명에 부적합 문자 제거
SESSION=$(echo "$SESSION" | tr -cd 'a-zA-Z0-9_-')

# ━━━ 3. 에이전트 목록 ━━━
AGENTS=$(python3 -c "
import json
agents = json.load(open('$CONFIG')).get('agents', [])
print(' '.join(a for a in agents if a != 'ceo'))
" 2>/dev/null || echo "")

# 출력 파일 초기화
mkdir -p "$OUTPUT_DIR"
for agent in $AGENTS; do
  touch "$OUTPUT_DIR/${agent}.log"
done
touch "$ACTIVITY_LOG"

# ━━━ 4. 기존 세션 확인 ━━━
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo -e "${_g}▸${_0} 기존 세션 발견: $SESSION"
  # claude 윈도우가 있는지 확인
  if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'claude'; then
    echo -e "  ${_d}claude 윈도우 활성 — attach합니다${_0}"
  else
    echo -e "  ${_y}claude 윈도우 없음 — 추가합니다${_0}"
    tmux new-window -t "$SESSION:" -n claude -c "$PROJECT_DIR"
    sleep 0.3
    tmux send-keys -t "$SESSION:claude" 'command claude' Enter
  fi
  tmux select-window -t "$SESSION:claude"
  if [ -n "$TMUX" ]; then
    tmux switch-client -t "$SESSION"
  else
    tmux attach -t "$SESSION"
  fi
  exit 0
fi

# ━━━ 5. 새 tmux 세션 생성 ━━━
echo -e "${_g}▸${_0} Virtual Company v2 시작: ${_g}$SESSION${_0}"
echo ""

# 윈도우 0: claude CLI
tmux new-session -d -s "$SESSION" -n claude -c "$PROJECT_DIR" -x 200 -y 55

# claude CLI 실행 (쉘 초기화 대기)
sleep 0.5
tmux send-keys -t "$SESSION:claude" 'command claude' Enter

# 윈도우 1: Monitor (activity.log)
tmux new-window -d -t "$SESSION:" -n Monitor
tmux send-keys -t "$SESSION:Monitor" "clear; printf '\\n  📊 Activity Monitor\\n  ──────────────────\\n\\n'; tail -f '$ACTIVITY_LOG'" Enter

# 윈도우 2~N: 에이전트별 output
for agent in $AGENTS; do
  LABEL=$(python3 -c "print('$agent'.replace('-',' ').title())" 2>/dev/null || echo "$agent")
  tmux new-window -d -t "$SESSION:" -n "$LABEL"
  tmux send-keys -t "$SESSION:$LABEL" "clear; printf '\\n  🤖 $LABEL\\n  ──────────────\\n\\n'; tail -f '$OUTPUT_DIR/${agent}.log'" Enter
done

# ━━━ 6. 웹 대시보드 서버 ━━━
if [ -f "$DASHBOARD_SERVER" ]; then
  # 기존 포트 사용 중이면 스킵
  if ! lsof -ti:$DASHBOARD_PORT >/dev/null 2>&1; then
    python3 "$DASHBOARD_SERVER" "$DASHBOARD_PORT" &
    DASH_PID=$!
    echo -e "  ${_g}🌐${_0} 웹 대시보드: ${_g}http://localhost:$DASHBOARD_PORT${_0}"
  else
    echo -e "  ${_d}🌐 웹 대시보드 이미 실행중 (포트 $DASHBOARD_PORT)${_0}"
  fi
fi

# ━━━ 7. 윈도우 목록 표시 ━━━
echo ""
echo -e "  ${_d}윈도우:${_0}"
tmux list-windows -t "$SESSION" -F "    #I: #W" 2>/dev/null || true
echo ""
echo -e "  ${_d}사용법:${_0}"
echo -e "    ${_g}/company run <태스크>${_0}  — 멀티에이전트 실행"
echo -e "    ${_g}/company workflow <name>${_0} — YAML 파이프라인"
echo -e "    ${_d}Ctrl+B → 번호${_0}          — 윈도우 전환"
echo -e "    ${_d}Ctrl+B → d${_0}             — detach"
echo ""

# ━━━ 8. claude 윈도우로 attach ━━━
tmux select-window -t "$SESSION:claude"

if [ -n "$TMUX" ]; then
  tmux switch-client -t "$SESSION"
else
  tmux attach -t "$SESSION"
fi
