# make-company Handoff Document

## 이 시스템이 뭔가

**make-company**는 Claude Code 위에 구축된 멀티에이전트 오케스트레이션 시스템입니다.

한 줄로 설명하면: **"프로젝트마다 반복하는 Claude Code 세팅(에이전트, 스킬, 훅, 워크플로우)을 한 번에 설치하고, AI 팀이 하네스 엔지니어링으로 품질을 강제받으며 협업하는 시스템"**.

```
사용자: "로그인 기능 만들어줘"

CEO(메인 Claude)가 판단:
  → PM에게 PRD 작성 지시
  → Designer에게 UI 설계 지시 (PM과 병렬)
  → Frontend Engineer에게 구현 지시 (PM/Designer 완료 후)
  → FE-QA에게 검증 지시
  → 회고 자동 수집 → 메모리에 학습 기록
```

---

## 시스템 구성 요소

| 구성 요소 | 위치 | 역할 |
|----------|------|------|
| **에이전트 30종** | `~/.claude/agents/*.md` | 역할별 행동 규칙 정의 (글로벌) |
| **훅 10개** | `~/.claude/hooks/` | PostToolUse/UserPromptSubmit 하네스 |
| **Rules 6개** | `~/.claude/rules/` | path-scoped 코드 컨벤션 (파일 유형별 자동 로드) |
| **스킬 미들웨어** | `~/.claude/skills/company/skill.md` | `/company` 명령 처리 (583줄) |
| **대시보드 서버** | `~/.claude/company/dashboard/server.py` | Python stdlib 서버 (2,962줄, 의존성 0) |
| **대시보드 UI** | `~/.claude/company/dashboard-next-v2/` | Next.js + shadcn/ui (10개 탭) |
| **워크플로우** | `~/.claude/workflows/*.yml` | YAML 파이프라인 정의 4종 |
| **config.json** | `~/.claude/company/config.json` | 프로젝트별 에이전트/모델/파이프라인/하네스 설정 |

---

## 사용법

### 설치

```bash
git clone https://github.com/E0min/make-company.git ~/make-company
bash ~/make-company/install.sh
```

또는 대시보드에서 + 버튼 → 디렉토리 선택 → 자동 스캔 → 설치.

### 기본 명령

```bash
# 프로젝트에서 Claude Code 실행 후
/company setup          # 에이전트 선택 + 초기 설정
/company run "태스크"    # CEO가 에이전트 팀을 오케스트레이션
/company workflow new-feature "태스크"  # YAML 파이프라인 실행
/company dashboard      # 웹 대시보드 (localhost:7777)
/company memory         # 에이전트 메모리 조회
/company retro          # 회고 목록
```

### `/company run` 실행 흐름

```
1. session-boot.sh (UserPromptSubmit)
   → L4 pending-fix 체크 (이전 위반 강제 주입)
   → 회고 게이트 (이전 태스크 회고 누락 시 차단)
   → 무결성 매니페스트 체크 (파일 삭제/손상 자동 복구)
   → 통합 정합성 검증 (config↔agents↔workflows 교차 참조)

2. CEO 태스크 분석
   → 과거 회고 참조
   → 태스크 분류 (feature/bugfix/design/...)

3. 에이전트 호출 (Agent tool)
   → config.json에서 모델 선택 (sonnet/opus/haiku)
   → 프롬프트 구성 (에이전트 .md + 메모리 + 공유 지식 + 스킬 추천)
   → 조건부 주입 (비어있는 섹션은 생략 → 토큰 절약)

4. agent-harness.sh (PostToolUse)
   → [CHECKPOINT:] 패턴 검증 (누락 시 경고 + L4)
   → 품질 게이트 검사 (미달 시 재작업 강제)
   → [SKILL_DONE:] 파이프라인 순서 검증
   → [agent:xxx] 커밋 태그 검증
   → 스킬 사용 추적 (skill-usage.jsonl)

5. 완료 처리
   → 참여 에이전트 자기평가 수집
   → 회고 JSON 저장
   → 에이전트 메모리 업데이트
   → 공유 지식 교차 학습
   → AX 시스템 감사 (ax_enabled=true 시)
```

