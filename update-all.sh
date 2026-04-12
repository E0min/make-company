#!/usr/bin/env bash
# 등록된 모든 프로젝트의 가상 회사를 한번에 업데이트
#
# 사용법:
#   bash update-all.sh                # GitHub에서 최신 다운로드
#   bash update-all.sh /path/to/repo  # 로컬 repo 지정
#   bash update-all.sh --list         # 등록된 프로젝트 목록만 표시

set -e

REGISTRY="$HOME/.claude/company-registry.json"
REPO_ARG="$1"

BOLD='\033[1m'
GREEN='\033[1;32m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "  ${BOLD}Virtual Company — Update All${NC}"
echo ""

if [ ! -f "$REGISTRY" ]; then
  echo -e "  ${RED}레지스트리 없음: $REGISTRY${NC}"
  echo -e "  ${DIM}아직 설치된 프로젝트가 없습니다. install.sh로 먼저 설치하세요.${NC}"
  exit 1
fi

# 프로젝트 목록 파싱
_projects=$(python3 -c "
import json
with open('$REGISTRY') as f:
    reg = json.load(f)
for p in reg.get('projects', []):
    print(f\"{p['name']}|{p['path']}|{p['company_dir']}|{p.get('version','?')}\")
" 2>/dev/null)

if [ -z "$_projects" ]; then
  echo -e "  ${YELLOW}등록된 프로젝트가 없습니다${NC}"
  exit 0
fi

total=$(echo "$_projects" | wc -l | tr -d ' ')
echo -e "  등록된 프로젝트: ${CYAN}${total}개${NC}"
echo ""

# --list 모드: 목록만 표시
if [ "$REPO_ARG" = "--list" ]; then
  printf "  ${DIM}%-20s %-10s %s${NC}\n" "이름" "버전" "경로"
  echo "$_projects" | while IFS='|' read -r name path company_dir version; do
    # 경로 존재 확인
    if [ -d "$company_dir" ]; then
      printf "  %-20s %-10s %s\n" "$name" "$version" "$path"
    else
      printf "  ${RED}%-20s %-10s %s (경로 없음)${NC}\n" "$name" "$version" "$path"
    fi
  done
  echo ""
  exit 0
fi

# 업데이트 실행
success=0
fail=0

echo "$_projects" | while IFS='|' read -r name path company_dir version; do
  echo -e "  ${BOLD}[$name]${NC} ${DIM}$path${NC}"

  if [ ! -d "$company_dir" ]; then
    echo -e "    ${RED}경로 없음 — 스킵${NC}"
    continue
  fi

  update_script="$company_dir/update.sh"
  if [ ! -f "$update_script" ]; then
    echo -e "    ${YELLOW}update.sh 없음 — 이전 버전. install.sh로 재설치 필요${NC}"
    continue
  fi

  # update.sh 실행
  if [ -n "$REPO_ARG" ] && [ "$REPO_ARG" != "--list" ]; then
    bash "$update_script" "$REPO_ARG" 2>&1 | sed 's/^/    /'
  else
    bash "$update_script" 2>&1 | sed 's/^/    /'
  fi

  echo ""
done

echo -e "  ${GREEN}${BOLD}전체 업데이트 완료${NC}"
echo ""
