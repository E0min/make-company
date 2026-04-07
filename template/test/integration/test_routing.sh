#!/usr/bin/env bash
# Smoke Test: kickoff → orch → @pm 라우팅
set -e
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEST_NAME="test_routing"

cleanup() {
  bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
}
trap cleanup EXIT

# 1. clean state로 시작
bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
sleep 1
bash "$COMPANY_DIR/run.sh" >/dev/null 2>&1

# 2. 에이전트 init 대기
sleep 35

# 3. 모든 Claude 에이전트가 idle인지 확인
for agent in orch pm; do
  state=$(cat "$COMPANY_DIR/state/${agent}.state" 2>/dev/null | awk '{print $1}')
  if [ "$state" != "idle" ]; then
    echo "FAIL: $agent state=$state (expected idle)"
    exit 1
  fi
done

# 4. kickoff
bash "$COMPANY_DIR/kickoff.sh" '@pm 라우팅 테스트입니다. "ROUTING-OK" 한 단어로만 응답해주세요.' >/dev/null

# 5. 라우팅 확인 (최대 90초 대기)
waited=0
while [ $waited -lt 90 ]; do
  if grep -q "orch -> @pm" "$COMPANY_DIR/logs/router.log" 2>/dev/null; then
    echo "PASS: $TEST_NAME — orch → @pm 라우팅 확인"
    exit 0
  fi
  sleep 5
  waited=$((waited + 5))
done

echo "FAIL: $TEST_NAME — 라우팅 타임아웃 (90초)"
exit 1
