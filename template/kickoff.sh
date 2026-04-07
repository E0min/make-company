#!/usr/bin/env bash
# Orchestrator에게 태스크를 전달하여 가상 회사 워크플로우를 시작

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

# --watch 모드 감지
WATCH_MODE=false
if [ "$1" = "--watch" ]; then
  WATCH_MODE=true
  shift
fi

TASK="$*"

if [ -z "$TASK" ]; then
  echo ""
  echo "  사용법: kickoff.sh '태스크 내용'"
  echo ""
  echo "  예시:"
  echo "    kickoff.sh '사용자가 노드에 태그를 달 수 있는 기능을 추가해줘'"
  echo "    kickoff.sh '그래프 성능이 노드 100개 이상에서 느려지는 버그 수정해줘'"
  echo "    kickoff.sh '다크모드 디자인 개선해줘'"
  echo ""
  exit 1
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
