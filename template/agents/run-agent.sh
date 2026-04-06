#!/usr/bin/env bash
# Interactive Claude 에이전트 러너
# 대화형 세션으로 컨텍스트 누적 + ctx:50% 초과 시 자동 /compact

AGENT_ID="$1"
COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$COMPANY_DIR/../.." && pwd)"

INBOX="$COMPANY_DIR/inbox/${AGENT_ID}.md"
OUTBOX="$COMPANY_DIR/outbox/${AGENT_ID}.md"
STATE_DIR="$COMPANY_DIR/state"
LOG_DIR="$COMPANY_DIR/logs"

# bash 3.x 호환: declare -A 대신 case 사용
get_agent_file() {
  case "$1" in
    orch)      echo "ceo" ;;
    pm)        echo "product-manager" ;;
    design)    echo "ui-ux-designer" ;;
    frontend)  echo "frontend-engineer" ;;
    fe-qa)     echo "fe-qa" ;;
    backend)   echo "backend-engineer" ;;
    be-qa)     echo "be-qa" ;;
    marketing) echo "marketing-strategist" ;;
    *)         echo "$1" ;;
  esac
}

CLAUDE_AGENT=$(get_agent_file "$AGENT_ID")

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$INBOX"

set_state() { echo "$1" > "$STATE_DIR/${AGENT_ID}.state"; }
get_ts()    { date '+%H:%M:%S'; }

AGENT_UPPER=$(echo "$AGENT_ID" | tr '[:lower:]' '[:upper:]')

# 현재 pane ID
PANE_ID=$(tmux display-message -p '#{pane_id}' 2>/dev/null)

# ANSI 제거
strip_ansi() {
  sed $'s/\033\[[0-9;]*[a-zA-Z]//g; s/\033\][^\007]*\007//g; s/\r//g'
}

# Claude가 입력 대기 상태인지 확인
is_ready() {
  local bottom
  bottom=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | tail -5)
  # Claude Code 프롬프트 패턴: ❯, >, $
  echo "$bottom" | grep -qE '❯|^>|^\$'
}

# ctx 퍼센트 읽기
get_ctx_pct() {
  local pane
  pane=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null)
  echo "$pane" | grep -oE 'ctx:[0-9]+' | tail -1 | grep -oE '[0-9]+'
}

# 스크롤백 줄 수
get_scrollback_lines() {
  tmux capture-pane -t "$PANE_ID" -p -S - 2>/dev/null | wc -l | tr -d ' '
}

# ━━━━━━ 백그라운드 워처 ━━━━━━
watcher() {
  # claude가 초기화될 때까지 대기
  sleep 12

  # 프라이밍: 팀 통신 프로토콜 안내
  local prime="가상 회사 시스템에서 실행 중입니다. 팀원에게 전달할 메시지에는 @이름 멘션을 사용하세요. 팀원: @orch @pm @design @frontend @fe-qa @backend @be-qa @marketing @gemini. 이해했으면 간단히 확인해주세요."
  tmux send-keys -t "$PANE_ID" "$prime" Enter

  local waited=0
  while [ $waited -lt 60 ]; do
    if is_ready; then break; fi
    sleep 3; waited=$((waited + 3))
  done
  sleep 2

  set_state "idle"

  # 메인 루프
  while true; do
    if [ -s "$INBOX" ]; then
      local msg
      msg=$(cat "$INBOX")
      > "$INBOX"

      set_state "working"

      # 스크롤백 위치 기록 (응답 추출용)
      local pos_before
      pos_before=$(get_scrollback_lines)

      # 스킬 추천 (메시지 기반 자동 탐색)
      local skills_hint
      skills_hint=$(bash "$COMPANY_DIR/scripts/suggest-skills.sh" "$AGENT_ID" "$msg" 2>/dev/null)

      # 메시지 전송 (개행 → 공백 변환, Enter = 제출)
      local flat
      flat=$(echo "$msg" | tr '\n' ' ')
      if [ -n "$skills_hint" ]; then
        flat="$flat  |  $(echo "$skills_hint" | tr '\n' ' ')"
      fi
      tmux send-keys -t "$PANE_ID" "$flat" Enter

      # 응답 완료 대기
      sleep 8
      waited=8
      while [ $waited -lt 180 ]; do
        if is_ready; then sleep 2; break; fi
        sleep 4
        waited=$((waited + 4))
      done

      # 응답 추출: 전송 전 스크롤백 위치 이후 새 줄
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

      # ━━━ auto-compact: ctx > 50% → /compact ━━━
      local ctx
      ctx=$(get_ctx_pct)
      if [ -n "$ctx" ] && [ "$ctx" -gt 50 ]; then
        printf '[%s] ctx:%s%% > 50%% — /compact 실행\n' "$(get_ts)" "$ctx"
        set_state "compacting"
        tmux send-keys -t "$PANE_ID" "/compact" Enter
        sleep 15
        set_state "idle"
      fi
    fi
    sleep 2
  done
}

# ━━━━━━ 메인 ━━━━━━
clear
printf '\n  %s (Claude interactive, agent=%s)\n' "$AGENT_UPPER" "$CLAUDE_AGENT"
printf '  pane: %s\n\n' "$PANE_ID"

set_state "booting"

# 워처 백그라운드 시작
watcher &
WATCHER_PID=$!

# claude 대화형 세션 (포그라운드)
cd "$PROJECT_DIR"
claude --agent "$CLAUDE_AGENT"

# 종료 시 정리
kill "$WATCHER_PID" 2>/dev/null
set_state "stopped"
