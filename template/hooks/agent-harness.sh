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
fi

exit 0
