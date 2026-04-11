#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# agent-create-harness.sh — PostToolUse 하네스
#
# Write tool로 .claude/agents/*.md 파일이 생성/수정될 때 자동 실행.
#
# 하는 일:
# 1. 에이전트 .md 파일 구조 검증 (필수 필드 체크)
# 2. config.json에 자동 등록 (agents 배열 + role_map)
# 3. agent-memory 파일 자동 생성
# 4. 워크플로우 핸드오프 규칙 자동 제안
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

# Write 또는 Edit으로 agents/ 디렉토리에 .md 파일이 생성/수정된 경우만
[ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ] && exit 0

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('tool_input', {}).get('file_path', ''))
except:
    print('')
" 2>/dev/null || echo "")

# .claude/agents/*.md 파일인지 확인
echo "$FILE_PATH" | grep -q '\.claude/agents/.*\.md$' || exit 0

# company 디렉토리 찾기
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

AGENT_FILE="$FILE_PATH"
AGENT_ID=$(basename "$AGENT_FILE" .md)
CONFIG_FILE="$COMPANY_DIR/config.json"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ━━━ 1. 에이전트 .md 구조 검증 ━━━
VALIDATION=$(python3 -c "
import json, sys

agent_file = '$AGENT_FILE'
agent_id = '$AGENT_ID'

try:
    with open(agent_file) as f:
        content = f.read()
except:
    print(json.dumps({'valid': False, 'errors': ['파일을 읽을 수 없습니다']}))
    sys.exit(0)

errors = []
warnings = []

# 필수 1: YAML frontmatter
if not content.startswith('---'):
    errors.append('YAML frontmatter 없음 (--- 로 시작해야 함)')
else:
    end = content.find('---', 3)
    if end < 0:
        errors.append('YAML frontmatter 닫는 --- 없음')
    else:
        fm = content[3:end]
        # 필수 필드 체크
        for field in ['name', 'description', 'category']:
            if field + ':' not in fm:
                errors.append(f'frontmatter에 {field} 필드 없음')

        # category 값 추출
        for line in fm.split('\n'):
            if line.strip().startswith('category:'):
                cat = line.split(':', 1)[1].strip()
                valid_cats = ['engineering', 'qa', 'product', 'design', 'marketing', 'leadership', 'data', 'devops', 'general']
                if cat not in valid_cats:
                    warnings.append(f'category \"{cat}\"가 표준 목록에 없음. 표준: {valid_cats}')

# 필수 2: 플레이스홀더
if '{{project_context}}' not in content:
    errors.append('{{project_context}} 플레이스홀더 없음')
if '{{agent_memory}}' not in content:
    errors.append('{{agent_memory}} 플레이스홀더 없음')

# 필수 3: 핵심 원칙 섹션
if '## 핵심 원칙' not in content and '## Core Principles' not in content and '## Role' not in content:
    warnings.append('핵심 원칙/역할 정의 섹션 권장')

result = {
    'valid': len(errors) == 0,
    'errors': errors,
    'warnings': warnings,
    'agent_id': agent_id,
}
print(json.dumps(result, ensure_ascii=False))
" 2>/dev/null)

if [ -n "$VALIDATION" ]; then
  IS_VALID=$(echo "$VALIDATION" | python3 -c "import sys,json; print(json.load(sys.stdin)['valid'])" 2>/dev/null)
  ERRORS=$(echo "$VALIDATION" | python3 -c "import sys,json; e=json.load(sys.stdin)['errors']; print(' | '.join(e))" 2>/dev/null)
  WARNINGS=$(echo "$VALIDATION" | python3 -c "import sys,json; w=json.load(sys.stdin)['warnings']; print(' | '.join(w))" 2>/dev/null)

  if [ "$IS_VALID" = "False" ]; then
    echo "[하네스:에이전트생성] $AGENT_ID 검증 실패: $ERRORS"
    echo "[하네스:에이전트생성] 필수 구조: YAML frontmatter(name,description,category) + {{project_context}} + {{agent_memory}}"
    echo "{\"event\":\"agent_create_invalid\",\"agent\":\"$AGENT_ID\",\"errors\":\"$ERRORS\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$COMPANY_DIR/activity.jsonl" 2>/dev/null
    exit 0
  fi

  if [ -n "$WARNINGS" ]; then
    echo "[하네스:에이전트생성] $AGENT_ID 경고: $WARNINGS"
  fi
fi

# ━━━ 2. config.json에 자동 등록 ━━━
python3 -c "
import json

config_path = '$CONFIG_FILE'
agent_id = '$AGENT_ID'
agent_file = '$AGENT_FILE'

with open(config_path) as f:
    config = json.load(f)

changed = False

# agents 배열에 추가
if agent_id not in config.get('agents', []):
    config.setdefault('agents', []).append(agent_id)
    config['agents'].sort()
    changed = True
    print(f'[하네스:에이전트생성] {agent_id}를 config.json agents에 등록했습니다.')

# agent_role_map에 추가 (category 기반 자동 매핑)
role_map = config.setdefault('agent_role_map', {})
if agent_id not in role_map:
    # category에서 role_type 추론
    with open(agent_file) as f:
        content = f.read()
    category = 'general'
    if '---' in content:
        fm = content.split('---')[1]
        for line in fm.split('\n'):
            if line.strip().startswith('category:'):
                category = line.split(':', 1)[1].strip()

    cat_to_role = {
        'engineering': 'engineer',
        'qa': 'qa',
        'product': 'planner',
        'design': 'creative',
        'marketing': 'creative',
        'leadership': 'planner',
        'data': 'engineer',
        'devops': 'engineer',
    }
    role = cat_to_role.get(category, '_default')
    role_map[agent_id] = role
    changed = True
    print(f'[하네스:에이전트생성] {agent_id} → 역할 타입 \"{role}\" (category: {category})')

if changed:
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write('\n')
" 2>/dev/null

# ━━━ 3. agent-memory 파일 자동 생성 ━━━
MEMORY_FILE="$COMPANY_DIR/agent-memory/$AGENT_ID.md"
if [ ! -f "$MEMORY_FILE" ]; then
  mkdir -p "$COMPANY_DIR/agent-memory"
  touch "$MEMORY_FILE"
  echo "[하네스:에이전트생성] $AGENT_ID 메모리 파일 생성: $MEMORY_FILE"
fi

# ━━━ 4. agent-output 파일 자동 생성 ━━━
OUTPUT_FILE="$COMPANY_DIR/agent-output/$AGENT_ID.log"
if [ ! -f "$OUTPUT_FILE" ]; then
  mkdir -p "$COMPANY_DIR/agent-output"
  touch "$OUTPUT_FILE"
fi

# ━━━ 5. 워크플로우 핸드오프 제안 ━━━
python3 -c "
import json

config_path = '$CONFIG_FILE'
agent_id = '$AGENT_ID'

with open(config_path) as f:
    config = json.load(f)

role_map = config.get('agent_role_map', {})
role = role_map.get(agent_id, '_default')
agents = config.get('agents', [])

# 역할 기반 핸드오프 추천
handoff_suggestions = {
    'engineer': {
        'receives_from': ['planner', 'creative'],
        'sends_to': ['qa'],
        'desc': '기획/디자인 → 이 에이전트 → QA'
    },
    'qa': {
        'receives_from': ['engineer'],
        'sends_to': ['engineer'],
        'desc': '엔지니어 → 이 에이전트(검증) → 엔지니어(수정)'
    },
    'planner': {
        'receives_from': [],
        'sends_to': ['engineer', 'creative'],
        'desc': '사용자 요청 → 이 에이전트(기획) → 엔지니어/디자이너'
    },
    'creative': {
        'receives_from': ['planner'],
        'sends_to': ['engineer'],
        'desc': '기획 → 이 에이전트(디자인) → 엔지니어'
    },
}

suggestion = handoff_suggestions.get(role, {})
if suggestion:
    # 실제 에이전트 이름으로 매핑
    from_agents = [a for a, r in role_map.items() if r in suggestion.get('receives_from', []) and a != agent_id]
    to_agents = [a for a, r in role_map.items() if r in suggestion.get('sends_to', []) and a != agent_id]

    if from_agents or to_agents:
        parts = []
        if from_agents:
            parts.append(f'입력: {\" → \".join(from_agents)}')
        parts.append(f'{agent_id}')
        if to_agents:
            parts.append(f'출력: {\" → \".join(to_agents)}')
        print(f'[하네스:워크플로우] {agent_id} 핸드오프 제안: {\" → \".join(parts)}')
        print(f'[하네스:워크플로우] 패턴: {suggestion[\"desc\"]}')
" 2>/dev/null

# JSONL 이벤트
echo "{\"event\":\"agent_created\",\"agent\":\"$AGENT_ID\",\"ts\":\"$TS\",\"source\":\"harness\"}" >> "$COMPANY_DIR/activity.jsonl" 2>/dev/null

exit 0
