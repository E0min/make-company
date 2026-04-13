#!/usr/bin/env bash
# Virtual Company v2 — 정지된 에이전트 모두 재개
# v2: tmux pane에 'fg' + Enter 전송하여 backgrounded claude 프로세스 복원
# 사용: bash resume.sh

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

# ━━━ 색상 ━━━
_g='\033[32m' _y='\033[33m' _d='\033[2m' _b='\033[1m' _0='\033[0m'

# ━━━ tmux 세션 이름 결정 ━━━
_find_session() {
  if [ -f "$CONFIG" ]; then
    _sn=$(python3 -c "
import json, sys
c = json.load(open(sys.argv[1]))
if 'session_name' in c:
    print(c['session_name'])
elif 'project' in c:
    import re
    print('vc-' + re.sub(r'[^a-zA-Z0-9_-]', '', c['project']))
else:
    print('')
" "$CONFIG" 2>/dev/null)
    if [ -n "$_sn" ] && tmux has-session -t "$_sn" 2>/dev/null; then
      echo "$_sn"
      return 0
    fi
  fi
  tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^vc-' | head -1
}

SESSION=$(_find_session)

if [ -z "$SESSION" ]; then
  echo -e "  ${_y}오류:${_0} 실행 중인 Virtual Company 세션을 찾을 수 없습니다."
  exit 1
fi

# ━━━ 에이전트 윈도우 목록 (Monitor, Usage, claude 제외) ━━━
_skip_windows="claude|Monitor|Usage"
_count=0
_resumed=""

while IFS=':' read -r widx wname; do
  echo "$wname" | grep -qE "^(${_skip_windows})$" && continue
  [ -z "$wname" ] && continue

  # fg + Enter 전송: backgrounded 프로세스 복원
  if tmux send-keys -t "${SESSION}:${widx}" 'fg' Enter 2>/dev/null; then
    _count=$((_count + 1))
    _resumed="${_resumed} ${wname}"
  fi
done <<EOF
$(tmux list-windows -t "$SESSION" -F '#{window_index}:#{window_name}' 2>/dev/null)
EOF

if [ "$_count" -eq 0 ]; then
  echo -e "  ${_y}재개할 에이전트 윈도우를 찾을 수 없습니다.${_0}"
  exit 1
fi

# ━━━ 상태 파일 복구 (paused -> idle) ━━━
if [ -d "$COMPANY_DIR/state" ]; then
  for sf in "$COMPANY_DIR/state/"*.state; do
    [ -f "$sf" ] || continue
    _cur_state=$(awk '{print $1}' "$sf")
    if [ "$_cur_state" = "paused" ]; then
      printf 'idle %s' "$(date +%s)" > "${sf}.tmp" && mv "${sf}.tmp" "$sf"
    fi
  done
fi

# ━━━ activity.jsonl 로깅 ━━━
_jsonl="$COMPANY_DIR/activity.jsonl"
_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"ts\":\"${_ts}\",\"event\":\"company_resumed\",\"agent\":\"system\",\"data\":{\"count\":${_count},\"session\":\"${SESSION}\"}}" >> "$_jsonl" 2>/dev/null

# ━━━ 결과 출력 ━━━
echo ""
echo -e "  ${_g}>>${_0} Virtual Company 재개 -- ${_b}${_count}${_0}개 에이전트 복원"
echo -e "  ${_d}세션: ${SESSION}${_0}"
for name in $_resumed; do
  echo -e "    ${_d}- ${name}${_0}"
done
echo ""
