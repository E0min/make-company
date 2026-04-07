#!/usr/bin/env bash
# Smoke Test: KNOWLEDGE-WRITE 마커 → knowledge/ 자동 저장
set -e
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEST_NAME="test_knowledge"

cleanup() {
  bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
}
trap cleanup EXIT

bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
sleep 1
rm -f "$COMPANY_DIR/knowledge/decisions/test_kb_decision.md"
bash "$COMPANY_DIR/run.sh" >/dev/null 2>&1
sleep 35

# KNOWLEDGE-WRITE 마커 포함 응답 유도
bash "$COMPANY_DIR/kickoff.sh" '응답에 정확히 "[KNOWLEDGE-WRITE decisions/test_kb_decision.md]" 마커를 첫 줄로 포함하고, 다음 줄에 "테스트 의사결정 기록"이라고만 작성해주세요. 다른 내용 없이.' >/dev/null

# 파일 자동 생성 확인 (최대 120초)
waited=0
while [ $waited -lt 120 ]; do
  if [ -f "$COMPANY_DIR/knowledge/decisions/test_kb_decision.md" ]; then
    content=$(cat "$COMPANY_DIR/knowledge/decisions/test_kb_decision.md")
    if [ -n "$content" ]; then
      echo "PASS: $TEST_NAME — KNOWLEDGE-WRITE 마커 → 파일 자동 생성 ($content)"
      exit 0
    fi
  fi
  sleep 5
  waited=$((waited + 5))
done

echo "FAIL: $TEST_NAME — knowledge 파일 생성 안 됨"
exit 1
