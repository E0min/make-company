#!/usr/bin/env bash
# 가상 회사 초기 설정 — 프로젝트명, 세션명, 에이전트 구성

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$COMPANY_DIR/config.json"

BOLD='\033[1m'
CYAN='\033[1;36m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}Virtual Company Setup${NC}"
echo ""

# 1. 프로젝트(회사) 이름
current_project="MindLink"
[ -f "$CONFIG" ] && current_project=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project','MindLink'))" "$CONFIG" 2>/dev/null)

printf "  회사(프로젝트) 이름 [%s]: " "$current_project"
read -r input_project
PROJECT="${input_project:-$current_project}"

# 2. tmux 세션 이름
default_session=$(echo "$PROJECT" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"-company"
current_session="$default_session"
[ -f "$CONFIG" ] && current_session=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('session_name',sys.argv[2]))" "$CONFIG" "$default_session" 2>/dev/null)

printf "  tmux 세션 이름 [%s]: " "$current_session"
read -r input_session
SESSION="${input_session:-$current_session}"

# 3. compact 임계치
current_threshold=50
[ -f "$CONFIG" ] && current_threshold=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('compact_threshold',50))" "$CONFIG" 2>/dev/null)

printf "  auto-compact 임계치 (%%) [%s]: " "$current_threshold"
read -r input_threshold
THRESHOLD="${input_threshold:-$current_threshold}"

# 4. 에이전트 구성
echo ""
echo -e "  ${BOLD}에이전트 구성${NC}"
echo -e "  ${DIM}기본 9명 (orch/pm/design/frontend/fe-qa/backend/be-qa/marketing/gemini)${NC}"
echo -e "  ${DIM}변경하려면 setup 후 config.json의 agents 배열을 직접 수정하세요${NC}"
echo ""

# config.json 생성/업데이트
if [ -f "$CONFIG" ]; then
  # 기존 config에서 agents 유지, 나머지만 업데이트
  python3 - "$CONFIG" "$PROJECT" "$SESSION" "$THRESHOLD" << 'PYEOF'
import json, sys

config_path, project, session, threshold = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

with open(config_path) as f:
    config = json.load(f)

config["project"] = project
config["session_name"] = session
config["compact_threshold"] = threshold

with open(config_path, "w") as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF
else
  # 새 config 생성
  python3 - "$CONFIG" "$PROJECT" "$SESSION" "$THRESHOLD" << 'PYEOF'
import json, sys

config_path, project, session, threshold = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

config = {
    "project": project,
    "session_name": session,
    "compact_threshold": threshold,
    "cost_limit_tokens": 200000,
    "cost_warning_tokens": 150000,
    "skill_index_refresh_interval": 300,
    "knowledge_inject": True,
    "critic_loop": {},
    "dashboard_port": 7777,
    "agents": [
        {"id": "orch",     "engine": "claude", "agent_file": "ceo",                "label": "Orch", "protected": True},
        {"id": "pm",       "engine": "claude", "agent_file": "product-manager",    "label": "PM"},
        {"id": "design",   "engine": "claude", "agent_file": "ui-ux-designer",     "label": "Design"},
        {"id": "frontend", "engine": "claude", "agent_file": "frontend-engineer",  "label": "Frontend"},
        {"id": "fe-qa",    "engine": "claude", "agent_file": "fe-qa",             "label": "FE-QA"},
        {"id": "backend",  "engine": "claude", "agent_file": "backend-engineer",   "label": "Backend"},
        {"id": "be-qa",    "engine": "claude", "agent_file": "be-qa",             "label": "BE-QA"},
        {"id": "marketing","engine": "claude", "agent_file": "marketing-strategist","label": "Marketing"},
        {"id": "gemini",   "engine": "gemini", "agent_file": "",                   "label": "Gemini"}
    ]
}

with open(config_path, "w") as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF
fi

echo -e "  ${CYAN}config.json 저장 완료${NC}"
echo ""
echo -e "  회사:    ${BOLD}$PROJECT${NC}"
echo -e "  세션:    ${BOLD}$SESSION${NC}"
echo -e "  compact: ${BOLD}${THRESHOLD}%${NC}"
echo ""
echo -e "  시작: ${CYAN}bash .claude/company/run.sh${NC}"
echo ""