### 대시보드 (10개 탭)

| 탭 | 기능 |
|----|------|
| Overview | 프로젝트 상태 요약 |
| Workflows | 에이전트 워크플로우 + 스킬 파이프라인 편집 |
| Activity | 실시간 활동 로그 |
| Agents | 에이전트 CRUD + 모델 선택 |
| Skills | 51개 스킬 검색 + 오버라이드 + 파이프라인 |
| Health | 병목 감지 + 성과 분석 |
| Retro | 회고 타임라인 |
| Profile | 에이전트별 메모리/성과/도구 |
| Git | Gitflow 레인 시각화 + 에이전트별 커밋 |
| Terminal | 웹 터미널 (xterm.js) |

---

## 하네스 엔지니어링

이 시스템의 핵심 차별점. .md 가이드라인이 아니라 **코드가 품질을 강제**합니다.

### 훅 체계 (9개)

```
UserPromptSubmit (실행 전):
  start-company.sh    — tmux 세션 감지
  session-boot.sh     — L4 강제 + 회고 게이트 + 무결성 + 정합성

PostToolUse (실행 후):
  ctx-compact-check.sh    — 컨텍스트 60% 경고
  agent-harness.sh        — 체크포인트/품질/스킬/커밋태그 + L4 쓰기
  auto-retro.sh           — 회고 누락 리마인더
  agent-create-harness.sh — 에이전트 .md 구조 검증 + 자동 등록
  workflow-harness.sh     — 워크플로우 YAML 검증 (순환/역할/QA)
  integrity-harness.sh    — config/overrides/삭제 캐스케이드
```

### 강제력 레벨

| 레벨 | 방식 | 예시 |
|------|------|------|
| L1. 로깅 | activity.jsonl 기록 | 모든 이벤트 추적 |
| L2. 경고 | stdout 출력 | 체크포인트 누락, 품질 미달 |
| L3. 자동 수정 | 파일 직접 수정 | config.json 에이전트 자동 등록, 고아 파일 정리 |
| L4. 다음 턴 강제 | PostToolUse→임시파일→UserPromptSubmit | 체크포인트 누락 → 다음 프롬프트에 재요청 강제 주입 |
| L5. 사전 검증 | UserPromptSubmit에서 차단 | 회고 누락 시 새 태스크 시작 경고 |

### 무결성 보호

- `integrity-manifest.json`에 44개 시스템 파일의 SHA-256 체크섬 기록
- 회사 시작 시 자동 대조 → 삭제된 시스템 파일은 글로벌 원본에서 자동 복구
- 프로젝트 파일(config.json, 메모리)은 복구 불가 → 경고

---

## 토큰 최적화

### 에이전트 init 최적화 (87% 감소)

| 항목 | 이전 | 이후 |
|------|------|------|
| agent .md | 각 4-7KB | 각 ~650 bytes |
| 체크포인트/커밋태그/스킬 규칙 | 프롬프트에 매번 주입 (~1,400 tokens) | CLAUDE.md로 이동 (자동 로드, 0 tokens) |
| 빈 섹션 | "(아직 없음)" 텍스트 포함 | 섹션 자체 생략 |
| 에이전트 8개 풀 파이프라인 | ~40,000 tokens | ~16,000 tokens |

### path-scoped rules (`.claude/rules/`)

파일 유형별로 컨벤션이 자동 로드됨. tsx 파일 작업 시 → `frontend.md`만 로드, `backend.md`는 안 읽힘.

---

## 장점

### 1. 반복 제거
프로젝트마다 에이전트 정의, 스킬 설정, 훅 구성, 워크플로우를 반복하지 않음. `install.sh` 한 줄 또는 대시보드 + 버튼으로 끝.

### 2. 프롬프트가 아니라 코드가 강제
"잘 해주세요" → PostToolUse 훅이 매 도구 호출마다 검증. 체크포인트 누락, 품질 미달, 스킬 순서 위반을 코드가 잡아냄.

