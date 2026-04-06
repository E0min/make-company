#!/usr/bin/env bash
# 실시간 회사 현황 대시보드 — config.json 기반

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
CHANNEL="$COMPANY_DIR/channel/general.md"
STATE_DIR="$COMPANY_DIR/state"

PROJECT=$(python3 -c "import json; print(json.load(open('$CONFIG'))['project'])" 2>/dev/null || echo "Company")

# config에서 에이전트 목록 추출
AGENT_DATA=$(python3 -c "
import json
agents = json.load(open('$CONFIG'))['agents']
for a in agents:
    engine = 'Gemini' if a['engine'] == 'gemini' else 'Claude'
    print(f\"{a['id']}|{a['label']}|{engine}\")
")

RED='\033[1;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
MAG='\033[1;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

W=56

get_state() { cat "$STATE_DIR/${1}.state" 2>/dev/null || echo "idle"; }

state_display() {
  case "$1" in
    idle)         printf "${DIM}○ 대기${NC}" ;;
    working)      printf "${GREEN}● 작업중${NC}" ;;
    done)         printf "${CYAN}✓ 완료${NC}" ;;
    error)        printf "${RED}✗ 오류${NC}" ;;
    rate-limited) printf "${YELLOW}⏳ 리밋${NC}" ;;
    compacting)   printf "${MAG}♻ compact${NC}" ;;
    booting)      printf "${YELLOW}⏳ 부팅${NC}" ;;
    stopped)      printf "${DIM}■ 종료${NC}" ;;
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
  hline
  row "Agent            Engine     Status"
  hline

  echo "$AGENT_DATA" | while IFS='|' read -r agent_id label engine; do
    [ -z "$agent_id" ] && continue
    state=$(get_state "$agent_id")
    printf "  ${BOLD}║${NC} %-16s %-10s " "$label" "$engine"
    state_display "$state"
    printf "%*s${BOLD}║${NC}\n" 20 ""
  done

  hline
  row "Team Channel (recent)"
  hline

  if [ -f "$CHANNEL" ]; then
    tail -16 "$CHANNEL" | while IFS= read -r line; do
      if [ -z "$line" ]; then
        printf "  ${BOLD}║${NC} %${W}s${BOLD}║${NC}\n" ""
      else
        printf "  ${BOLD}║${NC} %-${W}s${BOLD}║${NC}\n" "${line:0:$W}"
      fi
    done
  fi

  bot
  printf '\n'
  printf "  ${DIM}kickoff: bash .claude/company/kickoff.sh 'task'${NC}\n"
  printf "  ${DIM}stop:    bash .claude/company/stop.sh${NC}\n"

  sleep 3
done
