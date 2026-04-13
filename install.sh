#!/usr/bin/env bash
# Virtual Company 설치 스크립트
# 현재 프로젝트의 .claude/company/에 템플릿을 복사하고 setup 실행

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"
TARGET_DIR="${1:-.claude/company}"

BOLD='\033[1m'
GREEN='\033[1;32m'
CYAN='\033[1;36m'
RED='\033[1;31m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}Virtual Company Installer${NC}"
echo ""

# 필수 도구 확인
for tool in tmux python3; do
  if ! command -v "$tool" &> /dev/null; then
    echo -e "  ${RED}오류: '$tool' 설치 필요${NC}"
    echo "  macOS: brew install $tool"
    echo "  Ubuntu: sudo apt install $tool"
    exit 1
  fi
done

# 템플릿 존재 확인
if [ ! -d "$TEMPLATE_DIR" ]; then
  echo -e "  ${RED}템플릿 디렉토리를 찾을 수 없습니다: $TEMPLATE_DIR${NC}"
  exit 1
fi

# 이미 설치됐는지 확인
if [ -f "$TARGET_DIR/config.json" ]; then
  echo -e "  ${CYAN}이미 설치됨: $TARGET_DIR${NC}"
  printf "  덮어쓰시겠습니까? (y/N): "
  read -r confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "  취소됨"
    exit 0
  fi
fi

# 디렉토리 생성
mkdir -p "$TARGET_DIR"/{agents,scripts,inbox,outbox,channel,logs,state,state/tasks,state/workflows,artifacts,workflows,test/integration,dashboard}

# 템플릿 복사 — 모든 스크립트 (template 구조와 1:1 대응)
cp "$TEMPLATE_DIR/run.sh"          "$TARGET_DIR/"
cp "$TEMPLATE_DIR/stop.sh"         "$TARGET_DIR/"
cp "$TEMPLATE_DIR/kickoff.sh"      "$TARGET_DIR/"
cp "$TEMPLATE_DIR/router.sh"       "$TARGET_DIR/"
cp "$TEMPLATE_DIR/monitor.sh"      "$TARGET_DIR/"
cp "$TEMPLATE_DIR/setup.sh"        "$TARGET_DIR/"
cp "$TEMPLATE_DIR/restart-agent.sh" "$TARGET_DIR/"
cp "$TEMPLATE_DIR/dag-scheduler.sh" "$TARGET_DIR/"
cp "$TEMPLATE_DIR/dag-init.sh"      "$TARGET_DIR/"
cp "$TEMPLATE_DIR/pause.sh"         "$TARGET_DIR/"
cp "$TEMPLATE_DIR/inject.sh"        "$TARGET_DIR/"
cp "$TEMPLATE_DIR/resume.sh"        "$TARGET_DIR/"
cp "$TEMPLATE_DIR/agents/run-agent.sh"  "$TARGET_DIR/agents/"
cp "$TEMPLATE_DIR/agents/run-gemini.sh" "$TARGET_DIR/agents/"
cp "$TEMPLATE_DIR/scripts/build-skill-index.sh"      "$TARGET_DIR/scripts/"
cp "$TEMPLATE_DIR/scripts/suggest-skills.sh"         "$TARGET_DIR/scripts/"
cp "$TEMPLATE_DIR/scripts/update-knowledge-index.sh" "$TARGET_DIR/scripts/"
cp "$TEMPLATE_DIR/scripts/build-from-preset.sh"      "$TARGET_DIR/scripts/"

# agents-library/ + presets/ 복사 (14차 — 회사 프리셋)
mkdir -p "$TARGET_DIR/agents-library" "$TARGET_DIR/presets"
cp -R "$TEMPLATE_DIR/agents-library/" "$TARGET_DIR/agents-library/" 2>/dev/null || \
  rsync -a "$TEMPLATE_DIR/agents-library/" "$TARGET_DIR/agents-library/" 2>/dev/null || true
cp "$TEMPLATE_DIR/presets/"*.json "$TARGET_DIR/presets/" 2>/dev/null || true

# knowledge-init/ 디렉토리 복사
mkdir -p "$TARGET_DIR/knowledge-init"
cp "$TEMPLATE_DIR/knowledge-init/"*.md "$TARGET_DIR/knowledge-init/" 2>/dev/null || true

# workflows/ 예시 템플릿 복사 (JSON + YAML, 사용자 커스텀 우선 — 기존 보존)
for wf in "$TEMPLATE_DIR/workflows/"*.json "$TEMPLATE_DIR/workflows/"*.yml; do
  [ -f "$wf" ] || continue
  base=$(basename "$wf")
  [ ! -f "$TARGET_DIR/workflows/$base" ] && cp "$wf" "$TARGET_DIR/workflows/"
done

