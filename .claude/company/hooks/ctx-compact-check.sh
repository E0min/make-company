#!/usr/bin/env bash
# ctx-compact-check.sh — PostToolUse 훅
# CTX 60% 이상이면 compact 제안 메시지를 stdout으로 출력
# Claude Code가 이 출력을 system reminder로 주입함

INPUT=$(cat)

# context_window.used_percentage 추출 시도
CTX_PCT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # 여러 경로로 시도
    pct = 0
    if 'session' in data:
        pct = data['session'].get('context_window', {}).get('used_percentage', 0)
    elif 'context_window' in data:
        pct = data['context_window'].get('used_percentage', 0)
    print(int(pct))
except:
    print(0)
" 2>/dev/null || echo "0")

# 0이면 (데이터 없음) 통과
[ "$CTX_PCT" -eq 0 ] 2>/dev/null && exit 0

# 60% 미만이면 통과
[ "$CTX_PCT" -lt 60 ] 2>/dev/null && exit 0

# 이미 이 세션에서 경고했는지 체크 (PID 기반, 세션당 1번)
PPID_FILE="/tmp/vc-ctx-warned-${PPID}"
[ -f "$PPID_FILE" ] && exit 0
touch "$PPID_FILE"

# 60% 이상: compact 제안
echo "⚠️ 컨텍스트 사용률 ${CTX_PCT}% — 60% 초과. 사용자에게 보존할 내용을 물어본 뒤 /compact를 실행하세요."
