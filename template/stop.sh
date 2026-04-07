#!/usr/bin/env bash
COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['session_name'])" "$COMPANY_DIR/config.json" 2>/dev/null || echo "mindlink-company")
tmux kill-session -t "$SESSION" 2>/dev/null && echo "가상 회사 종료" || echo "세션 없음"
