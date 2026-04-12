#!/usr/bin/env bash
# 메시지 라우팅 데몬 — config.json 기반 동적 에이전트 목록

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"
INBOX_DIR="$COMPANY_DIR/inbox"
OUTBOX_DIR="$COMPANY_DIR/outbox"
CHANNEL="$COMPANY_DIR/channel/general.md"
LOG="$COMPANY_DIR/logs/router.log"

# config.json에서 에이전트 ID 목록 추출
load_agents() {
  AGENTS=$(python3 -c "
import json, sys
try:
  agents = json.load(open(sys.argv[1]))['agents']
  print(' '.join(a['id'] for a in agents))
except: print('')
" "$CONFIG" 2>/dev/null)
}
load_agents
CONFIG_MTIME=$(stat -f %m "$CONFIG" 2>/dev/null || echo 0)

# SIGHUP 수신 시 즉시 config 재로드 (대시보드의 즉시 알림)
SIGHUP_RELOAD=false
trap 'SIGHUP_RELOAD=true' HUP

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

  # ━━━ DAG-NODE 응답 처리: 에이전트가 DAG 노드 작업을 완료한 경우 ━━━
  if echo "$content" | grep -q '\[DAG-NODE'; then
    _wf_id=$(echo "$content" | grep -m1 -oE '\[DAG-NODE wf:[^ ]+' | sed 's/.*wf://')
    _node_id=$(echo "$content" | grep -m1 -oE 'node:[^ ]+' | sed 's/node://' | tr -d ']')
    if [ -n "$_wf_id" ] && [ -n "$_node_id" ]; then
      # artifact 저장: artifacts/{wf_id}/{node_id}_{agent}.md
      _art_dir="$COMPANY_DIR/artifacts/${_wf_id}"
      mkdir -p "$_art_dir"
      _art_file="${_art_dir}/${_node_id}_${sender}.md"
      # DAG-NODE 마커 다음 줄부터 저장
      echo "$content" | sed -n '/\[DAG-NODE/,$p' | tail -n +2 > "$_art_file"

      # workflow JSON에 status: done + output_artifact 갱신
      _wf_file="$COMPANY_DIR/state/workflows/${_wf_id}.json"
      if [ -f "$_wf_file" ]; then
        python3 -c "
import json, sys
with open(sys.argv[1]) as f:
  wf = json.load(f)
for n in wf['nodes']:
  if n['id'] == sys.argv[2]:
    n['status'] = 'done'
    n['output_artifact'] = sys.argv[3]
    n['completed_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
    break
# 모든 노드가 done이면 workflow status도 done
if all(n.get('status') == 'done' for n in wf['nodes']):
  wf['status'] = 'done'
with open(sys.argv[1], 'w') as f:
  json.dump(wf, f, indent=2, ensure_ascii=False)
" "$_wf_file" "$_node_id" "$_art_file"
        log "  DAG: wf=$_wf_id node=$_node_id done (artifact: $_art_file)"
      fi
      return
    fi
  fi

  # CRITIC-RESPONSE 처리: 에이전트가 critic 응답으로 outbox에 쓴 경우
  if echo "$content" | grep -q '\[CRITIC-RESPONSE'; then
    _orig_target=$(echo "$content" | grep -m1 -oE '\[CRITIC-RESPONSE for:[a-z_-]+' | sed 's/.*for://')
    _verdict=$(echo "$content" | grep -m1 -oE 'VERDICT:\s*(OK|REJECT)' | awk '{print $2}')
    _orig_sender=$(echo "$content" | grep -m1 -oE 'orig_from:[a-z_-]+' | sed 's/orig_from://')
    case "$_verdict" in
      OK)
        log "  CRITIC OK: $sender 승인 → 원수신자 @$_orig_target에게 라우팅"
        # 원래 메시지를 추출 (CRITIC-RESPONSE 다음 줄부터)
        _orig_msg=$(echo "$content" | sed -n '/\[CRITIC-RESPONSE/,$p' | tail -n +2)
        if [ -n "$_orig_target" ] && echo "$AGENTS" | tr ' ' '\n' | grep -qx "$_orig_target"; then
          _ot="$INBOX_DIR/${_orig_target}.md"
          if acquire_lock "$_ot"; then
            printf '\n[TEAM-MSG from:%s time:%s critic-approved:%s]\n%s\n' "$_orig_sender" "$ts" "$sender" "$_orig_msg" >> "$_ot"
            release_lock "$_ot"
          fi
        fi
        return  ;;
      REJECT)
        log "  CRITIC REJECT: $sender 거부 → 원발신자 @$_orig_sender에게 반송"
        if [ -n "$_orig_sender" ] && echo "$AGENTS" | tr ' ' '\n' | grep -qx "$_orig_sender"; then
          _os="$INBOX_DIR/${_orig_sender}.md"
          if acquire_lock "$_os"; then
            printf '\n[CRITIC-REJECTED by:%s time:%s]\n%s\n' "$sender" "$ts" "$content" >> "$_os"
            release_lock "$_os"
          fi
        fi
        return ;;
      *)
        log "  CRITIC WARN: 형식 파싱 실패, fail-open으로 원수신자 라우팅" ;;
    esac
  fi

  # ━━━ TICKET 마커 처리: 에이전트가 티켓 상태 변경을 요청한 경우 ━━━
  if echo "$content" | grep -q '\[TICKET:'; then
    _tk_id=$(echo "$content" | grep -oE '\[TICKET:[A-Z]+-[0-9]+' | head -1 | sed 's/\[TICKET://')
    _tk_status=$(echo "$content" | grep -oE 'status:[a-z_]+' | head -1 | sed 's/status://')
    if [ -n "$_tk_id" ] && [ -n "$_tk_status" ]; then
      _dash_port=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$CONFIG" 2>/dev/null || echo 7777)
      _proj_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$CONFIG" 2>/dev/null)
      _tk_token=$(curl -s "http://localhost:${_dash_port}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
      if [ -n "$_tk_token" ] && [ -n "$_proj_id" ]; then
        curl -s -X POST "http://localhost:${_dash_port}/api/${_proj_id}/tickets/${_tk_id}/update" \
          -H "Content-Type: application/json" \
          -H "X-Token: $_tk_token" \
          -d "{\"status\":\"${_tk_status}\",\"agent\":\"${sender}\"}" \
          >/dev/null 2>&1
        log "  TICKET: $sender → $_tk_id status=$_tk_status"
      fi
    fi
  fi

  for recipient in $mentions; do
    # 자기 자신에게 보내는 것 차단 (무한 루프 방지)
    if [ "$recipient" = "$sender" ]; then
      log "  차단: $sender -> @$recipient (자기 멘션)"
      continue
    fi
    # 유효한 에이전트인지 확인
    if echo "$AGENTS" | tr ' ' '\n' | grep -qx "$recipient"; then
      # ━━━ Reporting 강제: 보고선 위반 시 상위자에게 에스컬레이션 ━━━
      if ! echo "$content" | grep -qE '\[CRITIC-(REVIEW|RESPONSE)|ESCALATED'; then
        _reporting_action=$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    reporting = c.get('reporting', {})
    sender = sys.argv[2]
    recipient = sys.argv[3]
    s_info = reporting.get(sender, {})
    r_info = reporting.get(recipient, {})
    # 허용: sender가 recipient의 상위자 (approves에 포함)
    if recipient in s_info.get('approves', []):
        print('allow')
    # 허용: sender가 recipient에게 보고 (reports_to)
    elif s_info.get('reports_to') == recipient:
        print('allow')
    # 허용: 같은 상위자 (같은 팀 동료)
    elif s_info.get('reports_to') and s_info.get('reports_to') == r_info.get('reports_to'):
        print('allow')
    # 허용: recipient가 sender의 상위자
    elif r_info.get('approves') and sender in r_info.get('approves', []):
        print('allow')
    # 허용: reporting 설정 없음 (자유 라우팅)
    elif not reporting:
        print('allow')
    # 허용: sender 또는 recipient가 reporting에 없음
    elif sender not in reporting or recipient not in reporting:
        print('allow')
    else:
        # 에스컬레이션: sender의 상위자에게 위임
        boss = s_info.get('reports_to', '')
        print(f'escalate:{boss}' if boss else 'allow')
except:
    print('allow')
" "$CONFIG" "$sender" "$recipient" 2>/dev/null || echo "allow")

        if echo "$_reporting_action" | grep -q '^escalate:'; then
          _escalate_to=$(echo "$_reporting_action" | sed 's/escalate://')
          if [ -n "$_escalate_to" ] && echo "$AGENTS" | tr ' ' '\n' | grep -qx "$_escalate_to"; then
            _etarget="$INBOX_DIR/${_escalate_to}.md"
            if acquire_lock "$_etarget"; then
              printf '\n[ESCALATED from:%s for:%s time:%s reason:reporting_violation]\n%s에게 보내려는 메시지를 검토해주세요:\n%s\n' \
                "$sender" "$recipient" "$ts" "$recipient" "$content" >> "$_etarget"
              release_lock "$_etarget"
              log "  ESCALATED: $sender→@$recipient 보고선 위반 → 상위 @$_escalate_to"
              continue
            fi
          fi
        fi
      fi

      # ━━━ Critic Loop: config 매핑이 있으면 1차 검증 ━━━
      # CRITIC-REVIEW/RESPONSE 메시지는 재귀 방지로 critic 안 거침
      if ! echo "$content" | grep -qE '\[CRITIC-(REVIEW|RESPONSE)'; then
        _critic=$(python3 -c "
import json,sys
try:
  c = json.load(open(sys.argv[1])).get('critic_loop', {})
  print(c.get(sys.argv[2], ''))
except: print('')
" "$CONFIG" "$recipient" 2>/dev/null)
        if [ -n "$_critic" ] && [ "$_critic" != "$sender" ] && [ "$_critic" != "$recipient" ]; then
          _ctarget="$INBOX_DIR/${_critic}.md"
          if acquire_lock "$_ctarget"; then
            printf '\n[CRITIC-REVIEW orig_from:%s for:%s time:%s]\n%s\n\n응답 형식 (필수): 첫 줄에 정확히 "VERDICT: OK" 또는 "VERDICT: REJECT"를 쓰고, 다음 줄부터 사유. 응답은 [CRITIC-RESPONSE for:%s orig_from:%s]로 시작해야 합니다.\n' \
              "$sender" "$recipient" "$ts" "$content" "$recipient" "$sender" >> "$_ctarget"
            release_lock "$_ctarget"
            log "  CRITIC: $sender→@$recipient 검토 위임 → @$_critic"
            continue
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

_loop_iter=0
while true; do
  # SIGHUP 수신 또는 30초 mtime 폴링 → config 재로드
  _loop_iter=$((_loop_iter + 1))
  _need_reload=false
  if [ "$SIGHUP_RELOAD" = true ]; then
    _need_reload=true
    SIGHUP_RELOAD=false
  elif [ $((_loop_iter % 30)) -eq 0 ]; then
    _new_mtime=$(stat -f %m "$CONFIG" 2>/dev/null || echo 0)
    if [ "$_new_mtime" != "$CONFIG_MTIME" ]; then
      _need_reload=true
      CONFIG_MTIME=$_new_mtime
    fi
  fi
  if [ "$_need_reload" = true ]; then
    load_agents
    CONFIG_MTIME=$(stat -f %m "$CONFIG" 2>/dev/null || echo 0)
    log "  config.json 재로드: $AGENTS"
    # 새 에이전트의 inbox/outbox 파일 생성
    for agent_id in $AGENTS; do
      touch "$INBOX_DIR/${agent_id}.md" 2>/dev/null
      touch "$OUTBOX_DIR/${agent_id}.md" 2>/dev/null
    done
  fi

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