# test/ Smoke Test 복사
mkdir -p "$TARGET_DIR/test/integration"
cp "$TEMPLATE_DIR/test/integration/"*.sh "$TARGET_DIR/test/integration/" 2>/dev/null || true
cp "$TEMPLATE_DIR/test/run_all.sh" "$TARGET_DIR/test/" 2>/dev/null || true
chmod +x "$TARGET_DIR/test/run_all.sh" "$TARGET_DIR/test/integration/"*.sh 2>/dev/null

# dashboard/ 복사 (legacy vanilla — 폴백)
mkdir -p "$TARGET_DIR/dashboard"
cp "$TEMPLATE_DIR/dashboard/server.py"     "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/index.html"    "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/style.css"     "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/app.js"        "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/dag-render.js" "$TARGET_DIR/dashboard/" 2>/dev/null || true
chmod +x "$TARGET_DIR/dashboard/server.py" 2>/dev/null

# dashboard.sh 복사 (대시보드 런처)
cp "$TEMPLATE_DIR/dashboard.sh" "$TARGET_DIR/" 2>/dev/null || true

# hooks/ 복사 (하네스 엔지니어링 — 필수)
mkdir -p "$TARGET_DIR/hooks"
cp "$TEMPLATE_DIR/hooks/"*.sh "$TARGET_DIR/hooks/" 2>/dev/null || true
cp "$TEMPLATE_DIR/hooks/"*.py "$TARGET_DIR/hooks/" 2>/dev/null || true
chmod +x "$TARGET_DIR/hooks/"*.sh 2>/dev/null || true

# dashboard-next-v2/out 복사 (Next.js + shadcn 정적 산출물)
# server.py가 이게 있으면 우선해서 서빙. 없으면 legacy로 폴백.
if [ -d "$TEMPLATE_DIR/dashboard-next-v2/out" ]; then
  mkdir -p "$TARGET_DIR/dashboard-next-v2/out"
  cp -R "$TEMPLATE_DIR/dashboard-next-v2/out/." "$TARGET_DIR/dashboard-next-v2/out/" 2>/dev/null || \
    rsync -a "$TEMPLATE_DIR/dashboard-next-v2/out/" "$TARGET_DIR/dashboard-next-v2/out/" 2>/dev/null || true
fi

# dashboard-next-v2 소스 복사 (개발/커스텀용)
if [ -d "$TEMPLATE_DIR/dashboard-next-v2/components" ]; then
  mkdir -p "$TARGET_DIR/dashboard-next-v2"
  for sub in components lib hooks app public; do
    [ -d "$TEMPLATE_DIR/dashboard-next-v2/$sub" ] && \
      cp -R "$TEMPLATE_DIR/dashboard-next-v2/$sub" "$TARGET_DIR/dashboard-next-v2/" 2>/dev/null || true
  done
  # 설정 파일
  for f in package.json tsconfig.json next.config.ts tailwind.config.ts postcss.config.mjs components.json; do
    [ -f "$TEMPLATE_DIR/dashboard-next-v2/$f" ] && \
      cp "$TEMPLATE_DIR/dashboard-next-v2/$f" "$TARGET_DIR/dashboard-next-v2/" 2>/dev/null || true
  done
fi

# config.json 기본값 항상 복사 (참조용)
cp "$TEMPLATE_DIR/config.json" "$TARGET_DIR/config.json.default"

PROJECT_AGENTS_DIR="$(dirname "$TARGET_DIR")/agents"
mkdir -p "$PROJECT_AGENTS_DIR"

# ━━━ 프리셋 선택 (config.json이 없을 때만) ━━━
if [ ! -f "$TARGET_DIR/config.json" ]; then
  echo ""
  echo -e "  ${BOLD}회사 종류를 선택하세요:${NC}"
  echo "    1) Default                  - 9인 일반 회사"
  echo "    2) 🎨 Web Design Agency     - 디자인 에이전시"
  echo "    3) 🚀 IT Startup            - 린 스타트업"
  echo "    4) 📝 Content Marketing     - 콘텐츠 마케팅 팀"
  echo "    5) 📊 Data Team             - 데이터 팀"
  echo "    6) 👤 Solo Developer        - 1인 개발자"
  echo "    7) ✏  Custom               - 직접 라이브러리에서 고르기"
  echo ""
  printf "  선택 [1]: "
  read -r preset_num

  case "$preset_num" in
    2) PRESET="web-design-agency" ;;
    3) PRESET="it-startup" ;;
    4) PRESET="content-marketing" ;;
    5) PRESET="data-team" ;;
    6) PRESET="solo-developer" ;;
    7) PRESET="__custom__" ;;
    *) PRESET="default" ;;
  esac

  if [ "$PRESET" = "__custom__" ]; then
    echo ""
    echo -e "  ${BOLD}라이브러리 에이전트 (카테고리/파일):${NC}"
    cd "$TEMPLATE_DIR/agents-library"
    for cat in */; do
      cat_name=$(basename "$cat")
      echo "  📁 $cat_name"
      for f in "$cat"*.md; do
        [ -f "$f" ] || continue
        name=$(basename "$f" .md)
        echo "      ${cat_name}/${name}"
      done
    done
    cd - >/dev/null
    echo ""
    echo "  사용할 에이전트를 콤마로 구분 입력 (예: leadership/ceo,product/product-manager,external/gemini)"
    printf "  입력: "
    read -r custom_input
    if [ -z "$custom_input" ]; then
      echo "  ⚠ 입력 없음, default 프리셋으로 진행"
      bash "$TEMPLATE_DIR/scripts/build-from-preset.sh" default "$TARGET_DIR" "$PROJECT_AGENTS_DIR"
    else
      # 임시 custom 프리셋 생성
      _custom_file="$TARGET_DIR/presets/__custom__.json"
      mkdir -p "$TARGET_DIR/presets"
      python3 -c "
