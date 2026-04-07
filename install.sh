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

# workflows/ 예시 템플릿 복사 (사용자 커스텀 우선 — 기존 보존)
for wf in "$TEMPLATE_DIR/workflows/"*.json; do
  [ -f "$wf" ] || continue
  base=$(basename "$wf")
  [ ! -f "$TARGET_DIR/workflows/$base" ] && cp "$wf" "$TARGET_DIR/workflows/"
done

# test/ Smoke Test 복사
mkdir -p "$TARGET_DIR/test/integration"
cp "$TEMPLATE_DIR/test/integration/"*.sh "$TARGET_DIR/test/integration/" 2>/dev/null || true
cp "$TEMPLATE_DIR/test/run_all.sh" "$TARGET_DIR/test/" 2>/dev/null || true
chmod +x "$TARGET_DIR/test/run_all.sh" "$TARGET_DIR/test/integration/"*.sh 2>/dev/null

# dashboard/ 복사
mkdir -p "$TARGET_DIR/dashboard"
cp "$TEMPLATE_DIR/dashboard/server.py"     "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/index.html"    "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/style.css"     "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/app.js"        "$TARGET_DIR/dashboard/" 2>/dev/null || true
cp "$TEMPLATE_DIR/dashboard/dag-render.js" "$TARGET_DIR/dashboard/" 2>/dev/null || true
chmod +x "$TARGET_DIR/dashboard/server.py" 2>/dev/null

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
  echo ""
  printf "  선택 [1]: "
  read -r preset_num

  case "$preset_num" in
    2) PRESET="web-design-agency" ;;
    3) PRESET="it-startup" ;;
    4) PRESET="content-marketing" ;;
    5) PRESET="data-team" ;;
    6) PRESET="solo-developer" ;;
    *) PRESET="default" ;;
  esac

  echo ""
  echo -e "  ${CYAN}프리셋 적용 중: $PRESET${NC}"
  bash "$TEMPLATE_DIR/scripts/build-from-preset.sh" "$PRESET" "$TARGET_DIR" "$PROJECT_AGENTS_DIR"
else
  echo -e "  ${CYAN}기존 config.json 보존${NC}"
fi

# 실행 권한
chmod +x "$TARGET_DIR"/*.sh "$TARGET_DIR/agents/"*.sh "$TARGET_DIR/scripts/"*.sh

echo -e "  ${GREEN}설치 완료: $TARGET_DIR${NC}"
echo ""

# setup 실행
bash "$TARGET_DIR/setup.sh"