### 3. 쓸수록 똑똑해짐
에이전트 메모리가 프로젝트별로 축적. 회고 → 메모리 → 행동 변화. 3번째 실행은 1번째보다 정확.

### 4. 교차 학습
QA가 발견한 이슈가 shared-knowledge.jsonl에 기록 → 다음 엔지니어 호출 시 자동 주입.

### 5. 시각적 모니터링
터미널에서 벗어나 브라우저에서 에이전트 상태, 성과, 병목, Git 히스토리를 실시간 확인.

### 6. 프로젝트 간 이식
에이전트/워크플로우/스킬이 글로벌/로컬 분리. 좋은 건 글로벌로 승격, 프로젝트별 차이는 오버라이드로 관리.

### 7. 자가 보존
시스템 파일 삭제/손상 시 자동 감지 + 복구. AX 엔지니어가 시스템 전체 감사.

### 8. 토큰 효율
에이전트 .md 87% 압축 + CLAUDE.md 자동 로드 + 조건부 주입 + path-scoped rules.

---

## 단점 / 한계

### 1. 하네스는 차단이 아니라 경고
PostToolUse 훅은 도구 실행 **후**에 동작. 잘못된 코드가 이미 작성된 뒤에 "이거 잘못됐어"라고 말하는 것. L4 패턴으로 다음 턴에 강제하지만, 현재 턴은 막을 수 없음.

### 2. 에이전트 내부를 통제할 수 없음
Agent tool 서브프로세스는 독립적. CEO가 "이 순서로 해"라고 프롬프트에 넣어도 에이전트가 무시할 수 있음. 경계 하네스(호출 후 검증 + 재요청)로 보완하지만 100% 강제는 아님.

### 3. 토큰 비용이 높음
에이전트 8개 풀 파이프라인 1회 = ~500K-2M tokens. 최적화로 init은 줄였지만, 에이전트가 코드를 읽고 쓰는 비용은 줄일 수 없음.

### 4. 실제 실행 경험이 부족
설계는 완성됐지만 `/company run`으로 실제 태스크를 반복 실행한 데이터가 아직 적음. 회고/메모리/자기진화 루프가 이론적으로는 동작하지만 대량의 실제 태스크에서 검증이 필요.

### 5. 대시보드가 static export
`next build`로 빌드해야 변경사항이 반영됨. 개발 중에는 매번 빌드 → 서버 재시작이 필요.

### 6. Python 서버 단일 스레드
`server.py`가 ThreadingHTTPServer지만, 동시 접속이 많으면 느려질 수 있음. 프로덕션용이 아닌 개발자 로컬 도구.

### 7. 에이전트 메모리가 무한 증가
메모리 정리 메커니즘이 AX 감사의 경고뿐. 수동 정리가 필요할 수 있음.

### 8. 글로벌 설정 의존
`~/.claude/` 디렉토리에 에이전트, 훅, 스킬이 있어야 동작. 다른 머신으로 이동하면 글로벌 설정을 다시 설치해야 함.

---

## 프로젝트에 설치할 때

### 새 프로젝트

```bash
# 대시보드에서
+ 버튼 → 디렉토리 선택 → 자동 스캔 → 설치

# 또는 CLI에서
/company setup
```

자동 스캔이 감지하는 것:
- package.json → Next.js/React/Vue/Express + TypeScript + Tailwind + 테스트 프레임워크
- pyproject.toml → Django/FastAPI/Flask
- .cursorrules → `.claude/rules/`로 자동 변환
- 기존 CLAUDE.md → 보존 (덮어쓰지 않음)
- 프로젝트 구조 → 에이전트 자동 추천

### 기존 프로젝트에 이식

```
1. 기존 .claude/agents/ 보존 (v2 플레이스홀더 없으면 마이그레이션 제안)
2. 기존 CLAUDE.md 보존 + Agent Common Rules 섹션 추가
3. 기존 settings.json에 훅 병합 (덮어쓰지 않음)
4. config.json에 기존 에이전트 자동 포함
5. .cursorrules가 있으면 .claude/rules/cursor-imported.md로 변환
```

