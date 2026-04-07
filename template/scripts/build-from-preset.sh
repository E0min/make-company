#!/usr/bin/env bash
# 프리셋 → config.json 빌더 + .claude/agents/*.md 복사
# 사용법: build-from-preset.sh <preset_name> <company_dir> <agents_dir>
#   preset_name: web-design-agency, it-startup, ...
#   company_dir: .claude/company/ 경로
#   agents_dir:  .claude/agents/ 경로 (Claude Code 에이전트 정의)

set -e

PRESET="$1"
COMPANY_DIR="$2"
AGENTS_DIR="$3"
TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$PRESET" ] || [ -z "$COMPANY_DIR" ] || [ -z "$AGENTS_DIR" ]; then
  echo "usage: build-from-preset.sh <preset> <company_dir> <agents_dir>"
  exit 1
fi

PRESET_FILE="$TEMPLATE_DIR/presets/${PRESET}.json"
LIBRARY_DIR="$TEMPLATE_DIR/agents-library"

if [ ! -f "$PRESET_FILE" ]; then
  echo "  오류: 프리셋을 찾을 수 없습니다: $PRESET_FILE"
  exit 1
fi

echo "  프리셋 로드: $(python3 -c "import json,sys; p=json.load(open(sys.argv[1])); print(p.get('icon',''), p.get('name','?'))" "$PRESET_FILE")"

mkdir -p "$AGENTS_DIR"
mkdir -p "$COMPANY_DIR"

# Python으로 프리셋 처리 (jq 없이)
python3 - "$PRESET_FILE" "$LIBRARY_DIR" "$AGENTS_DIR" "$COMPANY_DIR" << 'PYEOF'
import json, os, sys, re

preset_file, library_dir, agents_dir, company_dir = sys.argv[1:5]

with open(preset_file) as f:
    preset = json.load(f)

def parse_frontmatter(md_text):
    """간단한 frontmatter 파서"""
    if not md_text.startswith('---'):
        return {}, md_text
    end = md_text.find('---', 3)
    if end == -1:
        return {}, md_text
    fm_text = md_text[3:end].strip()
    body = md_text[end+3:].lstrip('\n')
    meta = {}
    cur_key = None
    for line in fm_text.split('\n'):
        if ':' in line and not line.startswith(' '):
            k, _, v = line.partition(':')
            meta[k.strip()] = v.strip()
            cur_key = k.strip()
    return meta, body

agents_config = []
copied_files = []

for ag in preset.get('agents', []):
    lib_path = ag['library_path']
    aid = ag['id']
    src_md = os.path.join(library_dir, f"{lib_path}.md")
    if not os.path.exists(src_md):
        print(f"  ⚠ 라이브러리 파일 없음: {src_md}")
        continue

    with open(src_md) as f:
        md_text = f.read()
    meta, body = parse_frontmatter(md_text)

    # agent_file은 id 기반 (충돌 방지)
    agent_file = ag.get('agent_file', aid)
    dst_md = os.path.join(agents_dir, f"{agent_file}.md")
    # 사용자가 이미 만들었으면 보존
    if not os.path.exists(dst_md):
        with open(dst_md, 'w', encoding='utf-8') as f:
            f.write(md_text)
        copied_files.append(agent_file)

    # default_skills 파싱 (frontmatter가 [a, b, c] 형식)
    default_skills_str = meta.get('default_skills', '')
    skills = []
    if default_skills_str:
        m = re.match(r'^\[(.*)\]$', default_skills_str.strip())
        if m:
            skills = [s.strip() for s in m.group(1).split(',') if s.strip()]

    label = ag.get('label', meta.get('default_label', aid))
    engine = ag.get('engine', 'claude')

    agents_config.append({
        "id": aid,
        "engine": engine,
        "agent_file": agent_file,
        "label": label,
        "protected": ag.get('protected', False),
        "assigned_skills": skills,
    })

# config.json 생성/병합
config_path = os.path.join(company_dir, 'config.json')
if os.path.exists(config_path):
    try:
        with open(config_path) as f:
            config = json.load(f)
    except:
        config = {}
else:
    config = {}

# 기본값 채우기
config.setdefault('project', 'MyProject')
config.setdefault('session_name', 'myproject-company')
config.setdefault('compact_threshold', 50)
config.setdefault('cost_limit_tokens', 200000)
config.setdefault('cost_warning_tokens', 150000)
config.setdefault('skill_index_refresh_interval', 300)
config.setdefault('knowledge_inject', True)
config.setdefault('critic_loop', {})
config.setdefault('dashboard_port', 7777)
config.setdefault('dashboard_auto_open', True)
config['preset'] = preset['id']
config['agents'] = agents_config

with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f"  ✓ 에이전트 {len(agents_config)}명 구성")
for a in agents_config:
    skills_count = len(a['assigned_skills'])
    print(f"    - {a['label']:14} ({a['id']:12}) {a['engine']:6} skills={skills_count}")
print(f"  ✓ .claude/agents/ 에 {len(copied_files)}개 .md 복사")
print(f"  ✓ config.json 저장: {config_path}")
PYEOF
