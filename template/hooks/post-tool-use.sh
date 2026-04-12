#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# post-tool-use.sh — PostToolUse 하네스 훅
#
# git commit 감지 → 자동 테스트 실행 → 결과를 activity.jsonl에 기록
# 파일 변경 추적 + 파괴적 명령 경고
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# company 디렉토리 찾기
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
except: print('')
" 2>/dev/null || echo "")

# ━━━ 1. 파일 변경 로깅 (Write/Edit) ━━━
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except: print('')
" 2>/dev/null || echo "")
  if [ -n "$FILE_PATH" ]; then
    BASENAME=$(basename "$FILE_PATH" 2>/dev/null)
    echo "{\"event\":\"file_modified\",\"file\":\"$BASENAME\",\"tool\":\"$TOOL_NAME\",\"ts\":\"$TS\"}" >> "$JSONL_FILE" 2>/dev/null
  fi
fi

# ━━━ 2. Bash 도구 — 파괴적 명령 경고 + git commit 자동 검증 ━━━
if [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', '')[:200])
except: print('')
" 2>/dev/null || echo "")

  # 파괴적 명령 감지
  if echo "$CMD" | grep -qE 'git reset --hard|rm -rf /|DROP TABLE|DROP DATABASE'; then
    echo "[하네스 경고] 파괴적 명령 감지: $CMD"
  fi

  # git commit 감지 → 자동 검증
  if echo "$CMD" | grep -qE 'git commit'; then
    _av_enabled=$(python3 -c "
import json, sys
try:
    c = json.load(open(sys.argv[1]))
    print('1' if c.get('auto_verify', {}).get('on_commit') else '0')
except: print('0')
" "$COMPANY_DIR/config.json" 2>/dev/null || echo "0")

    if [ "$_av_enabled" = "1" ]; then
      _test_cmd=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('auto_verify',{}).get('test_command',''))" "$COMPANY_DIR/config.json" 2>/dev/null)

      if [ -n "$_test_cmd" ]; then
        echo "[하네스] git commit 감지 — 자동 검증: $_test_cmd"

        _test_result="pass"
        if ! timeout 60 bash -c "$_test_cmd" >/dev/null 2>&1; then
          _test_result="fail"
          echo "[하네스 경고] 자동 검증 실패"
        else
          echo "[하네스] 자동 검증 통과"
        fi

        # 커밋 메시지에서 태그 추출
        _commit_msg=$(git log -1 --format=%s 2>/dev/null || echo "")
        _ticket_id=$(echo "$_commit_msg" | grep -oE '\[ticket:[A-Z]+-[0-9]+\]' | sed 's/\[ticket://;s/\]//' | head -1)
        _agent_id=$(echo "$_commit_msg" | grep -oE '\[agent:[a-z_-]+\]' | sed 's/\[agent://;s/\]//' | head -1)

        echo "{\"event\":\"auto_verify\",\"result\":\"$_test_result\",\"ticket\":\"$_ticket_id\",\"agent\":\"$_agent_id\",\"command\":\"$_test_cmd\",\"ts\":\"$TS\"}" >> "$JSONL_FILE" 2>/dev/null

        # 게이트 연동: 티켓 verify_passed 업데이트
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
              -d "{\"verify_passed\":${_verify_val}}" \
              >/dev/null 2>&1
          fi
        fi
      fi
    fi
  fi
fi

exit 0
