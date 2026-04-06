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
import json
agents = json.load(open('$CONFIG'))['agents']
print(' '.join(a['id'] for a in agents))
")

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

  # @mention 파싱
  local mentions
  mentions=$(echo "$content" | grep -oE '@[a-z-]+' | sed 's/@//' | sort -u)

  if [ -z "$mentions" ]; then
    log "라우팅 없음: $sender (멘션 없음)"
    return
  fi

  for recipient in $mentions; do
    # 유효한 에이전트인지 확인
    if echo "$AGENTS" | tr ' ' '\n' | grep -qx "$recipient"; then
      cat >> "$INBOX_DIR/${recipient}.md" << MSG

---
FROM: $sender
TIME: $ts
---
$content
MSG
      log "  $sender -> @$recipient"
    fi
  done
}

log "라우터 시작 (에이전트: $AGENTS)"
printf '\n[%s] 라우터 시작\n' "$(date '+%H:%M:%S')" >> "$CHANNEL"

while true; do
  for agent_id in $AGENTS; do
    outbox="$OUTBOX_DIR/${agent_id}.md"
    if [ -s "$outbox" ]; then
      content=$(cat "$outbox")
      > "$outbox"
      route_message "$agent_id" "$content"
    fi
  done
  sleep 1
done
