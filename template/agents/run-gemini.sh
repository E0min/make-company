#!/usr/bin/env bash
# Interactive Gemini 에이전트 러너
# Gemini CLI 대화형 세션 — @mention 기반 팀 통신

COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

INBOX="$COMPANY_DIR/inbox/gemini.md"
OUTBOX="$COMPANY_DIR/outbox/gemini.md"
STATE_DIR="$COMPANY_DIR/state"
LOG_DIR="$COMPANY_DIR/logs"

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$INBOX"

set_state() { echo "$1" > "$STATE_DIR/gemini.state"; }
get_ts()    { date '+%H:%M:%S'; }

PANE_ID=$(tmux display-message -p '#{pane_id}' 2>/dev/null)

strip_ansi() {
  sed $'s/\033\[[0-9;]*[a-zA-Z]//g; s/\033\][^\007]*\007//g; s/\r//g'
}

is_ready() {
  local bottom
  bottom=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | tail -5)
  echo "$bottom" | grep -qE '❯|^>|^\$|Gemini'
}

get_scrollback_lines() {
  tmux capture-pane -t "$PANE_ID" -p -S - 2>/dev/null | wc -l | tr -d ' '
}

watcher() {
  sleep 12

  # 프라이밍
  local prime="MindLink 가상 회사의 외부 기술 자문으로 참여 중입니다. 역할: 동료 에이전트, 코드 리뷰어, 토론 상대. 팀원에게 전달할 때 @이름 사용. 팀원: @orch @pm @design @frontend @fe-qa @backend @be-qa @marketing. 이해했으면 확인."
  tmux send-keys -t "$PANE_ID" "$prime" Enter

  local waited=0
  while [ $waited -lt 60 ]; do
    if is_ready; then break; fi
    sleep 3; waited=$((waited + 3))
  done
  sleep 2

  set_state "idle"

  while true; do
    if [ -s "$INBOX" ]; then
      local msg
      msg=$(cat "$INBOX")
      > "$INBOX"

      set_state "working"

      local pos_before
      pos_before=$(get_scrollback_lines)

      local flat
      flat=$(echo "$msg" | tr '\n' ' ')
      tmux send-keys -t "$PANE_ID" "$flat" Enter

      sleep 8
      waited=8
      while [ $waited -lt 180 ]; do
        if is_ready; then sleep 2; break; fi
        sleep 4; waited=$((waited + 4))
      done

      local full_scroll
      full_scroll=$(tmux capture-pane -t "$PANE_ID" -p -S - 2>/dev/null)
      local total_lines
      total_lines=$(echo "$full_scroll" | wc -l | tr -d ' ')
      local new_lines=$((total_lines - pos_before))

      if [ "$new_lines" -gt 0 ]; then
        local response
        response=$(echo "$full_scroll" | tail -n "$new_lines" | strip_ansi)
        if [ -n "$response" ]; then
          printf '%s' "$response" > "$OUTBOX"
        fi
      fi

      set_state "idle"
    fi
    sleep 2
  done
}

clear
printf '\n  GEMINI (Gemini CLI interactive)\n'
printf '  pane: %s\n\n' "$PANE_ID"

set_state "booting"

watcher &
WATCHER_PID=$!

# Gemini 대화형 세션 (yolo 모드: 도구 자동 승인)
cd "$(cd "$COMPANY_DIR/../.." && pwd)"
gemini --yolo

kill "$WATCHER_PID" 2>/dev/null
set_state "stopped"
