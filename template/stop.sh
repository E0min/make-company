#!/usr/bin/env bash
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION=$(python3 -c "import json; print(json.load(open('$COMPANY_DIR/config.json'))['session_name'])" 2>/dev/null || echo "mindlink-company")
tmux kill-session -t "$SESSION" 2>/dev/null && echo "가상 회사 종료" || echo "세션 없음"
