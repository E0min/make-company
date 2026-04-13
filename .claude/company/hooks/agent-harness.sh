#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# agent-harness.sh — PostToolUse 하네스
#
# 프롬프트(가이드)가 아닌 코드(강제)로 에이전트 시스템을 제어합니다.
#
# 역할:
# 1. Agent tool 호출 자동 JSONL 로깅 (CEO가 안 해도 데이터 수집)
# 2. Write/Edit 후 자동 체크포인트 (주기적 git commit)
# 3. 에이전트 완료 패턴 감지 → 자동 회고 트리거
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# 현재 프로젝트의 company 디렉토리 찾기 (HOME 우선)
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

JSONL_FILE="$COMPANY_DIR/activity.jsonl"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 도구 이름 추출
TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

# ━━━ 1. Agent tool 호출 자동 로깅 ━━━
if [ "$TOOL_NAME" = "Agent" ]; then
  AGENT_TYPE=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    inp = d.get('tool_input', {})
    # subagent_type 또는 description에서 에이전트 식별
    agent = inp.get('subagent_type', inp.get('description', 'unknown'))
    print(agent[:50])
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

  # 시작/종료 구분: tool_output이 있으면 종료, 없으면 시작
  HAS_OUTPUT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('yes' if d.get('tool_output') else 'no')
except:
    print('no')
" 2>/dev/null || echo "no")

  if [ "$HAS_OUTPUT" = "yes" ]; then
    # 에이전트 완료
    echo "{\"event\":\"agent_end_harness\",\"agent\":\"$AGENT_TYPE\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null
  else
    # 에이전트 시작
    echo "{\"event\":\"agent_start_harness\",\"agent\":\"$AGENT_TYPE\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null
  fi
fi

# ━━━ 1b. Agent tool 완료 시 체크포인트 검증 ━━━
if [ "$TOOL_NAME" = "Agent" ] && [ "$HAS_OUTPUT" = "yes" ]; then
  # 에이전트 출력에서 CHECKPOINT 패턴 파싱
  OUTPUT_TEXT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    out = str(d.get('tool_output', ''))[:5000]
    print(out)
except:
    print('')
