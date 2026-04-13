#!/usr/bin/env bash
# Virtual Company 업데이트 스크립트
# 시스템 파일만 최신 template으로 교체, 사용자 커스텀은 보존
#
# 사용법:
#   bash .claude/company/update.sh                # 기본 (GitHub에서 최신 다운로드)
#   bash .claude/company/update.sh /path/to/repo  # 로컬 repo 경로 지정

set -e

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$COMPANY_DIR/../.." && pwd)"
LOCAL_REPO="$1"

BOLD='\033[1m'
GREEN='\033[1;32m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
DIM='\033[2m'
NC='\033[0m'

# 버전 파일
VERSION_FILE="$COMPANY_DIR/.version"
REPO_URL="https://github.com/leeyoungmin/virtual-company.git"

echo ""
echo -e "  ${BOLD}Virtual Company Updater${NC}"
echo ""

# ━━━ 1. 현재 버전 확인 ━━━
current_version="unknown"
if [ -f "$VERSION_FILE" ]; then
  current_version=$(cat "$VERSION_FILE")
fi
echo -e "  현재 버전: ${DIM}${current_version}${NC}"

# ━━━ 2. 최신 template 가져오기 ━━━
TEMP_DIR=""
if [ -n "$LOCAL_REPO" ] && [ -d "$LOCAL_REPO/template" ]; then
  # 로컬 repo 지정
  TEMPLATE_SRC="$LOCAL_REPO/template"
  echo -e "  소스: ${CYAN}$LOCAL_REPO${NC} (로컬)"
else
  # GitHub에서 다운로드
  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_DIR"' EXIT

  echo -e "  소스: ${CYAN}GitHub${NC}"
  echo -ne "  다운로드 중..."

  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --quiet "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null
    TEMPLATE_SRC="$TEMP_DIR/repo/template"
  elif command -v curl >/dev/null 2>&1; then
    curl -sL "https://github.com/leeyoungmin/virtual-company/archive/refs/heads/main.tar.gz" | tar xz -C "$TEMP_DIR"
    TEMPLATE_SRC="$TEMP_DIR/virtual-company-main/template"
  else
    echo -e "\n  ${RED}git 또는 curl이 필요합니다${NC}"
    exit 1
  fi
  echo -e " ${GREEN}완료${NC}"
fi

if [ ! -d "$TEMPLATE_SRC" ]; then
  echo -e "  ${RED}template 디렉토리를 찾을 수 없습니다${NC}"
  exit 1
fi

# 새 버전 확인
new_version="unknown"
if [ -d "$(dirname "$TEMPLATE_SRC")/.git" ]; then
  new_version=$(git -C "$(dirname "$TEMPLATE_SRC")" rev-parse --short HEAD 2>/dev/null || echo "unknown")
fi
echo -e "  최신 버전: ${GREEN}${new_version}${NC}"

if [ "$current_version" = "$new_version" ] && [ "$new_version" != "unknown" ]; then
  echo -e "\n  ${GREEN}이미 최신 버전입니다${NC}\n"
  exit 0
fi

# ━━━ 3. 사용자 파일 백업 ━━━
BACKUP_DIR="$COMPANY_DIR/.backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"

echo ""
echo -e "  ${BOLD}업데이트 시작${NC}"
echo -e "  ${DIM}백업: $BACKUP_DIR${NC}"

# 사용자 커스텀 파일 목록 (절대 덮어쓰지 않음)
# config.json, teams/*, knowledge/*, workflows/*, skill-overrides.json
for preserve in \
  "config.json" \
  "skill-overrides.json" \
  "skill-index.json" \
; do
  [ -f "$COMPANY_DIR/$preserve" ] && cp "$COMPANY_DIR/$preserve" "$BACKUP_DIR/" 2>/dev/null
done

# 디렉토리 단위 보존 대상 백업
for preserve_dir in knowledge workflows; do
  [ -d "$COMPANY_DIR/$preserve_dir" ] && cp -R "$COMPANY_DIR/$preserve_dir" "$BACKUP_DIR/" 2>/dev/null
done

# ━━━ 4. 시스템 파일 업데이트 ━━━
updated=0

copy_if_exists() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    updated=$((updated + 1))
  fi
}

echo -ne "  시스템 스크립트..."

