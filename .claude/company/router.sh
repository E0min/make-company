#!/usr/bin/env bash
# 메시지 라우팅 데몬 — config.json 기반 동적 에이전트 목록

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
INBOX_DIR="$COMPANY_DIR/inbox"
OUTBOX_DIR="$COMPANY_DIR/outbox"
CHANNEL="$COMPANY_DIR/channel/general.md"
LOG="$COMPANY_DIR/logs/router.log"

# config.json에서 에이전트 ID 목록 추출
AGENTS=$(python3 -c "
import json, sys
agents = json.load(open(sys.argv[1]))['agents']
print(' '.join(a['id'] for a in agents))
" "$CONFIG")

mkdir -p "$INBOX_DIR" "$OUTBOX_DIR" "$COMPANY_DIR/channel" "$COMPANY_DIR/logs" "$COMPANY_DIR/state"
touch "$CHANNEL"

for agent_id in $AGENTS; do
  touch "$INBOX_DIR/${agent_id}.md"
  touch "$OUTBOX_DIR/${agent_id}.md"
done

log() {
  local ts
  ts=$(date '+%H:%M:%S')
  echo "[$ts] $*" | tee -a "$LOG"
}

route_message() {
  local sender="$1"
  local content="$2"
  local ts
  ts=$(date '+%H:%M:%S')
  local sender_upper
  sender_upper=$(echo "$sender" | tr '[:lower:]' '[:upper:]')

  printf '\n--- [%s] %s ---\n%s\n' "$ts" "$sender_upper" "$content" >> "$CHANNEL"

  # @mention 파싱 (대소문자 무시, 소문자로 정규화)
  local mentions
  mentions=$(echo "$content" | grep -oiE '@[a-z_-]+' | tr '[:upper:]' '[:lower:]' | sed 's/@//' | sort -u)

  if [ -z "$mentions" ]; then
    log "라우팅 없음: $sender (멘션 없음)"
    return
  fi

  for recipient in $mentions; do
    # 자기 자신에게 보내는 것 차단 (무한 루프 방지)
    if [ "$recipient" = "$sender" ]; then
      log "  차단: $sender -> @$recipient (자기 멘션)"
      continue
    fi
    # 유효한 에이전트인지 확인
    if echo "$AGENTS" | tr ' ' '\n' | grep -qx "$recipient"; then
      printf '\n[TEAM-MSG from:%s time:%s]\n%s\n' "$sender" "$ts" "$content" >> "$INBOX_DIR/${recipient}.md"
      log "  $sender -> @$recipient"
      # 태스크 status 갱신: → routed (current_task.txt 기반)
      _current_task=$(cat "$COMPANY_DIR/state/current_task.txt" 2>/dev/null)
      _task_file="$COMPANY_DIR/state/tasks/${_current_task}.json"
      [ -n "$_current_task" ] && [ -f "$_task_file" ] && \
        sed -i '' 's/"status":"working"/"status":"routed"/' "$_task_file" 2>/dev/null
    else
      log "  경고: $sender가 알 수 없는 에이전트 @$recipient 멘션"
    fi
  done
}

log "라우터 시작 (에이전트: $AGENTS)"
printf '\n[%s] 라우터 시작\n' "$(date '+%H:%M:%S')" >> "$CHANNEL"

while true; do
  for agent_id in $AGENTS; do
    outbox="$OUTBOX_DIR/${agent_id}.md"
    # atomic outbox 읽기: mv 기반 TOCTOU 방지
    _outbox_tmp="${outbox}.processing.$$"
    if [ -s "$outbox" ] && mv "$outbox" "$_outbox_tmp" 2>/dev/null; then
      touch "$outbox"
      content=$(cat "$_outbox_tmp")
      rm -f "$_outbox_tmp"
      route_message "$agent_id" "$content"
    fi
  done
  sleep 1
done
