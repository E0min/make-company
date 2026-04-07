#!/usr/bin/env bash
# Smoke Test: critic_loop 매핑 → 검증 라우팅 동작
set -e
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEST_NAME="test_critic"

cleanup() {
  # config 복원
  [ -f "$COMPANY_DIR/config.json.bak" ] && mv "$COMPANY_DIR/config.json.bak" "$COMPANY_DIR/config.json"
  bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
}
trap cleanup EXIT

bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
sleep 1

# config에 critic_loop 추가 (백업 후)
cp "$COMPANY_DIR/config.json" "$COMPANY_DIR/config.json.bak"
python3 -c "
import json
c = json.load(open('$COMPANY_DIR/config.json'))
c['critic_loop'] = {'pm': 'orch'}
json.dump(c, open('$COMPANY_DIR/config.json', 'w'), indent=2, ensure_ascii=False)
"

bash "$COMPANY_DIR/run.sh" >/dev/null 2>&1
sleep 35

# kickoff: orch가 pm에게 보내야 함
bash "$COMPANY_DIR/kickoff.sh" '@pm critic 테스트' >/dev/null

# CRITIC 로그 확인
waited=0
while [ $waited -lt 90 ]; do
  if grep -q "CRITIC:" "$COMPANY_DIR/logs/router.log" 2>/dev/null; then
    echo "PASS: $TEST_NAME — Critic Loop 라우팅 발생"
    exit 0
  fi
  sleep 5
  waited=$((waited + 5))
done

echo "FAIL: $TEST_NAME — CRITIC 로그 없음 (라우팅이 critic을 거치지 않음)"
exit 1
