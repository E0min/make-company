#!/usr/bin/env bash
# Virtual Company auto-start + @회사 라우팅 훅
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPANY_DIR="$PROJECT_DIR/company"
SESSION=$(python3 -c "import json; print(json.load(open('$COMPANY_DIR/config.json'))['session_name'])" 2>/dev/null || echo "company")

# 세션이 없으면 백그라운드로 회사 부팅
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  bash "$COMPANY_DIR/run.sh" > /dev/null 2>&1 &
fi

# stdin에서 prompt 추출하여 @회사 패턴 감지
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('prompt',''))" 2>/dev/null)
if echo "$PROMPT" | grep -qE '^@회사[:：]?[[:space:]]'; then
  TASK=$(echo "$PROMPT" | sed 's/^@회사[:：]*[[:space:]]*//')
  bash "$COMPANY_DIR/kickoff.sh" "$TASK" > /dev/null 2>&1
  echo "Orchestrator에게 전달: $TASK"
fi
exit 0
