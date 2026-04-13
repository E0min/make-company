#!/usr/bin/env bash
# Lazy Spawn Manager — 온디맨드 에이전트 생명주기 관리
# inbox에 메시지 도착 시 에이전트를 동적 시작, max_concurrent 제한, 큐 관리

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
INBOX_DIR="$COMPANY_DIR/inbox"
STATE_DIR="$COMPANY_DIR/state"
SPAWN_DIR="$STATE_DIR/spawn"
LOG="$COMPANY_DIR/logs/spawn-manager.log"

mkdir -p "$SPAWN_DIR" "$COMPANY_DIR/logs"

# Config 파싱 (시작 시 1회, SIGHUP으로 재로드)
load_config() {
  _spawn_config=$(python3 -c "
import json, sys
c = json.load(open(sys.argv[1]))
print(c.get('session_name', 'company'))
print(c.get('max_concurrent_agents', 4))
print(c.get('agent_idle_timeout', 180))
" "$CONFIG" 2>/dev/null) || return 1

  SESSION=$(echo "$_spawn_config" | sed -n '1p')
  MAX_CONCURRENT=$(echo "$_spawn_config" | sed -n '2p')
  IDLE_TIMEOUT=$(echo "$_spawn_config" | sed -n '3p')

  # lazy spawn 대상 에이전트 (protected 제외)
  LAZY_AGENTS=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
for a in agents:
    if not a.get('protected', False):
        engine = a.get('engine', 'claude')
        label = a.get('label', a['id'])
        team = a.get('team', '') or ''
        print(f\"{a['id']}|{engine}|{label}|{team}\")
" "$CONFIG" 2>/dev/null)
}

load_config || exit 1
CONFIG_MTIME=$(stat -f %m "$CONFIG" 2>/dev/null || stat -c %Y "$CONFIG" 2>/dev/null || echo 0)

# SIGHUP → 즉시 config 재로드
SIGHUP_RELOAD=false
trap 'SIGHUP_RELOAD=true' HUP

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"
}

# 에이전트가 현재 실행 중인지 확인 (tmux 윈도우 존재 여부)
is_running() {
  local agent_id="$1"
  local marker="$SPAWN_DIR/${agent_id}.win"
  if [ -f "$marker" ]; then
    local win_name
    win_name=$(cat "$marker" 2>/dev/null)
    if tmux list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qxF "$win_name"; then
      return 0
    fi
    # 윈도우 사라짐 → 마커 정리
    rm -f "$marker"
  fi
  return 1
}

# ━━━ 동적 max_concurrent 계산 (RAM 기반) ━━━
# 에이전트 1개당 ~500MB 기준, 가용 RAM에서 동적으로 계산
# config의 max_concurrent_agents를 상한으로 클램핑
AGENT_COST_MB=500

get_available_ram_mb() {
  if [ "$(uname)" = "Darwin" ]; then
    # macOS: vm_stat 기반
    local page_size
    page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
    local free_pages inactive_pages speculative_pages
    free_pages=$(vm_stat 2>/dev/null | awk '/Pages free/ {gsub(/\./,""); print $3}')
    inactive_pages=$(vm_stat 2>/dev/null | awk '/Pages inactive/ {gsub(/\./,""); print $3}')
    speculative_pages=$(vm_stat 2>/dev/null | awk '/Pages speculative/ {gsub(/\./,""); print $3}')
    free_pages="${free_pages:-0}"
    inactive_pages="${inactive_pages:-0}"
    speculative_pages="${speculative_pages:-0}"
    echo $(( (free_pages + inactive_pages + speculative_pages) * page_size / 1048576 ))
  else
    # Linux: /proc/meminfo 기반
    local avail
    avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)
    echo "${avail:-2048}"
  fi
}

get_dynamic_max() {
  local available_mb
  available_mb=$(get_available_ram_mb)
  local dynamic_max=$(( available_mb / AGENT_COST_MB ))
  # 최소 1, 최대 config 값으로 클램핑
  [ "$dynamic_max" -lt 1 ] 2>/dev/null && dynamic_max=1
  [ "$dynamic_max" -gt "$MAX_CONCURRENT" ] 2>/dev/null && dynamic_max=$MAX_CONCURRENT
  echo "$dynamic_max"
}

