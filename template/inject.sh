#!/usr/bin/env bash
# Virtual Company v2 — 특정 에이전트에 사용자 지시 주입
# v2: tmux send-keys -l로 메시지를 직접 에이전트의 대화형 세션에 타이핑
# 사용: inject.sh <agent_id> '주입할 메시지'

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

# ━━━ 색상 ━━━
_g='\033[32m' _y='\033[33m' _r='\033[31m' _d='\033[2m' _b='\033[1m' _0='\033[0m'

# ━━━ 사용법 ━━━
if [ $# -lt 2 ]; then
  echo ""
  echo -e "  사용법: inject.sh <agent_id> '주입할 메시지'"
  echo -e "  예시:   inject.sh pm '이 PRD에 모바일 시나리오 추가해주세요'"
  echo ""
  echo -e "  ${_d}agent_id 예: pm, frontend, backend, design, fe-qa, be-qa, marketing${_0}"
  echo ""
  exit 1
fi

AGENT_ID="$1"
shift
MSG="$*"

if [ -z "$MSG" ]; then
  echo -e "  ${_r}오류:${_0} 메시지가 비어 있습니다."
  exit 1
fi

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

# ━━━ agent_id -> tmux 윈도우 라벨 매핑 ━━━
# v2 (vc-launch.sh)에서 agent_file 기반 라벨 사용
# v1 (run.sh)에서 config.json label 필드 사용
# 둘 다 지원: agent_id로 윈도우 이름 매칭
_agent_to_label() {
  case "$1" in
    orch|ceo)             echo "CEO|Orch" ;;
    pm|product-manager)   echo "PM" ;;
    design|ui-ux-designer) echo "Design|Designer" ;;
    frontend|frontend-engineer) echo "Frontend" ;;
    backend|backend-engineer)   echo "Backend" ;;
    fe-qa)                echo "FE-QA" ;;
    be-qa)                echo "BE-QA" ;;
    marketing|marketing-strategist) echo "Marketing" ;;
    gemini)               echo "Gemini" ;;
    *)                    echo "$1" ;;
  esac
}

# ━━━ 에이전트 윈도우 찾기 ━━━
_labels=$(_agent_to_label "$AGENT_ID")
TARGET_WIDX=""
TARGET_WNAME=""

while IFS=':' read -r widx wname; do
  [ -z "$wname" ] && continue
  # 파이프로 구분된 패턴 각각 비교 (Bash 3.x 호환)
  _old_ifs="$IFS"
  IFS='|'
  for _pat in $_labels; do
    if [ "$wname" = "$_pat" ]; then
      TARGET_WIDX="$widx"
      TARGET_WNAME="$wname"
      break 2
    fi
  done
  IFS="$_old_ifs"
done <<EOF
$(tmux list-windows -t "$SESSION" -F '#{window_index}:#{window_name}' 2>/dev/null)
EOF

if [ -z "$TARGET_WIDX" ]; then
  echo -e "  ${_r}오류:${_0} 에이전트 '${AGENT_ID}'의 윈도우를 찾을 수 없습니다."
  echo -e "  ${_d}세션: ${SESSION}${_0}"
  echo -e "  ${_d}사용 가능한 윈도우:${_0}"
  tmux list-windows -t "$SESSION" -F "    #{window_index}: #{window_name}" 2>/dev/null
  exit 1
fi

# ━━━ 메시지 전송 ━━━
# tmux send-keys -l: 리터럴 모드 (특수 키 해석 안 함, 문자 그대로 타이핑)
# 줄바꿈 문자를 실제 Enter로 변환하지 않도록 -l 사용 후 별도 Enter
if tmux send-keys -t "${SESSION}:${TARGET_WIDX}" -l "$MSG" 2>/dev/null; then
  tmux send-keys -t "${SESSION}:${TARGET_WIDX}" Enter 2>/dev/null
else
  echo -e "  ${_r}오류:${_0} 메시지 전송 실패 (tmux send-keys 오류)"
  exit 1
fi

# ━━━ activity.jsonl 로깅 ━━━
_jsonl="$COMPANY_DIR/activity.jsonl"
_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# JSON 안전한 메시지 이스케이프 (python3 사용)
_safe_msg=$(python3 -c "
import json, sys
print(json.dumps(sys.argv[1]))
" "$MSG" 2>/dev/null || echo "\"${MSG}\"")
echo "{\"ts\":\"${_ts}\",\"event\":\"human_injection\",\"agent\":\"${AGENT_ID}\",\"data\":{\"window\":\"${TARGET_WNAME}\",\"message\":${_safe_msg}}}" >> "$_jsonl" 2>/dev/null

# ━━━ 결과 출력 ━━━
echo ""
echo -e "  ${_g}>>>${_0} ${_b}${AGENT_ID}${_0} (${TARGET_WNAME}) 에 사용자 지시 주입 완료"
echo -e "  ${_d}메시지: ${MSG}${_0}"
echo ""
echo -e "  ${_d}에이전트가 대화형 세션에서 즉시 처리합니다.${_0}"
echo ""
