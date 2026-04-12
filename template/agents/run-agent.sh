#!/usr/bin/env bash
# Interactive Claude 에이전트 러너
# 대화형 세션으로 컨텍스트 누적 + ctx 초과 시 자동 /compact

AGENT_ID="$1"
COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$COMPANY_DIR/../.." && pwd)"

INBOX="$COMPANY_DIR/inbox/${AGENT_ID}.md"
OUTBOX="$COMPANY_DIR/outbox/${AGENT_ID}.md"
STATE_DIR="$COMPANY_DIR/state"
LOG_DIR="$COMPANY_DIR/logs"

# config에서 설정 읽기 (시작 시 1회)
_agent_config=$(python3 -c "
import json, sys
c = json.load(open(sys.argv[1]))
agents = c['agents']
agent = next((a for a in agents if a['id'] == sys.argv[2]), None)
print(agent.get('agent_file', sys.argv[2]) if agent else sys.argv[2])
print(c.get('compact_threshold', 50))
print(str(agent.get('protected', False)) if agent else 'False')
print(c.get('agent_idle_timeout', 180))
print(agent.get('team', '') or '' if agent else '')
print(c.get('dashboard_port', 7777))
print(c.get('project', ''))
" "$COMPANY_DIR/config.json" "$AGENT_ID" 2>/dev/null)

CLAUDE_AGENT=$(echo "$_agent_config" | sed -n '1p')
COMPACT_THRESHOLD=$(echo "$_agent_config" | sed -n '2p')
IS_PROTECTED=$(echo "$_agent_config" | sed -n '3p')
IDLE_TIMEOUT=$(echo "$_agent_config" | sed -n '4p')
AGENT_TEAM=$(echo "$_agent_config" | sed -n '5p')
DASHBOARD_PORT=$(echo "$_agent_config" | sed -n '6p')
PROJECT_ID=$(echo "$_agent_config" | sed -n '7p')
DASHBOARD_PORT="${DASHBOARD_PORT:-7777}"

CLAUDE_AGENT="${CLAUDE_AGENT:-$AGENT_ID}"
COMPACT_THRESHOLD="${COMPACT_THRESHOLD:-50}"
IS_PROTECTED="${IS_PROTECTED:-False}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-180}"

# 팀 workdir 결정: team이 있으면 teams/{team}/, 없으면 프로젝트 루트
if [ -n "$AGENT_TEAM" ] && [ -d "$PROJECT_DIR/teams/$AGENT_TEAM" ]; then
  WORK_DIR="$PROJECT_DIR/teams/$AGENT_TEAM"
else
  WORK_DIR="$PROJECT_DIR"
fi

mkdir -p "$LOG_DIR" "$STATE_DIR"
touch "$INBOX"

# atomic state write: mv 기반 + 타임스탬프
set_state() {
  printf '%s %s' "$1" "$(date +%s)" > "${STATE_DIR}/${AGENT_ID}.state.tmp" && \
  mv "${STATE_DIR}/${AGENT_ID}.state.tmp" "${STATE_DIR}/${AGENT_ID}.state"
}

# mkdir 기반 atomic lock (의존성 없음)
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

AGENT_UPPER=$(echo "$AGENT_ID" | tr '[:lower:]' '[:upper:]')

# 현재 pane ID — $TMUX_PANE 우선 사용 (tmux가 각 pane에 자동 설정)
PANE_ID="${TMUX_PANE:-$(tmux display-message -p '#{pane_id}' 2>/dev/null)}"

# ANSI 제거
strip_ansi() {
  sed $'s/\033\[[0-9;]*[a-zA-Z]//g; s/\033\][^\007]*\007//g; s/\r//g'
}

# Claude가 입력 대기 상태인지 확인
is_ready() {
  local pane_content
  pane_content=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | grep -v '^$' | tail -8)
  # 권한 프롬프트(Yes/No 선택)가 있으면 아직 ready가 아님
  if echo "$pane_content" | grep -q 'Do you want to proceed\|Yes, allow\|Esc to cancel'; then
    return 1
  fi
  # 도구 실행 중(Running…, Initializing…)이면 ready가 아님
  if echo "$pane_content" | grep -q 'Running…\|Initializing…'; then
    return 1
  fi
  # Claude Code 입력 프롬프트: ❯
  echo "$pane_content" | grep -q '❯'
}

