#!/usr/bin/env bash
# 전체 Smoke Test 실행 + PASS/FAIL 리포트
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
export COMPANY_DIR

BOLD='\033[1m'
GREEN='\033[1;32m'
RED='\033[1;31m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}Virtual Company Smoke Tests${NC}"
echo -e "  ${DIM}대상: $COMPANY_DIR${NC}"
echo ""

PASS=0
FAIL=0
FAILED_TESTS=""

# 우선순위 순 실행 (빠른 것부터)
for test in test_routing test_lock test_knowledge test_critic test_dag; do
  testfile="$TEST_DIR/integration/${test}.sh"
  if [ ! -f "$testfile" ]; then
    echo -e "  ${DIM}SKIP: $test (파일 없음)${NC}"
    continue
  fi
  echo -e "  ▶ Running ${BOLD}$test${NC}..."
  if bash "$testfile" 2>&1 | tail -3; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS="$FAILED_TESTS $test"
  fi
  echo ""
done

echo ""
echo -e "  ${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}결과:${NC} ${GREEN}PASS=$PASS${NC} ${RED}FAIL=$FAIL${NC}"
if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}실패한 테스트:$FAILED_TESTS${NC}"
  exit 1
fi
echo -e "  ${GREEN}✅ 모든 테스트 통과${NC}"
exit 0
