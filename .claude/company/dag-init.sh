#!/usr/bin/env bash
# 인터랙티브 DAG 워크플로우 생성기

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOWS_DIR="$COMPANY_DIR/workflows"
mkdir -p "$WORKFLOWS_DIR"

BOLD='\033[1m'
CYAN='\033[1;36m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}DAG Workflow Init${NC}"
echo ""

printf "  워크플로우 이름 (예: feature-auth): "
read -r WF_NAME
[ -z "$WF_NAME" ] && WF_NAME="workflow-$(date +%s)"

printf "  제목 (한국어): "
read -r WF_TITLE
[ -z "$WF_TITLE" ] && WF_TITLE="$WF_NAME"

printf "  에이전트 순서 (콤마 구분, 예: pm,design,frontend,fe-qa): "
read -r AGENTS

if [ -z "$AGENTS" ]; then
  echo "  오류: 에이전트가 필요합니다"
  exit 1
fi

printf "  직렬로 자동 연결할까요? [Y/n]: "
read -r SERIAL
[ "$SERIAL" != "n" ] && [ "$SERIAL" != "N" ] && SERIAL="y"

OUT="$WORKFLOWS_DIR/${WF_NAME}.json"

python3 -c "
import json, sys
agents = [a.strip() for a in sys.argv[1].split(',')]
serial = sys.argv[2] == 'y'
nodes = []
for i, agent in enumerate(agents):
    node = {
        'id': f'n{i+1}',
        'agent': agent,
        'input_template': '{{user_request}}' if i == 0 else '이전 노드 결과: {{n' + str(i) + '.output_artifact}}',
        'depends_on': [f'n{i}'] if (serial and i > 0) else [],
        'status': 'pending',
        'output_artifact': None,
        'retry_count': 0,
        'on_failure': 'manual'
    }
    nodes.append(node)
wf = {
    'workflow_id': 'wf_' + sys.argv[3],
    'title': sys.argv[4],
    'status': 'pending',
    'nodes': nodes
}
with open(sys.argv[5], 'w') as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)
" "$AGENTS" "$SERIAL" "$WF_NAME" "$WF_TITLE" "$OUT"

echo ""
echo -e "  ${CYAN}✅ 생성됨: $OUT${NC}"
echo ""
echo "  사용:"
echo -e "    ${DIM}bash $COMPANY_DIR/kickoff.sh --dag $OUT '실제 요청'${NC}"
echo ""
echo "  편집:"
echo -e "    ${DIM}각 노드의 input_template을 수정하면 더 정교해집니다${NC}"
echo ""