# ctx 퍼센트 읽기
get_ctx_pct() {
  local pane
  pane=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null)
  echo "$pane" | grep -oE 'ctx:[0-9]+' | tail -1 | grep -oE '[0-9]+'
}

# ━━━━━━ 백그라운드 워처 ━━━━━━
watcher() {
  # claude가 초기화될 때까지 대기 (프라이밍은 에이전트 파일에 포함)
  sleep 8
  local waited=0
  while [ $waited -lt 60 ]; do
    if is_ready; then break; fi
    sleep 3; waited=$((waited + 3))
  done
  sleep 2

  set_state "idle"
  local last_activity
  last_activity=$(date +%s)

  # 메인 루프
  while true; do
    # heartbeat 기록 (모니터의 죽음 감지용)
    date +%s > "$STATE_DIR/${AGENT_ID}.heartbeat" 2>/dev/null

    # ━━━ idle timeout 체크 (protected 에이전트는 제외) ━━━
    if [ "$IS_PROTECTED" != "True" ] && [ "$IDLE_TIMEOUT" -gt 0 ] 2>/dev/null; then
      local now_ts
      now_ts=$(date +%s)
      local idle_secs=$((now_ts - last_activity))
      if [ "$idle_secs" -gt "$IDLE_TIMEOUT" ] 2>/dev/null; then
        printf '[%s] idle timeout (%ss > %ss) — 자동 종료\n' "$(get_ts)" "$idle_secs" "$IDLE_TIMEOUT"
        set_state "stopped"
        rm -f "$COMPANY_DIR/state/spawn/${AGENT_ID}.win" 2>/dev/null
        tmux send-keys -t "$PANE_ID" "/exit" Enter
        sleep 5
        return
      fi
    fi

    # atomic inbox 읽기: mv 기반 TOCTOU 방지
    local _inbox_tmp="${INBOX}.processing.$$"
    if [ -s "$INBOX" ] && mv "$INBOX" "$_inbox_tmp" 2>/dev/null; then
      last_activity=$(date +%s)
      touch "$INBOX"
      local msg
      msg=$(cat "$_inbox_tmp")
      rm -f "$_inbox_tmp"

      set_state "working"

      # 태스크 status 갱신: created → working (current_task.txt 기반)
      _current_task=$(cat "$COMPANY_DIR/state/current_task.txt" 2>/dev/null)
      _task_file="$COMPANY_DIR/state/tasks/${_current_task}.json"
      [ -n "$_current_task" ] && [ -f "$_task_file" ] && \
        sed -i '' 's/"status":"created"/"status":"working"/' "$_task_file" 2>/dev/null

      # DAG-NODE 메타데이터 추출 — outbox에 자동 prefix 추가용
      local _dag_meta=""
      if echo "$msg" | grep -q '\[DAG-NODE'; then
        _dag_meta=$(echo "$msg" | grep -m1 -oE '\[DAG-NODE wf:[^]]+\]')
      fi

      # CRITIC-REVIEW 메타데이터 추출 — 응답 시 CRITIC-RESPONSE prefix 자동 추가
      local _critic_meta=""
      if echo "$msg" | grep -q '\[CRITIC-REVIEW'; then
        _orig_target=$(echo "$msg" | grep -m1 -oE 'for:[a-z_-]+' | sed 's/for://')
        _orig_from=$(echo "$msg" | grep -m1 -oE 'orig_from:[a-z_-]+' | sed 's/orig_from://')
        _critic_meta="[CRITIC-RESPONSE for:${_orig_target} orig_from:${_orig_from}]"
      fi

      # 스킬 추천 (메시지 기반 자동 탐색)
      local skills_hint
      skills_hint=$(bash "$COMPANY_DIR/scripts/suggest-skills.sh" "$AGENT_ID" "$msg" 2>/dev/null)

      # 고유 메시지 ID 마커 생성 (응답 추출의 정확한 경계 식별용)
      local msg_id="msg_$(date +%s)_$$_${RANDOM}"
      local msg_marker="[MSG:${msg_id}]"

      # 메시지 전송 (개행 → 공백 변환, 여분 공백 정리)
      local flat
      flat=$(printf '%s' "$msg" | tr '\n' ' ' | sed 's/  */ /g')
      flat="${msg_marker} ${flat}"
      if [ -n "$skills_hint" ]; then
        flat="$flat  |  $(printf '%s' "$skills_hint" | tr '\n' ' ')"
      fi

      # knowledge/INDEX.md 주입 (KB-INDEX) — 활성화된 경우만
      local _kb_inject
      _kb_inject=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('knowledge_inject',True))" "$COMPANY_DIR/config.json" 2>/dev/null || echo "True")
      if [ "$_kb_inject" = "True" ] && [ -f "$COMPANY_DIR/knowledge/INDEX.md" ]; then
        local _kb
        _kb=$(head -15 "$COMPANY_DIR/knowledge/INDEX.md" 2>/dev/null | tr '\n' ' ')
        [ -n "$_kb" ] && flat="$flat  |  [KB] $_kb"
      fi

      tmux send-keys -t "$PANE_ID" "$flat" Enter

      # 응답 완료 대기: is_ready() + scrollback 변화 없음으로 안정화 판단
      # 서브에이전트/도구 사용 시 중간에 ❯가 잠깐 나타날 수 있으므로
      # "ready이고 scrollback 줄 수가 더 이상 변하지 않을 때"를 완료로 판단
      sleep 10
      waited=10
      local ready_count=0
      local prev_line_count=0
      local curr_line_count=0
      local approve_count=0
      local timed_out=false
      while [ $waited -lt 300 ]; do
        # heartbeat 갱신 (응답 대기 중에도 alive 표시)
        date +%s > "$STATE_DIR/${AGENT_ID}.heartbeat" 2>/dev/null

        # 권한 프롬프트 감지 → 자동 승인 (최대 5회)
        local pane_check
        pane_check=$(tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | grep -v '^$' | tail -8)
        if echo "$pane_check" | grep -q 'Do you want to proceed\|Esc to cancel'; then
          approve_count=$((approve_count + 1))
          if [ $approve_count -gt 5 ]; then
            set_state "error"
            timed_out=true
            break
          fi
          tmux send-keys -t "$PANE_ID" Enter
          sleep 2
          waited=$((waited + 2))
          ready_count=0
          continue
        fi

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

      # 타임아웃 처리
      if [ $waited -ge 300 ] && [ "$timed_out" != true ]; then
        timed_out=true
        set_state "timeout"
      fi
      if [ "$timed_out" = true ]; then
        rm -f "${COMPANY_DIR}/.snap_${AGENT_ID}.$$"
        sleep 5
        set_state "idle"
        continue
      fi

      # 응답 추출: ⏺ 마커(Claude 응답 시작) 기반
      local _snap="${COMPANY_DIR}/.snap_${AGENT_ID}.$$"
      local _extract_attempt=0
      while [ $_extract_attempt -lt 4 ]; do
        # 최근 500줄 캡처 (서브에이전트 결과 포함)
        tmux capture-pane -t "$PANE_ID" -p -S -500 2>/dev/null | strip_ansi > "$_snap"

      local response

      # 전송 메시지 이후의 첫 ⏺ 줄 찾기 (Claude 응답 시작점)
      local msg_line_num resp_start_num
      msg_line_num=$(grep -nF -- "$msg_marker" "$_snap" 2>/dev/null | tail -1 | cut -d: -f1)

      if [ -n "$msg_line_num" ]; then
        # msg_marker 이후에서 첫 ⏺ 줄 찾기 (Claude 응답 시작점)
        resp_start_num=$(sed -n "${msg_line_num},\$p" "$_snap" | grep -n '^⏺' | head -1 | cut -d: -f1)

        if [ -n "$resp_start_num" ]; then
          local abs_start=$((msg_line_num + resp_start_num - 1))
          # 화이트리스트 방식: ⏺ 텍스트 블록과 그 continuation(들여쓰기)만 추출
          response=$(sed -n "${abs_start},\$p" "$_snap" | \
            sed '/^❯/,$d' | \
            grep -E '^⏺ |^  [^ ]' | \
            grep -v '^\s*[├└│⎿]' | \
            grep -vE '^\s*(Bash|Read|Edit|Write|Explore|Search|Glob|Grep|Task|TodoWrite|WebFetch|WebSearch|Agent|NotebookEdit|MultiEdit|Skill|ToolSearch)\(' | \
            grep -v 'Running…\|Searching for\|Read [0-9]* files\|agents\? finished' | \
            grep -v 'ctrl+o\|ctrl+v\|ctrl+b' | \
            sed 's/^⏺ //' | \
            sed 's/^  //' | \
            sed '/^$/N;/^\n$/d')

          # Fallback: 필터링이 너무 강해 응답이 비었으면 ⏺ 줄만이라도 추출
          if [ -z "$response" ]; then
            response=$(sed -n "${abs_start},\$p" "$_snap" | \
              sed '/^❯/,$d' | \
              grep '^⏺ ' | \
              sed 's/^⏺ //')
          fi
        fi
      fi

      # 응답이 충분히 길면(50자+) 추출 종료, 아니면 5초 더 기다린 후 재시도
      if [ -n "$response" ] && [ "${#response}" -gt 50 ]; then
        break
      fi
      _extract_attempt=$((_extract_attempt + 1))
      [ $_extract_attempt -ge 4 ] && break
      sleep 5
      date +%s > "$STATE_DIR/${AGENT_ID}.heartbeat" 2>/dev/null
      done  # _extract_attempt loop

      # KNOWLEDGE-WRITE 마커 처리 — 응답에 [KNOWLEDGE-WRITE category/file.md] 있으면 저장
      if [ -n "$response" ] && echo "$response" | grep -q '\[KNOWLEDGE-WRITE'; then
        local _kw_target
        _kw_target=$(echo "$response" | grep -oE '\[KNOWLEDGE-WRITE [^]]+\]' | head -1 | sed 's/\[KNOWLEDGE-WRITE //; s/\]$//')
        if [ -n "$_kw_target" ]; then
          local _kw_file="$COMPANY_DIR/knowledge/${_kw_target}"
          mkdir -p "$(dirname "$_kw_file")" 2>/dev/null
          # 마커 다음 줄부터 저장
          echo "$response" | sed -n '/\[KNOWLEDGE-WRITE/,$p' | tail -n +2 > "$_kw_file"
          chmod 600 "$_kw_file" 2>/dev/null
          # INDEX 재생성
          bash "$COMPANY_DIR/scripts/update-knowledge-index.sh" "$COMPANY_DIR/knowledge" 2>/dev/null &
          printf '[%s] knowledge 저장: %s\n' "$(get_ts)" "$_kw_target" >> "$LOG_DIR/knowledge.log"
        fi
      fi

      # ━━━ HEARTBEAT 마커 처리 — 에이전트 자기점검 보고 ━━━
      if [ -n "$response" ] && echo "$response" | grep -q '\[HEARTBEAT'; then
        local _hb_ticket _hb_status _hb_next _hb_goal _hb_quality
        _hb_ticket=$(echo "$response" | grep -oE 'ticket:[A-Z]+-[0-9]+' | head -1 | sed 's/ticket://')
        _hb_status=$(echo "$response" | grep -oE 'status:[^ ]*' | head -1 | sed 's/status://' | tr -d ']')
        _hb_goal=$(echo "$response" | grep -oE 'goal:[A-Z]+-[0-9]+' | head -1 | sed 's/goal://')
        _hb_quality=$(echo "$response" | grep -oE 'quality:[0-9]+' | head -1 | sed 's/quality://')
        # API로 heartbeat 보고 (비동기)
        local _hb_token
        _hb_token=$(curl -s "http://localhost:${DASHBOARD_PORT}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
        if [ -n "$_hb_token" ] && [ -n "$PROJECT_ID" ]; then
          curl -s -X POST "http://localhost:${DASHBOARD_PORT}/api/${PROJECT_ID}/heartbeats" \
            -H "Content-Type: application/json" \
            -H "X-Token: $_hb_token" \
            -d "{\"agent\":\"${AGENT_ID}\",\"ticket\":\"${_hb_ticket}\",\"status\":\"${_hb_status}\",\"goal\":\"${_hb_goal}\",\"quality\":${_hb_quality:-0}}" \
            >/dev/null 2>&1 &
          printf '[%s] HEARTBEAT: %s ticket=%s status=%s\n' "$(get_ts)" "$AGENT_ID" "$_hb_ticket" "$_hb_status"
        fi
      fi

      # ━━━ TICKET 마커 처리 — 에이전트가 티켓 상태 변경 요청 ━━━
      if [ -n "$response" ] && echo "$response" | grep -q '\[TICKET:'; then
        local _tk_id _tk_status
        _tk_id=$(echo "$response" | grep -oE '\[TICKET:[A-Z]+-[0-9]+' | head -1 | sed 's/\[TICKET://')
        _tk_status=$(echo "$response" | grep -oE 'status:[a-z_]+' | head -1 | sed 's/status://')
        if [ -n "$_tk_id" ] && [ -n "$_tk_status" ]; then
          local _tk_token
          _tk_token=$(curl -s "http://localhost:${DASHBOARD_PORT}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
          if [ -n "$_tk_token" ] && [ -n "$PROJECT_ID" ]; then
            curl -s -X POST "http://localhost:${DASHBOARD_PORT}/api/${PROJECT_ID}/tickets/${_tk_id}/update" \
              -H "Content-Type: application/json" \
              -H "X-Token: $_tk_token" \
              -d "{\"status\":\"${_tk_status}\",\"agent\":\"${AGENT_ID}\"}" \
              >/dev/null 2>&1 &
            printf '[%s] TICKET: %s → %s status=%s\n' "$(get_ts)" "$AGENT_ID" "$_tk_id" "$_tk_status"
          fi
        fi
      fi

      if [ -n "$response" ]; then
        # DAG-NODE 또는 CRITIC-RESPONSE 메타데이터 prefix 자동 추가
        local _final_response="$response"
        if [ -n "$_dag_meta" ]; then
          _final_response="${_dag_meta}
${response}"
        elif [ -n "$_critic_meta" ]; then
          _final_response="${_critic_meta}
${response}"
        fi

        # outbox 쓰기에 atomic lock 적용
        if acquire_lock "$OUTBOX"; then
          printf '%s' "$_final_response" > "$OUTBOX"
          release_lock "$OUTBOX"
        else
          printf '%s' "$_final_response" > "$OUTBOX"  # fallback
        fi
        # 태스크 status 갱신: → done
        _current_task=$(cat "$COMPANY_DIR/state/current_task.txt" 2>/dev/null)
        _task_file="$COMPANY_DIR/state/tasks/${_current_task}.json"
        [ -n "$_current_task" ] && [ -f "$_task_file" ] && \
          sed -i '' 's/"status":"[^"]*"/"status":"done"/' "$_task_file" 2>/dev/null

        # ━━━ 비용 추적 (ctx % → 토큰 추정) ━━━
        _ctx_now=$(get_ctx_pct)
        _ctx_now="${_ctx_now:-0}"
        # ctx 1% ≈ 2000 tokens (200K 컨텍스트 기준)
        _tokens_used=$((_ctx_now * 2000))
        _cost_file="$COMPANY_DIR/state/cost.json"
        if acquire_lock "$_cost_file"; then
          python3 -c "
import json, sys
try:
  with open(sys.argv[1]) as f: data = json.load(f)
except: data = {}
agent = sys.argv[2]
data[agent] = {'tokens': int(sys.argv[3]), 'messages': data.get(agent, {}).get('messages', 0) + 1}
with open(sys.argv[1], 'w') as f: json.dump(data, f)
" "$_cost_file" "$AGENT_ID" "$_tokens_used" 2>/dev/null
          release_lock "$_cost_file"
        fi

        # 비용 한도 체크
        _cost_limit=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('cost_limit_tokens',200000))" "$COMPANY_DIR/config.json" 2>/dev/null || echo 200000)
        # 모든 에이전트의 누적 토큰 합산
        _total_tokens=$(python3 -c "
import json, sys
try:
  with open(sys.argv[1]) as f: data = json.load(f)
  print(sum(v.get('tokens', 0) for v in data.values()))
except: print(0)
" "$_cost_file" 2>/dev/null || echo 0)
        if [ "$_total_tokens" -gt "$_cost_limit" ] 2>/dev/null; then
          set_state "cost-paused"
          printf '[%s] 💰 비용 한도 초과 (%s/%s tokens) — cost-paused\n' "$(get_ts)" "$_total_tokens" "$_cost_limit"
          osascript -e "display notification \"비용 한도 초과 — 회사 일시정지\" with title \"Virtual Company\"" 2>/dev/null &
          sleep 60  # 1분 대기 후 다시 폴링
          continue
        fi

        # macOS notification
        osascript -e "display notification \"${AGENT_UPPER} 응답 완료\" with title \"Virtual Company\"" 2>/dev/null &
      fi
      rm -f "$_snap"

      set_state "idle"
      last_activity=$(date +%s)

      # ━━━ auto-compact: ctx > threshold → /compact ━━━
      local ctx
      ctx=$(get_ctx_pct)
      ctx="${ctx:-0}"
      if [ "$ctx" -gt "$COMPACT_THRESHOLD" ]; then
        printf '[%s] ctx:%s%% > %s%% — /compact 실행\n' "$(get_ts)" "$ctx" "$COMPACT_THRESHOLD"
        set_state "compacting"
        tmux send-keys -t "$PANE_ID" "/compact" Enter
        # compact 완료를 is_ready()로 확인 (최대 60초)
        sleep 5
        local compact_wait=5
        while [ $compact_wait -lt 60 ]; do
          date +%s > "$STATE_DIR/${AGENT_ID}.heartbeat" 2>/dev/null
          if is_ready; then break; fi
          sleep 3
          compact_wait=$((compact_wait + 3))
        done
        set_state "idle"
      fi
    fi
    sleep 2
  done
}

# ━━━━━━ 메인 ━━━━━━
clear
printf '\n  %s (Claude interactive, agent=%s, team=%s)\n' "$AGENT_UPPER" "$CLAUDE_AGENT" "${AGENT_TEAM:-root}"
printf '  pane: %s  workdir: %s\n\n' "$PANE_ID" "$WORK_DIR"

set_state "booting"

# 워처 백그라운드 시작
watcher &
WATCHER_PID=$!

# signal trap: 종료 시 watcher 정리
trap 'kill "$WATCHER_PID" 2>/dev/null; rm -f "$COMPANY_DIR"/.snap_${AGENT_ID}.* "${INBOX}.processing."* "$STATE_DIR/${AGENT_ID}.heartbeat"; set_state "stopped"' EXIT INT TERM HUP

# claude 대화형 세션 (포그라운드)
# 팀 workdir에서 실행 → Claude Code가 팀 CLAUDE.md + 루트 CLAUDE.md 계층적 로드
cd "$WORK_DIR"
claude --agent "$CLAUDE_AGENT"
