#!/usr/bin/env bash
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPANY_DIR="$PROJECT_DIR/.claude/company"
SESSION=$(python3 -c "import json; print(json.load(open('$COMPANY_DIR/config.json'))['session_name'])" 2>/dev/null || echo "company")
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  bash "$COMPANY_DIR/run.sh" > /dev/null 2>&1 &
fi
# @회사 패턴 감지
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('prompt',''))" 2>/dev/null)
if echo "$PROMPT" | grep -qE '^@회사[:：]?\s'; then
  TASK=$(echo "$PROMPT" | sed 's/^@회사[:：]*[[:space:]]*//')
  bash "$COMPANY_DIR/kickoff.sh" "$TASK" > /dev/null 2>&1
  echo "Orchestrator에게 전달: $TASK"
fi
exit 0