# 현재 실행 중인 lazy 에이전트 수
count_running() {
  local count=0
  for f in "$SPAWN_DIR"/*.win; do
    [ -f "$f" ] || continue
    local aid
    aid=$(basename "$f" .win)
    if is_running "$aid"; then
      count=$((count + 1))
    fi
  done
  echo "$count"
}

# 에이전트 스폰
spawn_agent() {
  local agent_id="$1"
  local engine="$2"
  local label="$3"
  local team="$4"

  if is_running "$agent_id"; then return 0; fi

  local running dynamic_limit
  running=$(count_running)
  dynamic_limit=$(get_dynamic_max)
  if [ "$running" -ge "$dynamic_limit" ]; then
    # 큐에 추가 (중복 방지)
    if ! grep -qxF "$agent_id" "$SPAWN_DIR/queue" 2>/dev/null; then
      echo "$agent_id" >> "$SPAWN_DIR/queue"
      log "큐 추가: $agent_id [${team:-root}] (실행중: $running/${dynamic_limit}, RAM제한)"
    fi
    return 1
  fi

  # 윈도우 이름 충돌 방지: label_lazy 접미사
  local win_name="${label}"

  if [ "$engine" = "gemini" ]; then
    tmux new-window -t "$SESSION" -n "$win_name" \
      "bash '${COMPANY_DIR}/agents/run-gemini.sh' '${agent_id}'; true"
  else
    tmux new-window -t "$SESSION" -n "$win_name" \
      "bash '${COMPANY_DIR}/agents/run-agent.sh' '${agent_id}'; true"
  fi

  # 윈도우 이름을 마커에 기록
  echo "$win_name" > "$SPAWN_DIR/${agent_id}.win"

  log "스폰: $agent_id [${team:-root}] (윈도우: $win_name, 실행중: $((running + 1))/${dynamic_limit}, RAM가용: $(get_available_ram_mb)MB)"
  return 0
}

# 큐에서 다음 에이전트 꺼내서 스폰
process_queue() {
  [ -f "$SPAWN_DIR/queue" ] || return
  [ -s "$SPAWN_DIR/queue" ] || { rm -f "$SPAWN_DIR/queue"; return; }

  local running dynamic_limit
  running=$(count_running)
  dynamic_limit=$(get_dynamic_max)
  [ "$running" -ge "$dynamic_limit" ] && return

  # 첫 번째 항목 꺼내기
  local next_id
  next_id=$(head -1 "$SPAWN_DIR/queue")
  [ -z "$next_id" ] && return

  # 큐에서 제거 (macOS sed 호환)
  tail -n +2 "$SPAWN_DIR/queue" > "$SPAWN_DIR/queue.tmp" 2>/dev/null
  mv "$SPAWN_DIR/queue.tmp" "$SPAWN_DIR/queue" 2>/dev/null
  [ -s "$SPAWN_DIR/queue" ] || rm -f "$SPAWN_DIR/queue"

  # 에이전트 정보 찾기
  local info
  info=$(echo "$LAZY_AGENTS" | grep "^${next_id}|")
  if [ -n "$info" ]; then
    local engine label team
    engine=$(echo "$info" | cut -d'|' -f2)
    label=$(echo "$info" | cut -d'|' -f3)
    team=$(echo "$info" | cut -d'|' -f4)
    spawn_agent "$next_id" "$engine" "$label" "$team"
  fi
}

# 종료된 에이전트 마커 정리
cleanup_dead() {
  for f in "$SPAWN_DIR"/*.win; do
    [ -f "$f" ] || continue
    local aid
    aid=$(basename "$f" .win)
    if ! is_running "$aid"; then
      rm -f "$f"
      log "정리: $aid (윈도우 종료됨)"
    fi
  done
}

# ━━━━━━ 시작 ━━━━━━
rm -f "$SPAWN_DIR"/*.win "$SPAWN_DIR/queue" 2>/dev/null

log "━━━ Spawn Manager 시작 ━━━"
log "  max_concurrent: $MAX_CONCURRENT (config 상한), idle_timeout: ${IDLE_TIMEOUT}s"
log "  동적 RAM 제한: $(get_available_ram_mb)MB 가용 → max $(get_dynamic_max)개"
log "  lazy 에이전트: $(echo "$LAZY_AGENTS" | wc -l | tr -d ' ')개"

_loop_iter=0
while true; do
  # Config 재로드 (SIGHUP 또는 30초 mtime 폴링)
  _loop_iter=$((_loop_iter + 1))
  _need_reload=false
  if [ "$SIGHUP_RELOAD" = true ]; then
    _need_reload=true
    SIGHUP_RELOAD=false
  elif [ $((_loop_iter % 10)) -eq 0 ]; then
    _new_mtime=$(stat -f %m "$CONFIG" 2>/dev/null || stat -c %Y "$CONFIG" 2>/dev/null || echo 0)
    if [ "$_new_mtime" != "$CONFIG_MTIME" ]; then
      _need_reload=true
      CONFIG_MTIME=$_new_mtime
    fi
  fi
  if [ "$_need_reload" = true ]; then
    load_config
    log "config 재로드: max=$MAX_CONCURRENT, idle=${IDLE_TIMEOUT}s"
  fi

  # 1. inbox 스캔 — 메시지 있고 에이전트 미실행이면 스폰
  echo "$LAZY_AGENTS" | while IFS='|' read -r agent_id engine label team; do
    [ -z "$agent_id" ] && continue
    inbox="$INBOX_DIR/${agent_id}.md"
    if [ -s "$inbox" ] && ! is_running "$agent_id"; then
      spawn_agent "$agent_id" "$engine" "$label" "$team"
    fi
  done

  # 2. 종료된 에이전트 마커 정리
  cleanup_dead

  # 3. 큐 처리 (슬롯이 비었으면 대기 중인 에이전트 스폰)
  process_queue

  sleep 3
done
