#!/usr/bin/env bash
# Virtual Company v2 — 모든 에이전트 일시 정지
# v2: tmux pane에 Ctrl+Z 전송하여 claude 프로세스를 background
# 사용: bash pause.sh

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

# ━━━ 색상 ━━━
_g='\033[32m' _y='\033[33m' _d='\033[2m' _b='\033[1m' _0='\033[0m'

# ━━━ tmux 세션 이름 결정 ━━━
# 1순위: config.json의 session_name
# 2순위: config.json의 project로 vc- 접두사
# 3순위: 실행 중인 vc- 세션 자동 감지
_find_session() {
  if [ -f "$CONFIG" ]; then
    # v1 형식: session_name 직접 지정
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
  # fallback: 실행 중인 vc- 세션 감지
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
_paused=""

while IFS=':' read -r widx wname; do
  # 시스템 윈도우 건너뛰기
  echo "$wname" | grep -qE "^(${_skip_windows})$" && continue
  [ -z "$wname" ] && continue

  # Ctrl+Z 전송: claude 프로세스를 background
  if tmux send-keys -t "${SESSION}:${widx}" '' C-z 2>/dev/null; then
    _count=$((_count + 1))
    _paused="${_paused} ${wname}"
  fi
done <<EOF
$(tmux list-windows -t "$SESSION" -F '#{window_index}:#{window_name}' 2>/dev/null)
EOF

if [ "$_count" -eq 0 ]; then
  echo -e "  ${_y}정지할 에이전트 윈도우를 찾을 수 없습니다.${_0}"
  exit 1
fi

# ━━━ 상태 파일 갱신 (paused) ━━━
if [ -d "$COMPANY_DIR/state" ]; then
  for sf in "$COMPANY_DIR/state/"*.state; do
    [ -f "$sf" ] || continue
    printf 'paused %s' "$(date +%s)" > "${sf}.tmp" && mv "${sf}.tmp" "$sf"
  done
fi

# ━━━ activity.jsonl 로깅 ━━━
_jsonl="$COMPANY_DIR/activity.jsonl"
_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\"ts\":\"${_ts}\",\"event\":\"company_paused\",\"agent\":\"system\",\"data\":{\"count\":${_count},\"session\":\"${SESSION}\"}}" >> "$_jsonl" 2>/dev/null

# ━━━ 결과 출력 ━━━
echo ""
echo -e "  ${_g}||${_0} Virtual Company 일시 정지 -- ${_b}${_count}${_0}개 에이전트 중지"
echo -e "  ${_d}세션: ${SESSION}${_0}"
for name in $_paused; do
  echo -e "    ${_d}- ${name}${_0}"
done
echo ""
echo -e "  사용:"
echo -e "    bash inject.sh <agent_id> '메시지'  # 특정 에이전트에 지시 주입"
echo -e "    bash resume.sh                       # 재개"
echo ""
