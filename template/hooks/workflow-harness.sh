#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# workflow-harness.sh — PostToolUse 하네스
# 워크플로우 .yml 생성/수정 시 자동 검증
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
echo "$FILE_PATH" | grep -qE '\.(yml|yaml)$' || exit 0
echo "$FILE_PATH" | grep -q 'workflow' || exit 0

COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

# Python 검증 스크립트 실행
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$HOOK_DIR/workflow-validate.py" "$FILE_PATH" "$COMPANY_DIR/config.json" 2>/dev/null

# JSONL 이벤트
WF_NAME=$(basename "$FILE_PATH" .yml)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"event\":\"workflow_modified\",\"workflow\":\"$WF_NAME\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$COMPANY_DIR/activity.jsonl" 2>/dev/null

exit 0