" 2>/dev/null || echo "")

  if [ -n "$OUTPUT_TEXT" ]; then
    CHECKPOINTS=$(echo "$OUTPUT_TEXT" | grep -o '\[CHECKPOINT:[a-z]*\]' | sort -u | tr '\n' ',' | sed 's/,$//')
    EXPECTED="[CHECKPOINT:analyze],[CHECKPOINT:complete],[CHECKPOINT:implement],[CHECKPOINT:plan],[CHECKPOINT:verify]"

    if [ -n "$CHECKPOINTS" ]; then
      # 체크포인트가 있으면 누락 검사
      MISSING=""
      for cp in analyze plan implement verify complete; do
        if ! echo "$CHECKPOINTS" | grep -q "$cp"; then
          MISSING="${MISSING}${cp}, "
        fi
      done

      if [ -n "$MISSING" ]; then
        echo "[하네스] 에이전트 출력에 누락된 체크포인트: ${MISSING%,*}— 해당 스텝을 다시 요청하세요."
        echo "{\"event\":\"checkpoint_missing\",\"agent\":\"$AGENT_TYPE\",\"missing\":\"${MISSING%,*}\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null
      fi

      # 품질 점수 추출
      QUALITY=$(echo "$OUTPUT_TEXT" | grep -o '품질자가평가: [0-9]*/10' | grep -o '[0-9]*' | head -1)
      if [ -n "$QUALITY" ] && [ "$QUALITY" -lt 6 ] 2>/dev/null; then
        echo "[하네스] 에이전트 품질 자가평가 ${QUALITY}/10 — 기준 미달(6). 재작업을 요청하세요."
        echo "{\"event\":\"quality_gate_fail\",\"agent\":\"$AGENT_TYPE\",\"quality\":$QUALITY,\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null
      fi
    fi

    # ━━━ 1c. 스킬 사용 검증 (SKILL_USED / SKILL_DONE 마커) ━━━
    # [SKILL_USED:skill-name] — 스킬 시작, [SKILL_DONE:skill-name] — 스킬 완료
    SKILLS_USED=$(echo "$OUTPUT_TEXT" | grep -o '\[SKILL_USED:[a-zA-Z0-9_-]*\]' | sed 's/\[SKILL_USED://;s/\]//' | sort -u | tr '\n' ',' | sed 's/,$//')
    SKILLS_DONE=$(echo "$OUTPUT_TEXT" | grep -o '\[SKILL_DONE:[a-zA-Z0-9_-]*\]' | sed 's/\[SKILL_DONE://;s/\]//' | sort -u | tr '\n' ',' | sed 's/,$//')

    # REQUIRED_SKILLS 환경변수에서 필수 스킬 목록 읽기 (comma-separated)
    _required="${REQUIRED_SKILLS:-}"

    if [ -n "$_required" ] || [ -n "$SKILLS_USED" ] || [ -n "$SKILLS_DONE" ]; then
      # 필수 스킬 중 SKILL_DONE에 없는 것 찾기
      SKILLS_MISSING=""
      if [ -n "$_required" ]; then
        _old_ifs="$IFS"
        IFS=','
        for _rskill in $_required; do
          # SKILLS_DONE 목록에 해당 스킬이 있는지 검사
          _found=false
          for _dskill in $SKILLS_DONE; do
            if [ "$_rskill" = "$_dskill" ]; then
              _found=true
              break
            fi
          done
          if [ "$_found" = false ]; then
            SKILLS_MISSING="${SKILLS_MISSING}${_rskill},"
          fi
        done
        IFS="$_old_ifs"
        SKILLS_MISSING=$(echo "$SKILLS_MISSING" | sed 's/,$//')
      fi

      # 누락 스킬 경고
      if [ -n "$SKILLS_MISSING" ]; then
        echo "[하네스] 필수 스킬 미완료: ${SKILLS_MISSING} — 해당 스킬을 사용해주세요."
        echo "{\"event\":\"skill_missing\",\"agent\":\"$AGENT_TYPE\",\"required\":\"$_required\",\"done\":\"$SKILLS_DONE\",\"missing\":\"$SKILLS_MISSING\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null

        # ━━━ strict 모드: 에이전트 진행 차단 (L4 pending-fix 패턴) ━━━
        _skill_mode=$(python3 -c "
import json,sys
try: print(json.load(open(sys.argv[1])).get('skill_enforcement','advisory'))
except: print('advisory')
" "$COMPANY_DIR/config.json" 2>/dev/null || echo "advisory")

        if [ "$_skill_mode" = "strict" ]; then
          # 티켓 ID 추출 (출력에서)
          _ticket_id=$(echo "$OUTPUT_TEXT" | grep -oE '\[ticket:[A-Z]+-[0-9]+\]' | sed 's/\[ticket://;s/\]//' | head -1)

          # L4 pending-fix 마커 생성 — 다음 프롬프트 제출 시 강제 주입
          _pending="/tmp/vc-pending-skill-$$"
          echo "[스킬 차단] 필수 스킬 미완료: ${SKILLS_MISSING}. 해당 스킬을 사용한 후 다시 시도하세요." > "$_pending"

          # skill_blocked 이벤트 로깅
          echo "{\"ts\":\"$TS\",\"event\":\"skill_blocked\",\"agent\":\"$AGENT_TYPE\",\"data\":{\"missing\":\"$SKILLS_MISSING\",\"ticket\":\"$_ticket_id\"},\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null

          # 에이전트에게 즉시 경고 (stdout → Claude가 수신)
          echo "[하네스 차단] strict 모드: 필수 스킬(${SKILLS_MISSING})을 완료해야 다음 단계로 진행할 수 있습니다."
        fi
      fi

      # skill-usage.jsonl API 로깅 (비동기)
      _dash_port="${DASHBOARD_PORT:-}"
      _proj_id="${PROJECT_ID:-}"
      if [ -z "$_dash_port" ] || [ -z "$_proj_id" ]; then
        _dash_port=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$COMPANY_DIR/config.json" 2>/dev/null || echo "7777")
        _proj_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$COMPANY_DIR/config.json" 2>/dev/null || echo "")
      fi
      if [ -n "$_dash_port" ] && [ -n "$_proj_id" ]; then
        _sk_token=$(curl -s --max-time 1 "http://localhost:${_dash_port}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
        if [ -n "$_sk_token" ]; then
          # JSON 배열 변환: comma-separated → ["a","b"]
          _to_json_arr() {
            if [ -z "$1" ]; then echo "[]"; return; fi
            echo "$1" | sed 's/^/["/; s/,/","/g; s/$/"]/'
          }
          _req_json=$(_to_json_arr "$_required")
          _used_json=$(_to_json_arr "$SKILLS_USED")
          _done_json=$(_to_json_arr "$SKILLS_DONE")
          _miss_json=$(_to_json_arr "$SKILLS_MISSING")

          # 커밋 메시지에서 티켓 ID 추출 (가능한 경우)
          _sk_ticket=$(echo "$OUTPUT_TEXT" | grep -oE '\[ticket:[A-Z]+-[0-9]+\]' | sed 's/\[ticket://;s/\]//' | head -1)

          curl -s -X POST "http://localhost:${_dash_port}/api/${_proj_id}/skills/usage/append" \
            -H "Content-Type: application/json" \
            -H "X-Token: $_sk_token" \
            -d "{\"entry\":{\"agent\":\"${AGENT_TYPE}\",\"ticket\":\"${_sk_ticket}\",\"required\":${_req_json},\"used\":${_used_json},\"done\":${_done_json},\"missing\":${_miss_json}}}" \
            >/dev/null 2>&1 &
        fi
      fi
    fi
  fi
fi

# ━━━ 2. Write/Edit 후 자동 체크포인트 ━━━
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
  # 수정된 파일 경로 추출
  FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

  # 도구 사용 카운터 (10회마다 체크포인트)
  COUNTER_FILE="/tmp/vc-harness-edit-count-$$"
  COUNT=0
  [ -f "$COUNTER_FILE" ] && COUNT=$(cat "$COUNTER_FILE")
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$COUNTER_FILE"

  # 10회마다 자동 체크포인트 제안
  if [ $((COUNT % 10)) -eq 0 ]; then
    echo "[하네스] 코드 변경 ${COUNT}회 — 체크포인트를 권장합니다. 'git add -A && git commit -m \"checkpoint\"'로 현재 상태를 저장하세요."
  fi

  # 파일 변경 JSONL 로깅
  if [ -n "$FILE_PATH" ]; then
    BASENAME=$(basename "$FILE_PATH" 2>/dev/null)
    echo "{\"event\":\"file_modified\",\"file\":\"$BASENAME\",\"tool\":\"$TOOL_NAME\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null
  fi
fi

# ━━━ 3. Bash 도구 사용 시 파괴적 명령 감지 ━━━
if [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', '')[:200])
except:
    print('')
" 2>/dev/null || echo "")

  # git reset --hard, rm -rf 등 감지
  if echo "$CMD" | grep -qE 'git reset --hard|rm -rf /|DROP TABLE|DROP DATABASE'; then
    echo "[하네스 경고] 파괴적 명령 감지: $CMD"
  fi

  # ━━━ 4. git commit 감지 → 자동 검증 ━━━
  if echo "$CMD" | grep -qE 'git commit'; then
    # config에서 auto_verify 설정 읽기
    _av_enabled=$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    av = c.get('auto_verify', {})
    print('1' if av.get('on_commit') else '0')
except: print('0')
" "$COMPANY_DIR/config.json" 2>/dev/null || echo "0")

    if [ "$_av_enabled" = "1" ]; then
      _test_cmd=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('auto_verify',{}).get('test_command',''))" "$COMPANY_DIR/config.json" 2>/dev/null)

      if [ -n "$_test_cmd" ]; then
        echo "[하네스] git commit 감지 — 자동 검증 실행: $_test_cmd"

        # 테스트 실행 (타임아웃 60초, 백그라운드 아닌 동기)
        _test_result="pass"
        if ! timeout 60 bash -c "$_test_cmd" >/dev/null 2>&1; then
          _test_result="fail"
          echo "[하네스 경고] 자동 검증 실패: $_test_cmd"
        else
          echo "[하네스] 자동 검증 통과"
        fi

        # activity.jsonl에 기록
        # 티켓 ID 추출 (커밋 메시지에서 [ticket:TASK-XXX])
        _commit_msg=$(git log -1 --format=%s 2>/dev/null || echo "")
        _ticket_id=$(echo "$_commit_msg" | grep -oE '\[ticket:[A-Z]+-[0-9]+\]' | sed 's/\[ticket://;s/\]//' | head -1)
        _agent_id=$(echo "$_commit_msg" | grep -oE '\[agent:[a-z_-]+\]' | sed 's/\[agent://;s/\]//' | head -1)

        echo "{\"event\":\"auto_verify\",\"result\":\"$_test_result\",\"ticket\":\"$_ticket_id\",\"agent\":\"$_agent_id\",\"command\":\"$_test_cmd\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$JSONL_FILE" 2>/dev/null

        # gate_integration: 티켓의 verify_passed 업데이트
        _gate_int=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('auto_verify',{}).get('gate_integration',False))" "$COMPANY_DIR/config.json" 2>/dev/null)
        if [ "$_gate_int" = "True" ] && [ -n "$_ticket_id" ]; then
          _dash_port=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$COMPANY_DIR/config.json" 2>/dev/null || echo 7777)
          _proj_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$COMPANY_DIR/config.json" 2>/dev/null)
          _token=$(curl -s "http://localhost:${_dash_port}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
          if [ -n "$_token" ] && [ -n "$_proj_id" ]; then
            _verify_val="true"
            [ "$_test_result" = "fail" ] && _verify_val="false"
            curl -s -X POST "http://localhost:${_dash_port}/api/${_proj_id}/tickets/${_ticket_id}/update" \
              -H "Content-Type: application/json" \
              -H "X-Token: $_token" \
              -H "X-Source: auto-verify" \
              -d "{\"verify_passed\":${_verify_val}}" \
              >/dev/null 2>&1
          fi
        fi
      fi
    fi
  fi
fi

exit 0
