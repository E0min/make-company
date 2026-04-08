#!/usr/bin/env bash
# vc-launch.sh — Virtual Company + Claude Code 통합 런처
# 사용: claude -company   (zsh 함수가 호출)
#       또는 직접 bash vc-launch.sh
set -e

PROJECT_DIR="$(pwd)"
COMPANY_DIR="$PROJECT_DIR/.claude/company"
VC_TEMPLATE="${VC_TEMPLATE:-$HOME/깃허브/virtual-company}"

# ━━━ 1. 회사 미설치 시 자동 설치 ━━━
if [ ! -d "$COMPANY_DIR" ] || [ ! -f "$COMPANY_DIR/config.json" ]; then
  echo "▸ Virtual Company가 없습니다. 설치를 시작합니다..."
  if [ ! -d "$VC_TEMPLATE" ]; then
    echo "✗ VC_TEMPLATE not found: $VC_TEMPLATE" >&2
    echo "  환경변수 VC_TEMPLATE으로 템플릿 경로를 지정하세요." >&2
    exit 1
  fi
  bash "$VC_TEMPLATE/install.sh" "$COMPANY_DIR"
fi

# ━━━ 2. 세션명 추출 ━━━
SESSION=$(python3 -c "import json; print(json.load(open('$COMPANY_DIR/config.json')).get('session_name','company'))" 2>/dev/null || echo "company")

# ━━━ 3. 회사 가동 (run.sh가 tmux 세션 + 모든 에이전트 윈도우 생성) ━━━
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "▸ 회사 가동: $SESSION"
  bash "$COMPANY_DIR/run.sh"
  # run.sh가 백그라운드에서 세션을 만들 시간을 주기
  for _ in 1 2 3 4 5; do
    tmux has-session -t "$SESSION" 2>/dev/null && break
    sleep 0.3
  done
fi

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "✗ tmux 세션 생성 실패: $SESSION" >&2
  exit 1
fi

# ━━━ 4. "claude" 윈도우를 추가하고 claude code 실행 ━━━
# 이미 같은 이름의 윈도우가 있는지 확인
if ! tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'claude'; then
  # 인덱스 강제 X. 자동 슬롯에 생성 (-d: detach 모드라 활성 window 안 바뀜)
  tmux new-window -d -t "$SESSION:" -n claude -c "$PROJECT_DIR"
  tmux send-keys -t "$SESSION:claude" 'command claude' Enter
fi

# ━━━ 5. claude 윈도우로 점프 후 attach ━━━
tmux select-window -t "$SESSION:claude"

# 이미 tmux 안에 있으면 switch, 아니면 attach
if [ -n "$TMUX" ]; then
  tmux switch-client -t "$SESSION"
else
  tmux attach -t "$SESSION"
fi