# 핵심 스크립트
for f in run.sh stop.sh kickoff.sh router.sh monitor.sh setup.sh \
         restart-agent.sh dag-scheduler.sh dag-init.sh \
         pause.sh inject.sh resume.sh spawn-manager.sh update.sh; do
  copy_if_exists "$TEMPLATE_SRC/$f" "$COMPANY_DIR/$f"
done

# agents/ 스크립트
for f in run-agent.sh run-gemini.sh; do
  copy_if_exists "$TEMPLATE_SRC/agents/$f" "$COMPANY_DIR/agents/$f"
done

# scripts/
for f in "$TEMPLATE_SRC"/scripts/*.sh; do
  [ -f "$f" ] || continue
  copy_if_exists "$f" "$COMPANY_DIR/scripts/$(basename "$f")"
done

echo -e " ${GREEN}${updated}개 파일${NC}"

# ━━━ 5. Dashboard 업데이트 ━━━
echo -ne "  대시보드..."

# vanilla dashboard (폴백)
for f in server.py index.html style.css app.js dag-render.js; do
  copy_if_exists "$TEMPLATE_SRC/dashboard/$f" "$COMPANY_DIR/dashboard/$f"
done

# Next.js dashboard — 소스 복사 + 리빌드
dash_rebuilt=false
if [ -d "$TEMPLATE_SRC/dashboard-next-v2" ]; then
  DASH_SRC="$TEMPLATE_SRC/dashboard-next-v2"
  DASH_DST="$COMPANY_DIR/dashboard-next-v2"

  if [ -d "$DASH_DST" ]; then
    # 기존 설치본이 있으면 소스 파일만 업데이트 (node_modules, out 보존)
    # lib/types.ts는 사용자 추가 타입이 있을 수 있으므로 병합
    for src_file in $(find "$DASH_SRC" -type f \
      -not -path "*/node_modules/*" \
      -not -path "*/out/*" \
      -not -path "*/.next/*" \
      -not -path "*/.git/*" \
      -not -name "pnpm-lock.yaml" \
      -not -name "tsconfig.tsbuildinfo" \
    ); do
      rel="${src_file#$DASH_SRC/}"
      dst_file="$DASH_DST/$rel"
      mkdir -p "$(dirname "$dst_file")"
      # types.ts: 기존 파일에 없는 export만 추가 (병합)
      if [ "$rel" = "lib/types.ts" ] && [ -f "$dst_file" ]; then
        cp "$dst_file" "$dst_file.bak"
        # template의 새 export를 기존 파일에 추가 (기존 내용 유지)
        python3 -c "
import sys
with open(sys.argv[1]) as f: src = f.read()
with open(sys.argv[2]) as f: dst = f.read()
# template에 있는데 설치본에 없는 export 블록 추가
import re
src_exports = set(re.findall(r'export (?:interface|type|const) (\w+)', src))
dst_exports = set(re.findall(r'export (?:interface|type|const) (\w+)', dst))
missing = src_exports - dst_exports
if missing:
    # src에서 missing export 블록 추출해서 dst 끝에 추가
    additions = []
    for name in missing:
        pattern = rf'((?:/\*\*[\s\S]*?\*/\s*)?export (?:interface|type|const) {name}[\s\S]*?(?=\nexport |\n/\*\*|\Z))'
        m = re.search(pattern, src)
        if m:
            additions.append(m.group(1).rstrip())
    if additions:
        with open(sys.argv[2], 'a') as f:
            f.write('\n\n// ━━━ auto-merged from template update ━━━\n\n')
            f.write('\n\n'.join(additions))
            f.write('\n')
        print(f'    types.ts: {len(additions)}개 타입 병합')
" "$src_file" "$dst_file" 2>/dev/null || cp "$src_file" "$dst_file"
      else
        cp "$src_file" "$dst_file"
      fi
    done

    # 의존성 설치 + 빌드 (실패 시 이전 out/ 보존)
    if command -v pnpm >/dev/null 2>&1 || command -v npm >/dev/null 2>&1; then
      # 빌드 전 out/ 백업
      [ -d "$DASH_DST/out" ] && cp -R "$DASH_DST/out" "$DASH_DST/out.bak" 2>/dev/null
      _pkg_mgr=$(command -v pnpm >/dev/null 2>&1 && echo "pnpm" || echo "npm")
      (cd "$DASH_DST" && $_pkg_mgr install 2>/dev/null) >/dev/null 2>&1
      if (cd "$DASH_DST" && $_pkg_mgr run build 2>/dev/null) >/dev/null 2>&1; then
        dash_rebuilt=true
        rm -rf "$DASH_DST/out.bak" 2>/dev/null
      else
        # 빌드 실패 → 이전 out/ 복원 (기존 대시보드 유지)
        [ -d "$DASH_DST/out.bak" ] && rm -rf "$DASH_DST/out" && mv "$DASH_DST/out.bak" "$DASH_DST/out"
        dash_rebuilt=false
      fi
    fi
  fi
