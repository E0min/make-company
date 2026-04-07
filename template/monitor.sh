#!/usr/bin/env bash
# 실시간 회사 현황 대시보드 — config.json 기반

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
CHANNEL="$COMPANY_DIR/channel/general.md"
STATE_DIR="$COMPANY_DIR/state"

PROJECT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['project'])" "$CONFIG" 2>/dev/null || echo "Company")

# config에서 에이전트 목록 추출
AGENT_DATA=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    engine = 'Gemini' if a['engine'] == 'gemini' else 'Claude'
    print(f\"{a['id']}|{a['label']}|{engine}\")
" "$CONFIG")

RED='\033[1;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
MAG='\033[1;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

W=56

get_state() {
  if [ ! -d "$STATE_DIR" ]; then
    echo "no-state 0"
    return
  fi
  # heartbeat 확인 — 30초 이상 갱신 안 되면 dead
  local hbfile="$STATE_DIR/${1}.heartbeat"
  if [ -f "$hbfile" ]; then
    local hb now
    hb=$(cat "$hbfile" 2>/dev/null)
    now=$(date +%s)
    if [ -n "$hb" ] && [ $((now - hb)) -gt 30 ] 2>/dev/null; then
      echo "dead 0"
      return
    fi
  fi
  local sfile="$STATE_DIR/${1}.state"
  if [ -f "$sfile" ]; then
    cat "$sfile" 2>/dev/null || echo "read-error 0"
  else
    echo "unknown 0"
  fi
}

state_display() {
  case "$1" in
    idle)         printf "${DIM}○ 대기${NC}" ;;
    working)      printf "${GREEN}● 작업중${NC}" ;;
    done)         printf "${CYAN}✓ 완료${NC}" ;;
    error)        printf "${RED}✗ 오류${NC}" ;;
    timeout)             printf "${RED}⏱ 타임아웃${NC}" ;;
    dead)                printf "${RED}💀 죽음${NC}" ;;
    cost-paused)         printf "${YELLOW}💰 비용한도${NC}" ;;
    permanently-failed)  printf "${RED}☠ 영구실패${NC}" ;;
    rate-limited) printf "${YELLOW}⏳ 리밋${NC}" ;;
    compacting)   printf "${MAG}♻ compact${NC}" ;;
    booting)      printf "${YELLOW}⏳ 부팅${NC}" ;;
    stopped)      printf "${DIM}■ 종료${NC}" ;;
    no-state)     printf "${RED}✗ 상태없음${NC}" ;;
    read-error)   printf "${RED}✗ 읽기오류${NC}" ;;
    unknown)      printf "${DIM}? 미확인${NC}" ;;
    *)            printf "${DIM}? $1${NC}" ;;
  esac
}

hline() { printf "  ${BOLD}╠"; printf '═%.0s' $(seq 1 $W); printf "╣${NC}\n"; }
top()   { printf "  ${BOLD}╔"; printf '═%.0s' $(seq 1 $W); printf "╗${NC}\n"; }
bot()   { printf "  ${BOLD}╚"; printf '═%.0s' $(seq 1 $W); printf "╝${NC}\n"; }
row()   { printf "  ${BOLD}║${NC} %-${W}s${BOLD}║${NC}\n" "$1"; }

mkdir -p "$STATE_DIR"
touch "$CHANNEL"

while true; do
  clear
  printf '\n'
  top
  row "$PROJECT Virtual Company"
  row "$(date '+%Y-%m-%d %H:%M:%S')"

  # 최근 태스크 현황 표시
  _latest_task=$(ls -t "$COMPANY_DIR/state/tasks/"*.json 2>/dev/null | head -1)
  if [ -n "$_latest_task" ]; then
    _task_info=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
