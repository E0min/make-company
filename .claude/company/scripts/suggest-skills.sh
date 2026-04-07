#!/usr/bin/env bash
# 메시지 + 에이전트 역할 기반 스킬 추천
# 사용법: suggest-skills.sh <agent_id> <message>

AGENT_ID="$1"
shift
MESSAGE="$*"

COMPANY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$COMPANY_DIR/../.." && pwd)"
INDEX="$COMPANY_DIR/skill-index.json"

# 인덱스가 없으면 생성
if [ ! -f "$INDEX" ]; then
  OUTPUT="$INDEX" PROJECT_DIR="$PROJECT_DIR" bash "$(dirname "$0")/build-skill-index.sh" > /dev/null 2>&1
fi
[ ! -f "$INDEX" ] && exit 0

# 에이전트 역할 키워드
get_role_keywords() {
  case "$1" in
    orch)      echo "오케스트레이터 위임 조율 배포 스프린트 리뷰 ship deploy" ;;
    pm)        echo "기획 PRD 유저스토리 로드맵 KPI 기능정의 product requirements" ;;
    design)    echo "디자인 UI UX 색상 타이포 레이아웃 접근성 애니메이션 design color" ;;
    frontend)  echo "프론트엔드 React D3 컴포넌트 CSS 렌더링 상태관리 그래프 frontend browser" ;;
    fe-qa)     echo "프론트 QA 테스트 Vitest Playwright 회귀 접근성 브라우저 test bug" ;;
    backend)   echo "백엔드 IndexedDB Supabase storage API 스키마 마이그레이션 database" ;;
    be-qa)     echo "백엔드 QA 테스트 동기화 트랜잭션 RLS 보안 성능 security test" ;;
    marketing) echo "마케팅 GTM CWS 콘텐츠 출시 Product Hunt 성장 launch marketing" ;;
    gemini)    echo "리뷰 토론 성능 보안 아키텍처 대안 review performance" ;;
    *)         echo "" ;;
  esac
}

ROLE_KW=$(get_role_keywords "$AGENT_ID")

# config.json에서 assigned_skills 읽기 (있으면 부분집합 추천)
ASSIGNED=$(python3 -c "
import json, sys
try:
  c = json.load(open(sys.argv[1]))
  for a in c.get('agents', []):
    if a['id'] == sys.argv[2]:
      print(','.join(a.get('assigned_skills', [])))
      break
except: pass
" "$COMPANY_DIR/config.json" "$AGENT_ID" 2>/dev/null)

python3 - "$INDEX" "$ROLE_KW" "$MESSAGE" "$ASSIGNED" << 'PYEOF'
import json, sys

index_path = sys.argv[1]
role_kw_str = sys.argv[2]
message = sys.argv[3]
assigned_str = sys.argv[4] if len(sys.argv) > 4 else ""

try:
    with open(index_path) as f:
        skills = json.load(f)
except:
    sys.exit(0)

# 에이전트별 할당된 스킬이 있으면 부분집합으로 필터
assigned = set(s.strip() for s in assigned_str.split(',') if s.strip())
if assigned:
    skills = [s for s in skills if s.get('name') in assigned]

role_kw = set(w.lower() for w in role_kw_str.split() if len(w) >= 2)
msg_kw = set(w.lower() for w in message.split() if len(w) >= 2)

scores = []
for skill in skills:
    # keywords는 list
    kw_list = skill.get("keywords", [])
    if isinstance(kw_list, str):
        kw_list = [k.strip() for k in kw_list.split(",")]
    skill_kw = set(k.lower() for k in kw_list if k)

    # desc에서도 단어 추출
    desc = skill.get("desc", "")
    desc_kw = set(w.lower() for w in desc.split() if len(w) >= 2)
    skill_all = skill_kw | desc_kw

    msg_score = len(msg_kw & skill_all) * 3
    role_score = len(role_kw & skill_all)
    total = msg_score + role_score

    if total > 0:
        scores.append((total, skill["name"], desc[:40]))

scores.sort(reverse=True)
top = scores[:3]

if top and top[0][0] > 1:
    names = [f"/{name}" for _, name, _ in top]
    print("[추천: " + ", ".join(names) + "]")
PYEOF
