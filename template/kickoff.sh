#!/usr/bin/env bash
# Orchestrator에게 태스크를 전달하여 가상 회사 워크플로우를 시작

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
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

INBOX="$COMPANY_DIR/inbox/orch.md"
CHANNEL="$COMPANY_DIR/channel/general.md"
TS=$(date '+%H:%M:%S')

# 채널에 태스크 시작 공지
printf '\n[%s] 🚀 새 태스크: %s\n' "$TS" "$TASK" >> "$CHANNEL"

# Orchestrator inbox에 전달
cat >> "$INBOX" << MSG

---
FROM: human
TIME: $TS
---
$TASK
MSG

echo ""
echo "  ✅ Orchestrator에게 태스크 전달 완료"
echo "  📋 태스크: $TASK"
echo "  📺 모니터: tmux attach -t mindlink-company"
echo ""
