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

# mkdir 기반 atomic lock (의존성 없음)
acquire_lock() {
  local lockdir="$1.lock.d"
  local waited=0
  while ! mkdir "$lockdir" 2>/dev/null; do
    sleep 0.1
    waited=$((waited + 1))
    [ $waited -gt 50 ] && return 1  # 5초 타임아웃
  done
  return 0
}
release_lock() { rmdir "$1.lock.d" 2>/dev/null; }

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
      # ━━━ Critic Loop: config의 매핑이 있으면 1차 검증 ━━━
      # CRITIC-REVIEW 메시지가 아닌 경우에만 (재귀 방지)
      if ! echo "$content" | grep -q '\[CRITIC-REVIEW'; then
        _critic=$(python3 -c "
import json,sys
try:
  c = json.load(open(sys.argv[1])).get('critic_loop', {})
  print(c.get(sys.argv[2], ''))
except: print('')
" "$CONFIG" "$recipient" 2>/dev/null)
        if [ -n "$_critic" ] && [ "$_critic" != "$sender" ] && [ "$_critic" != "$recipient" ]; then
          # critic에게 검토 요청 전달
          _ctarget="$INBOX_DIR/${_critic}.md"
          if acquire_lock "$_ctarget"; then
            printf '\n[CRITIC-REVIEW from:%s for:%s time:%s]\n%s\n응답 형식: 첫 줄에 OK 또는 REJECT, 둘째 줄부터 사유.\n' \
              "$sender" "$recipient" "$ts" "$content" >> "$_ctarget"
            release_lock "$_ctarget"
            log "  CRITIC: $sender→@$recipient 검토를 @$_critic에게 위임"
            continue  # 원수신자 라우팅 보류 (critic 응답이 나중에 라우팅됨)
          fi
        fi
      fi

      _target="$INBOX_DIR/${recipient}.md"
      # atomic lock으로 동시 쓰기 보호
      if acquire_lock "$_target"; then
        printf '\n[TEAM-MSG from:%s time:%s]\n%s\n' "$sender" "$ts" "$content" >> "$_target"
        release_lock "$_target"
        log "  $sender -> @$recipient"
        # 태스크 status 갱신: → routed (current_task.txt 기반)
        _current_task=$(cat "$COMPANY_DIR/state/current_task.txt" 2>/dev/null)
        _task_file="$COMPANY_DIR/state/tasks/${_current_task}.json"
        [ -n "$_current_task" ] && [ -f "$_task_file" ] && \
          sed -i '' 's/"status":"working"/"status":"routed"/' "$_task_file" 2>/dev/null
      else
        log "  실패: $recipient inbox 잠금 획득 타임아웃"
      fi
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