---

## 파일 구조 요약

```
~/.claude/                          ← 글로벌 (모든 프로젝트 공유)
├── agents/                         ← 30개 에이전트 템플릿
│   ├── ceo.md
│   ├── frontend-engineer.md
│   ├── ax-engineer.md
│   └── ... (30종)
├── hooks/                          ← 10개 하네스 훅
│   ├── agent-harness.sh
│   ├── session-boot.sh
│   ├── integrity.py
│   └── ...
├── rules/                          ← 6개 path-scoped rules
│   ├── frontend.md (*.tsx 작업 시만)
│   ├── backend.md (*.py 작업 시만)
│   └── ...
├── skills/company/skill.md         ← /company 스킬 (583줄)
├── workflows/                      ← 워크플로우 템플릿
│   ├── new-feature.yml
│   ├── bug-fix.yml
│   └── ...
├── settings.json                   ← 훅 등록
└── company/                        ← 프로젝트별 데이터
    ├── config.json                 ← 프로젝트 설정
    ├── agent-memory/               ← 에이전트별 학습 기록
    ├── agent-output/               ← 에이전트 출력 로그
    ├── retrospectives/             ← 회고 JSON
    ├── analytics/                  ← 스킬 사용 통계
    ├── ax-reports/                 ← AX 감사 보고서
    ├── activity.jsonl              ← 구조화된 이벤트 로그
    ├── skill-overrides.json        ← 프로젝트별 스킬 설정
    ├── integrity-manifest.json     ← 파일 무결성 매니페스트
    ├── scripts/                    ← 유틸리티 스크립트
    │   ├── project-bootstrap.py
    │   ├── ax-check.py
    │   ├── suggest-skills.sh
    │   └── build-skill-index.sh
    └── dashboard/                  ← 웹 대시보드
        ├── server.py (2,962줄)
        └── dashboard-next-v2/
```

---

## 에이전트 카탈로그 (30종)

| 카테고리 | 에이전트 |
|---------|---------|
| Engineering (8) | frontend, backend, fullstack, mobile, devops, data, ai-ml, security |
| QA (4) | fe-qa, be-qa, performance-tester, accessibility-tester |
| Product (3) | product-manager, business-analyst, ux-researcher |
| Design (3) | ui-ux-designer, brand-designer, motion-designer |
| Marketing (4) | marketing-strategist, sns-manager, content-writer, seo-specialist |
| Data (2) | data-analyst, database-admin |
| DevOps (3) | site-reliability, release-manager, ax-engineer |
| Leadership (2) | ceo, project-coordinator |
| General (3) | technical-writer, localization-specialist, legal-compliance |

---

## config.json 핵심 설정

```json
{
  "agent_models": {         // 에이전트별 모델 (비용 최적화)
    "_default": "sonnet",
    "ceo": "opus",          // 판단력 필요 → 비싼 모델
    "fe-qa": "haiku",       // 반복 검증 → 싼 모델
  },
  "skill_pipelines": {      // 에이전트 내부 스킬 순서 강제
    "engineer": {
      "feature": ["investigate", "plan-eng-review", "implement", "qa", "review"]
    }
  },
  "ax_enabled": true,       // AX 시스템 감사 on/off
}
```

---

## 주의사항

1. **`next build` 필수**: 대시보드 UI 수정 후 반드시 빌드. 서버가 `out/` static 파일을 서빙함.
2. **서버 재시작**: `server.py` 수정 후 포트 7777 프로세스 kill → 재시작.
3. **글로벌 vs 로컬**: `~/.claude/agents/`(글로벌)를 수정하면 모든 프로젝트에 영향. 프로젝트별 커스텀은 `.claude/agents/`(로컬)에서.
4. **메모리 백업**: `~/.claude/agents/backup-v1/`에 압축 전 원본 보관됨.
5. **훅 문법 오류 주의**: hooks/ 파일에 문법 에러 → 모든 PostToolUse가 깨짐. `bash -n` 확인 후 수정.