fi

if [ "$dash_rebuilt" = true ]; then
  echo -e " ${GREEN}리빌드 완료${NC}"
elif [ -d "$DASH_DST/out" ]; then
  echo -e " ${YELLOW}소스 업데이트 (빌드 실패 — 이전 버전 유지, 수동: cd dashboard-next-v2 && pnpm build)${NC}"
else
  echo -e " ${YELLOW}소스만 업데이트 (빌드: cd .claude/company/dashboard-next-v2 && pnpm install && pnpm build)${NC}"
fi

# ━━━ 6. agents-library + presets 업데이트 ━━━
echo -ne "  라이브러리..."
lib_count=0
if [ -d "$TEMPLATE_SRC/agents-library" ]; then
  mkdir -p "$COMPANY_DIR/agents-library"
  cp -R "$TEMPLATE_SRC/agents-library/." "$COMPANY_DIR/agents-library/" 2>/dev/null && \
    lib_count=$(find "$TEMPLATE_SRC/agents-library" -name "*.md" | wc -l | tr -d ' ')
fi
if [ -d "$TEMPLATE_SRC/presets" ]; then
  mkdir -p "$COMPANY_DIR/presets"
  cp "$TEMPLATE_SRC/presets/"*.json "$COMPANY_DIR/presets/" 2>/dev/null
fi
echo -e " ${GREEN}${lib_count}개 에이전트${NC}"

# ━━━ 7. config.json 기본값 갱신 (참조용) ━━━
copy_if_exists "$TEMPLATE_SRC/config.json" "$COMPANY_DIR/config.json.default"

# ━━━ 8. 새 config 필드 자동 병합 ━━━
# 사용자 config에 없는 새 필드를 default에서 병합 (기존 값은 유지)
if [ -f "$COMPANY_DIR/config.json" ] && [ -f "$COMPANY_DIR/config.json.default" ]; then
  python3 -c "
import json, sys

with open(sys.argv[1]) as f:
    user = json.load(f)
with open(sys.argv[2]) as f:
    default = json.load(f)

merged = False
for key, val in default.items():
    if key not in user and key != 'agents':
        user[key] = val
        merged = True
        print(f'  새 설정 추가: {key} = {val}')

if merged:
    with open(sys.argv[1], 'w') as f:
        json.dump(user, f, ensure_ascii=False, indent=2)
        f.write('\n')
" "$COMPANY_DIR/config.json" "$COMPANY_DIR/config.json.default" 2>/dev/null || true
fi

# ━━━ 9. 실행 권한 ━━━
chmod +x "$COMPANY_DIR"/*.sh 2>/dev/null
chmod +x "$COMPANY_DIR/agents/"*.sh 2>/dev/null
chmod +x "$COMPANY_DIR/scripts/"*.sh 2>/dev/null

# ━━━ 10. 버전 기록 ━━━
echo "$new_version" > "$VERSION_FILE"

# ━━━ 11. 서버 재시작 (실행 중이면) ━━━
_server_pid=$(pgrep -f "server.py.*$(basename "$COMPANY_DIR")" 2>/dev/null | head -1)
if [ -n "$_server_pid" ]; then
  echo -ne "  서버 재시작..."
  kill "$_server_pid" 2>/dev/null
  sleep 2
  # supervisor 패턴이 tmux에서 자동 재시작하므로 직접 시작 불필요
  echo -e " ${GREEN}완료${NC}"
fi

# ━━━ 완료 ━━━
echo ""
echo -e "  ${GREEN}${BOLD}업데이트 완료${NC}"
echo -e "  ${DIM}${current_version} → ${new_version}${NC}"
echo -e "  ${DIM}시스템 파일 ${updated}개 업데이트됨${NC}"
echo -e "  ${DIM}백업: ${BACKUP_DIR}${NC}"
echo ""
echo -e "  ${BOLD}보존된 파일:${NC}"
echo -e "  ${DIM}  config.json, knowledge/, workflows/, teams/*/CLAUDE.md${NC}"
echo ""
