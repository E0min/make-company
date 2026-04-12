#!/usr/bin/env bash
# Orchestrator에게 태스크를 전달하여 가상 회사 워크플로우를 시작

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

# --watch 모드 감지
WATCH_MODE=false
if [ "$1" = "--watch" ]; then
  WATCH_MODE=true
  shift
fi

# --dag 모드 감지
if [ "$1" = "--dag" ]; then
  shift
  DAG_FILE="$1"
  shift
  USER_REQUEST="$*"
  if [ ! -f "$DAG_FILE" ]; then
    echo "  오류: DAG 파일 없음: $DAG_FILE"
    exit 1
  fi
  # workflow_id 추출 + state/workflows/에 복사 + user_request 주입
  WF_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('workflow_id', 'wf_'+'$(date +%s)'))" "$DAG_FILE")
  mkdir -p "$COMPANY_DIR/state/workflows"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
  wf = json.load(f)
wf['user_request'] = sys.argv[3]
wf['status'] = 'in_progress'
wf['kicked_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
# 모든 노드 status를 pending으로 초기화
for n in wf['nodes']:
  n['status'] = 'pending'
  n['output_artifact'] = None
  n.setdefault('retry_count', 0)
with open(sys.argv[2], 'w') as f:
  json.dump(wf, f, indent=2, ensure_ascii=False)
" "$DAG_FILE" "$COMPANY_DIR/state/workflows/${WF_ID}.json" "$USER_REQUEST"
  echo ""
  echo "  ✅ DAG 워크플로우 등록: $WF_ID"
  echo "  📋 user_request: $USER_REQUEST"
  echo "  📁 state: $COMPANY_DIR/state/workflows/${WF_ID}.json"
  echo "  ⏳ dag-scheduler가 의존성 해결되는 노드부터 자동 실행합니다"
  echo ""
  exit 0
fi

TASK="$*"

# ━━━ 인자 없으면 대화형 intake ━━━
if [ -z "$TASK" ]; then
  BOLD='\033[1m'
  CYAN='\033[1;36m'
  DIM='\033[2m'
  NC='\033[0m'

  echo ""
  echo -e "  ${BOLD}Virtual Company — 새 태스크${NC}"
  echo ""

  # 1. 제목
  printf "  ${CYAN}무엇을 해야 하나요?${NC}\n  > "
  read -r TASK
  if [ -z "$(echo "$TASK" | tr -d '[:space:]')" ]; then
    echo "  취소됨"
    exit 0
  fi

  # 2. 종류
  echo ""
  echo -e "  ${CYAN}어떤 종류인가요?${NC}"
  echo "    1) 새 기능     2) 버그 수정"
  echo "    3) 리팩토링    4) 디자인"
  printf "  선택 [1]: "
  read -r _type_num
  case "$_type_num" in
    2) _type="bugfix"; _label="bug" ;;
    3) _type="refactor"; _label="refactor" ;;
    4) _type="design"; _label="design" ;;
    *) _type="feature"; _label="feature" ;;
  esac

  # 3. 우선순위
  echo ""
  echo -e "  ${CYAN}우선순위는?${NC}"
  echo "    1) Critical   2) High"
  echo "    3) Medium     4) Low"
  printf "  선택 [3]: "
  read -r _pri_num
  case "$_pri_num" in
    1) _priority="critical" ;;
    2) _priority="high" ;;
    4) _priority="low" ;;
    *) _priority="medium" ;;
  esac

  # 4. 완료 기준
  echo ""
  echo -e "  ${CYAN}완료 기준 (빈 줄로 종료, 없으면 Enter):${NC}"
  _ac_list=""
  while true; do
    printf "  - "
    read -r _ac_line
    [ -z "$_ac_line" ] && break
    _ac_list="${_ac_list}${_ac_line}\n"
  done

  # 5. 설명 (선택)
  echo ""
  printf "  ${CYAN}추가 설명 (없으면 Enter):${NC}\n  > "
  read -r _description

  # ━━━ 티켓 생성 (대시보드 서버 API 호출) ━━━
  _ac_json="[]"
  if [ -n "$_ac_list" ]; then
    _ac_json=$(printf '%b' "$_ac_list" | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" 2>/dev/null || echo "[]")
  fi

  DASHBOARD_PORT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$COMPANY_DIR/config.json" 2>/dev/null || echo 7777)
  PROJECT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$COMPANY_DIR/config.json" 2>/dev/null)
  _token=$(curl -s "http://localhost:${DASHBOARD_PORT}/api/token" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

  _ticket_result=""
  if [ -n "$_token" ] && [ -n "$PROJECT_ID" ]; then
    _ticket_body=$(python3 -c "
import json, sys
body = {
    'title': sys.argv[1],
    'type': sys.argv[6],
    'priority': sys.argv[2],
    'labels': [sys.argv[3]],
    'description': sys.argv[4],
    'acceptance_criteria': json.loads(sys.argv[5]),
    'created_by': 'user',
}
print(json.dumps(body, ensure_ascii=False))
" "$TASK" "$_priority" "$_label" "${_description:-}" "$_ac_json" "$_type" 2>/dev/null)

    _ticket_result=$(curl -s -X POST "http://localhost:${DASHBOARD_PORT}/api/${PROJECT_ID}/tickets" \
      -H "Content-Type: application/json" \
      -H "X-Token: $_token" \
      -d "$_ticket_body" 2>/dev/null)

    _ticket_id=$(echo "$_ticket_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  fi

  # 티켓 ID가 있으면 태스크에 포함
  if [ -n "$_ticket_id" ]; then
    TASK="[TICKET:${_ticket_id}] [${_priority}] ${TASK}"
    echo ""
    echo -e "  ${BOLD}📋 티켓 생성: ${_ticket_id}${NC}"
  fi

  echo ""
fi

# 빈 공백만 있는 태스크 검증
TASK_TRIMMED=$(echo "$TASK" | tr -d '[:space:]')
if [ -z "$TASK_TRIMMED" ]; then
  echo "  오류: 태스크 내용이 비어있습니다"
  exit 1
fi

# 길이 경고
TASK_LEN=$(printf '%s' "$TASK" | wc -c | tr -d ' ')
if [ "$TASK_LEN" -gt 2000 ]; then
  echo "  경고: 태스크가 매우 깁니다 (${TASK_LEN}자). 핵심 내용만 전달하는 것을 권장합니다."
fi

INBOX="$COMPANY_DIR/inbox/orch.md"
CHANNEL="$COMPANY_DIR/channel/general.md"
TS=$(date '+%H:%M:%S')

# task_id 생성 (타임스탬프 기반)
TASK_ID="task_$(date +%s)_$$"
TASKS_DIR="$COMPANY_DIR/state/tasks"
mkdir -p "$TASKS_DIR"
printf '{"id":"%s","status":"created","created_at":"%s","task":"%s"}\n' \
  "$TASK_ID" "$(date '+%Y-%m-%d %H:%M:%S')" "$(printf '%s' "$TASK" | sed 's/"/\\"/g' | head -c 200)" \
  > "$TASKS_DIR/${TASK_ID}.json"
# 현재 태스크 ID 기록 (run-agent.sh, router.sh가 status 갱신 시 참조)
echo "$TASK_ID" > "$COMPANY_DIR/state/current_task.txt"

# config에서 세션명 읽기
SESSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['session_name'])" "$COMPANY_DIR/config.json" 2>/dev/null || echo "company")

# 채널에 태스크 시작 공지
printf '\n[%s] 🚀 새 태스크: %s\n' "$TS" "$TASK" >> "$CHANNEL"

# Orchestrator inbox에 전달 (atomic mkdir lock으로 동시 쓰기 보호)
_lockdir="${INBOX}.lock.d"
_waited=0
while ! mkdir "$_lockdir" 2>/dev/null; do
  sleep 0.1
  _waited=$((_waited + 1))
  [ $_waited -gt 50 ] && break
done
_kickoff_tmp="${INBOX}.kickoff.$$"
if [ -s "$INBOX" ]; then
  cp "$INBOX" "$_kickoff_tmp"
else
  > "$_kickoff_tmp"
fi
printf '\n[TEAM-TASK from:human time:%s]\n%s\n' "$TS" "$TASK" >> "$_kickoff_tmp"
mv "$_kickoff_tmp" "$INBOX"
rmdir "$_lockdir" 2>/dev/null

echo ""
echo "  ✅ Orchestrator에게 태스크 전달 완료"
echo "  🆔 태스크: $TASK_ID"
echo "  📋 내용: $TASK"
echo "  📺 모니터: tmux attach -t $SESSION"
echo ""

# --watch 모드: 자동으로 모니터 실행
if [ "$WATCH_MODE" = true ]; then
  echo "  👀 모니터 모드 진입..."
  exec bash "$COMPANY_DIR/monitor.sh"
fi