import json, sys
paths = [p.strip() for p in sys.argv[1].split(',') if p.strip()]
agents = []
for p in paths:
    aid = p.split('/')[-1].replace('-engineer', '').replace('-manager', '').replace('-strategist', '')
    if aid in [a['id'] for a in agents]:
        aid = p.split('/')[-1].replace('/', '-')
    engine = 'gemini' if p == 'external/gemini' else 'claude'
    agents.append({'library_path': p, 'id': aid, 'engine': engine, 'protected': aid == 'orch'})
# 첫 에이전트를 orch로
if agents and agents[0]['id'] != 'orch':
    agents[0]['id'] = 'orch'
    agents[0]['protected'] = True
preset = {
    'id': 'custom',
    'name': 'Custom',
    'description': '사용자 정의 회사',
    'icon': '✏️',
    'agents': agents,
}
with open(sys.argv[2], 'w') as f:
    json.dump(preset, f, ensure_ascii=False, indent=2)
" "$custom_input" "$_custom_file"
      bash "$TEMPLATE_DIR/scripts/build-from-preset.sh" "__custom__" "$TARGET_DIR" "$PROJECT_AGENTS_DIR"
    fi
  else
    echo ""
    echo -e "  ${CYAN}프리셋 적용 중: $PRESET${NC}"
    bash "$TEMPLATE_DIR/scripts/build-from-preset.sh" "$PRESET" "$TARGET_DIR" "$PROJECT_AGENTS_DIR"
  fi
else
  echo -e "  ${CYAN}기존 config.json 보존${NC}"
fi

# update.sh + spawn-manager.sh 복사
cp "$TEMPLATE_DIR/update.sh" "$TARGET_DIR/" 2>/dev/null || true
cp "$TEMPLATE_DIR/spawn-manager.sh" "$TARGET_DIR/" 2>/dev/null || true

# 버전 기록
_version=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo "installed-$(date +%Y%m%d)")
echo "$_version" > "$TARGET_DIR/.version"

# 중앙 레지스트리에 프로젝트 등록 (~/.claude/company-registry.json)
_abs_target="$(cd "$TARGET_DIR" && pwd)"
_abs_project="$(cd "$_abs_target/../.." && pwd)"
_project_name=$(basename "$_abs_project")
python3 -c "
import json, os, sys
registry_path = os.path.expanduser('~/.claude/company-registry.json')
try:
    with open(registry_path) as f: reg = json.load(f)
except: reg = {'projects': []}
# 중복 방지
paths = {p['path'] for p in reg['projects']}
if sys.argv[1] not in paths:
    reg['projects'].append({
        'name': sys.argv[2],
        'path': sys.argv[1],
        'company_dir': sys.argv[3],
        'installed_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
        'version': sys.argv[4],
    })
else:
    for p in reg['projects']:
        if p['path'] == sys.argv[1]:
            p['version'] = sys.argv[4]
os.makedirs(os.path.dirname(registry_path), exist_ok=True)
with open(registry_path, 'w') as f:
    json.dump(reg, f, ensure_ascii=False, indent=2)
" "$_abs_project" "$_project_name" "$_abs_target" "$_version" 2>/dev/null || true

# 실행 권한
chmod +x "$TARGET_DIR"/*.sh "$TARGET_DIR/agents/"*.sh "$TARGET_DIR/scripts/"*.sh

echo -e "  ${GREEN}설치 완료: $TARGET_DIR (${_version})${NC}"
echo ""

# setup 실행
bash "$TARGET_DIR/setup.sh"

echo ""
echo -e "  ${BOLD}다음 단계:${NC}"
echo "  1. 에이전트 시작:  bash $TARGET_DIR/run.sh"
echo "  2. 대시보드:       python3 $TARGET_DIR/dashboard/server.py"
echo "  3. 태스크 전달:    bash $TARGET_DIR/kickoff.sh '태스크 설명'"
echo ""
