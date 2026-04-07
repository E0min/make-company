#!/usr/bin/env bash
# Human Veto: 특정 에이전트 inbox에 사용자 지시 주입

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
  echo "  사용법: inject.sh <agent_id> '주입할 메시지'"
  echo "  예시:   inject.sh pm '이 PRD에 모바일 시나리오 추가해주세요'"
  exit 1
fi

AGENT_ID="$1"
shift
MSG="$*"

INBOX="$COMPANY_DIR/inbox/${AGENT_ID}.md"

if [ ! -f "$INBOX" ]; then
  echo "  오류: 에이전트 inbox 없음: $INBOX"
  exit 1
fi

# atomic lock으로 동시 쓰기 보호
_lockdir="${INBOX}.lock.d"
_waited=0
while ! mkdir "$_lockdir" 2>/dev/null; do
  sleep 0.1
  _waited=$((_waited + 1))
  [ $_waited -gt 50 ] && break
done

TS=$(date '+%H:%M:%S')
printf '\n[HUMAN-INJECTION time:%s]\n%s\n' "$TS" "$MSG" >> "$INBOX"
rmdir "$_lockdir" 2>/dev/null

echo "  ✅ $AGENT_ID 에 사용자 지시 주입 완료"
echo "  📋 메시지: $MSG"
echo ""
echo "  resume.sh로 재개하면 에이전트가 처리합니다."
