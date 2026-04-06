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
mkdir -p "$TARGET_DIR"/{agents,scripts,inbox,outbox,channel,logs,state}

# 템플릿 복사
cp "$TEMPLATE_DIR/run.sh"          "$TARGET_DIR/"
cp "$TEMPLATE_DIR/stop.sh"         "$TARGET_DIR/"
cp "$TEMPLATE_DIR/kickoff.sh"      "$TARGET_DIR/"
cp "$TEMPLATE_DIR/router.sh"       "$TARGET_DIR/"
cp "$TEMPLATE_DIR/monitor.sh"      "$TARGET_DIR/"
cp "$TEMPLATE_DIR/setup.sh"        "$TARGET_DIR/"
cp "$TEMPLATE_DIR/agents/run-agent.sh"  "$TARGET_DIR/agents/"
cp "$TEMPLATE_DIR/agents/run-gemini.sh" "$TARGET_DIR/agents/"
cp "$TEMPLATE_DIR/scripts/build-skill-index.sh" "$TARGET_DIR/scripts/"
cp "$TEMPLATE_DIR/scripts/suggest-skills.sh"    "$TARGET_DIR/scripts/"

# config.json은 없을 때만 복사 (기존 설정 보존)
if [ ! -f "$TARGET_DIR/config.json" ]; then
  cp "$TEMPLATE_DIR/config.json" "$TARGET_DIR/"
fi

# 실행 권한
chmod +x "$TARGET_DIR"/*.sh "$TARGET_DIR/agents/"*.sh "$TARGET_DIR/scripts/"*.sh

echo -e "  ${GREEN}설치 완료: $TARGET_DIR${NC}"
echo ""

# setup 실행
bash "$TARGET_DIR/setup.sh"
