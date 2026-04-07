#!/usr/bin/env bash
# Smoke Test: 동시 2 kickoff → 두 메시지 모두 inbox에 도착
set -e
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEST_NAME="test_lock"

cleanup() {
  bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
}
trap cleanup EXIT

bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
sleep 1
bash "$COMPANY_DIR/run.sh" >/dev/null 2>&1
sleep 35

# 동시 2개 kickoff (atomic lock 검증)
bash "$COMPANY_DIR/kickoff.sh" '@pm LOCK-TEST-1' >/dev/null &
bash "$COMPANY_DIR/kickoff.sh" '@pm LOCK-TEST-2' >/dev/null &
wait

# 두 메시지 모두 inbox에 도착했는지 (중간에 손상 없어야 함)
sleep 2
inbox_content=$(cat "$COMPANY_DIR/inbox/orch.md" 2>/dev/null || echo "")

if echo "$inbox_content" | grep -q "LOCK-TEST-1" && echo "$inbox_content" | grep -q "LOCK-TEST-2"; then
  echo "PASS: $TEST_NAME — 동시 쓰기 두 메시지 모두 보존"
  exit 0
fi

echo "FAIL: $TEST_NAME — 메시지 손실 또는 손상"
echo "inbox 내용:"
echo "$inbox_content" | head -20
exit 1
