#!/usr/bin/env bash
# ⚠️ DEPRECATED: v1 전용. v2에서는 Gemini CLI를 직접 사용합니다.
# v1: Interactive Gemini 에이전트 러너
# Gemini CLI 대화형 세션 — @mention 기반 팀 통신

COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

INBOX="$COMPANY_DIR/inbox/gemini.md"
OUTBOX="$COMPANY_DIR/outbox/gemini.md"
STATE_DIR="$COMPANY_DIR/state"
LOG_DIR="$COMPANY_DIR/logs"

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$INBOX"

# atomic state write: mv 기반 + 타임스탬프
set_state() {
  printf '%s %s' "$1" "$(date +%s)" > "${STATE_DIR}/gemini.state.tmp" && \
  mv "${STATE_DIR}/gemini.state.tmp" "${STATE_DIR}/gemini.state"
}

# mkdir 기반 atomic lock
acquire_lock() {
  local lockdir="$1.lock.d"
  local waited=0
  while ! mkdir "$lockdir" 2>/dev/null; do
    sleep 0.1
    waited=$((waited + 1))
    [ $waited -gt 50 ] && return 1
  done
  return 0
}
release_lock() { rmdir "$1.lock.d" 2>/dev/null; }
get_ts() { date '+%H:%M:%S'; }

# 현재 pane ID — $TMUX_PANE 우선 사용
PANE_ID="${TMUX_PANE:-$(tmux display-message -p '#{pane_id}' 2>/dev/null)}"

strip_ansi() {
  sed $'s/\033\[[0-9;]*[a-zA-Z]//g; s/\033\][^\007]*\007//g; s/\r//g'
}

is_ready() {
  local pane_content
  pane_content=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | grep -v '^$' | tail -15)
  # Gemini 실행 중 표시가 있으면 ready 아님 (대소문자 모두)
  if echo "$pane_content" | grep -qiE 'esc to cancel|esc to interrupt|Loading|Thinking|Investigating|Processing|Reading file|Listing files'; then
    return 1
  fi
  # 진행 인디케이터 (스피너) 패턴
  if echo "$pane_content" | grep -qE '⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏'; then
    return 1
  fi
  # 빈 입력박스 = "Type your message" 텍스트가 보이면 ready
  echo "$pane_content" | grep -q 'Type your message'
}

watcher() {
  # gemini가 초기화될 때까지 대기
  sleep 8
  local waited=0
  while [ $waited -lt 60 ]; do
    if is_ready; then break; fi
    sleep 3; waited=$((waited + 3))
  done
  sleep 2

  set_state "idle"

  while true; do
    # heartbeat 갱신
    date +%s > "$STATE_DIR/gemini.heartbeat" 2>/dev/null
    # atomic inbox 읽기: mv 기반 TOCTOU 방지
    local _inbox_tmp="${INBOX}.processing.$$"
    if [ -s "$INBOX" ] && mv "$INBOX" "$_inbox_tmp" 2>/dev/null; then
      touch "$INBOX"
      local msg
      msg=$(cat "$_inbox_tmp")
      rm -f "$_inbox_tmp"

      set_state "working"

      # 고유 메시지 ID 마커
      local msg_id="msg_$(date +%s)_$$_${RANDOM}"
      local msg_marker="[MSG:${msg_id}]"

      local flat
      flat=$(printf '%s' "$msg" | tr '\n' ' ' | sed 's/  */ /g')
      flat="${msg_marker} ${flat}"
      # Gemini CLI는 빠른 키 입력을 multi-line으로 해석할 수 있음 — literal + 분리 Enter
      tmux send-keys -t "$PANE_ID" -l "$flat"
      sleep 1
      tmux send-keys -t "$PANE_ID" C-m

      # 응답 완료 대기: is_ready() + scrollback 변화 없음
      sleep 10
      waited=10
      local ready_count=0
      local prev_line_count=0
      local curr_line_count=0
      while [ $waited -lt 300 ]; do
        # heartbeat 갱신 (응답 대기 중에도 alive)
        date +%s > "$STATE_DIR/gemini.heartbeat" 2>/dev/null
        if is_ready; then
          curr_line_count=$(tmux capture-pane -t "$PANE_ID" -p -S -200 2>/dev/null | grep -cv '^$')
          if [ "$curr_line_count" = "$prev_line_count" ]; then
            ready_count=$((ready_count + 1))
            if [ $ready_count -ge 3 ]; then sleep 2; break; fi
          else
            ready_count=0
            prev_line_count=$curr_line_count
          fi
        else
          ready_count=0
          prev_line_count=$(tmux capture-pane -t "$PANE_ID" -p -S -200 2>/dev/null | grep -cv '^$')
        fi
        sleep 5
        waited=$((waited + 5))
      done

      # 응답 추출: 전송 메시지 이후 ~ 프롬프트 이전
      local _snap="${COMPANY_DIR}/.snap_gemini.$$"
      # 최근 200줄만 캡처 (도구 출력으로 인한 scrollback 오염 방지)
      tmux capture-pane -t "$PANE_ID" -p -S -200 2>/dev/null | strip_ansi > "$_snap"

      local response msg_line_num
      msg_line_num=$(grep -nF -- "$msg_marker" "$_snap" 2>/dev/null | tail -1 | cut -d: -f1)

      if [ -n "$msg_line_num" ]; then
        # 메시지 마커 이후의 내용에서 입력박스 전까지 추출
        local start_line=$((msg_line_num + 1))
        response=$(sed -n "${start_line},\$p" "$_snap" | \
          sed '/Type your message/,$d' | \
          grep -v '^─\|^╭\|^│\|^╰' | \
          grep -v 'YOLO Ctrl\|workspace\|sandbox\|MCP server' | \
          grep -v '^\s*$' | \
          sed '/^$/N;/^\n$/d')
      fi

      if [ -n "$response" ]; then
        if acquire_lock "$OUTBOX"; then
          printf '%s' "$response" > "$OUTBOX"
          release_lock "$OUTBOX"
        else
          printf '%s' "$response" > "$OUTBOX"
        fi
      fi
      rm -f "$_snap"

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

# signal trap: 종료 시 watcher 정리
trap 'kill "$WATCHER_PID" 2>/dev/null; rm -f "$COMPANY_DIR"/.snap_gemini.* "${INBOX}.processing."*; set_state "stopped"' EXIT INT TERM HUP

# Gemini 대화형 세션 (yolo 모드: 도구 자동 승인)
cd "$(cd "$COMPANY_DIR/../.." && pwd)"
gemini --yolo
