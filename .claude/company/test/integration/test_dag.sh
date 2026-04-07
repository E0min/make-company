#!/usr/bin/env bash
# Smoke Test: DAG MVP — 의존성 스케줄링 + 변수 치환
set -e
COMPANY_DIR="${COMPANY_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
TEST_NAME="test_dag"

cleanup() {
  bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
}
trap cleanup EXIT

bash "$COMPANY_DIR/stop.sh" 2>/dev/null || true
sleep 1
bash "$COMPANY_DIR/run.sh" >/dev/null 2>&1
sleep 35

# 단순 워크플로우 작성
mkdir -p "$COMPANY_DIR/workflows"
cat > "$COMPANY_DIR/workflows/test-dag.json" << 'EOF'
{
  "workflow_id": "wf_test_dag",
  "title": "DAG MVP 테스트",
  "status": "pending",
  "nodes": [
    {
      "id": "n1",
      "agent": "pm",
      "input_template": "한 줄 응답: TEST-{{user_request}}",
      "depends_on": [],
      "status": "pending",
      "on_failure": "manual"
    },
    {
      "id": "n2",
      "agent": "design",
      "input_template": "이전 노드 응답을 그대로 따라하세요",
      "depends_on": ["n1"],
      "status": "pending",
      "on_failure": "manual"
    }
  ]
}
EOF

# DAG 실행
bash "$COMPANY_DIR/kickoff.sh" --dag "$COMPANY_DIR/workflows/test-dag.json" "DAG-OK" >/dev/null

# 두 노드 모두 done이 될 때까지 대기 (최대 200초)
waited=0
while [ $waited -lt 200 ]; do
  if [ -f "$COMPANY_DIR/state/workflows/wf_test_dag.json" ]; then
    n1_status=$(python3 -c "import json; d=json.load(open('$COMPANY_DIR/state/workflows/wf_test_dag.json')); print([n['status'] for n in d['nodes'] if n['id']=='n1'][0])" 2>/dev/null || echo "")
    n2_status=$(python3 -c "import json; d=json.load(open('$COMPANY_DIR/state/workflows/wf_test_dag.json')); print([n['status'] for n in d['nodes'] if n['id']=='n2'][0])" 2>/dev/null || echo "")
    if [ "$n1_status" = "done" ] && [ "$n2_status" = "done" ]; then
      echo "PASS: $TEST_NAME — n1, n2 순차 실행 완료"
      exit 0
    fi
  fi
  sleep 5
  waited=$((waited + 5))
done

echo "FAIL: $TEST_NAME — DAG 노드 완료 안 됨 (n1=$n1_status, n2=$n2_status)"
exit 1