s=d.get('status','?')
t=d.get('task','')[:40]
print(f'{s} | {t}')
" "$_latest_task" 2>/dev/null || echo "?")
    row "Task: $_task_info"
  fi

  hline
  row "Agent            Engine     Status"
  hline

  echo "$AGENT_DATA" | while IFS='|' read -r agent_id label engine; do
    [ -z "$agent_id" ] && continue
    # state 파일에서 상태 + 타임스탬프 읽기
    state_line=$(get_state "$agent_id")
    state=$(echo "$state_line" | awk '{print $1}')
    state_ts=$(echo "$state_line" | awk '{print $2}')

    # ━━━ 자동 복구: dead 감지 시 자동 restart (3회 상한) ━━━
    if [ "$state" = "dead" ]; then
      restart_file="$STATE_DIR/restart_count_${agent_id}"
      restart_count=$(cat "$restart_file" 2>/dev/null || echo 0)
      if [ "$restart_count" -lt 3 ] 2>/dev/null; then
        restart_count=$((restart_count + 1))
        echo "$restart_count" > "$restart_file"
        # 백그라운드로 restart (모니터 블로킹 방지)
        (bash "$COMPANY_DIR/restart-agent.sh" "$agent_id" >/dev/null 2>&1 &)
      else
        # 3회 초과 → 영구 실패
        printf 'permanently-failed %s' "$(date +%s)" > "$STATE_DIR/${agent_id}.state.tmp" 2>/dev/null && \
        mv "$STATE_DIR/${agent_id}.state.tmp" "$STATE_DIR/${agent_id}.state" 2>/dev/null
        state="permanently-failed"
      fi
    fi
    # 정상 응답 후(working/idle) restart_count 초기화
    if [ "$state" = "idle" ] || [ "$state" = "working" ]; then
      rm -f "$STATE_DIR/restart_count_${agent_id}" 2>/dev/null
    fi
    # 경과 시간 계산
    elapsed=""
    if [ -n "$state_ts" ] && [ "$state_ts" != "0" ] 2>/dev/null; then
      now_ts=$(date +%s)
      diff=$((now_ts - state_ts))
      if [ "$diff" -gt 0 ] 2>/dev/null; then
        if [ "$diff" -lt 60 ]; then
          elapsed="${diff}s"
        else
          elapsed="$((diff / 60))m"
        fi
      fi
    fi
    # inbox 크기 (local 제거 — subshell 호환)
    inbox_size=0
    if [ -f "$COMPANY_DIR/inbox/${agent_id}.md" ]; then
      inbox_size=$(wc -c < "$COMPANY_DIR/inbox/${agent_id}.md" 2>/dev/null | tr -d ' ')
    fi
    inbox_display=""
    if [ "$inbox_size" -gt 0 ] 2>/dev/null; then
      inbox_display="📨"
    fi
    # 비용 표시 (state/cost.json에서 읽기)
    cost_display=""
    if [ -f "$COMPANY_DIR/state/cost.json" ]; then
      cost_display=$(python3 -c "
import json, sys
try:
  d = json.load(open(sys.argv[1]))
  t = d.get(sys.argv[2], {}).get('tokens', 0)
  if t >= 1000: print(f'{t//1000}K')
  elif t > 0: print(str(t))
  else: print('')
except: print('')
" "$COMPANY_DIR/state/cost.json" "$agent_id" 2>/dev/null)
    fi
    printf "  ${BOLD}║${NC} %-14s %-8s " "$label" "$engine"
    state_display "$state"
    printf " %-4s %-5s %2s%*s${BOLD}║${NC}\n" "$elapsed" "$cost_display" "$inbox_display" 4 ""
  done

  hline
  row "Team Channel (recent)"
  hline

  if [ -f "$CHANNEL" ]; then
    tail -16 "$CHANNEL" | while IFS= read -r line; do
      if [ -z "$line" ]; then
        printf "  ${BOLD}║${NC} %${W}s${BOLD}║${NC}\n" ""
      else
        # 한국어(UTF-8) 표시폭 기반 안전 truncate (local 제거 — subshell 호환)
        trimmed=$(python3 -c "
import sys, unicodedata
s, w = sys.argv[1], int(sys.argv[2])
out, cw = '', 0
for c in s:
    cw += 2 if unicodedata.east_asian_width(c) in 'WF' else 1
    if cw > w: break
    out += c
sys.stdout.write(out)
" "$line" "$W" 2>/dev/null || printf '%s' "${line:0:$W}")
        printf "  ${BOLD}║${NC} %s${BOLD}║${NC}\n" "$trimmed"
      fi
    done
  fi

  bot
  printf '\n'
  printf "  ${DIM}kickoff: bash .claude/company/kickoff.sh 'task'${NC}\n"
  printf "  ${DIM}stop:    bash .claude/company/stop.sh${NC}\n"

  sleep 3
done
