<div align="center">

# make-company

### Claude Code 위에서 동작하는 자기 개선형 멀티에이전트 시스템

하나의 명령으로 Claude Code를 8명의 AI 팀으로 전환합니다. 기획, 설계, 구현, 테스트, 회고까지 자동으로 수행합니다.

```bash
claude -company
> /company run "Todo 앱 만들어줘"
# CEO 위임 -> PM이 PRD 작성 -> Designer + Backend 병렬 작업 -> Frontend 구현 -> QA 검증
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.1+-5e6ad2)](https://docs.anthropic.com/en/docs/claude-code)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Version](https://img.shields.io/badge/version-2.1.0-blue)](https://github.com/E0min/make-company/releases)

</div>

---

<p align="center">
  <img src="docs/screenshots/overview.png" alt="make-company 대시보드 Overview" width="800" />
</p>

## 목차

- [make-company란?](#make-company란)
- [빠른 시작](#빠른-시작)
- [대시보드](#대시보드)
- [에이전트](#에이전트)
- [프리셋](#프리셋)
- [워크플로우](#워크플로우)
- [스킬 시스템](#스킬-시스템)
- [하네스 엔지니어링](#하네스-엔지니어링)
- [지능 시스템](#지능-시스템)
- [명령어 참조](#명령어-참조)
- [아키텍처](#아키텍처)
- [트러블슈팅](#트러블슈팅)
- [기여 가이드](#기여-가이드)
- [라이선스](#라이선스)

---

## make-company란?

Claude Code는 한 명의 뛰어난 개발자입니다. `make-company`는 그 개발자가 전문가 팀을 이끌게 만듭니다.

```
사용자: "Todo 앱 만들어줘"

  CEO      -> 분석, 위임
  PM       -> PRD 작성
  Designer -+
  Backend  -+ 병렬 작업
  Frontend <- 양쪽 결과를 받아 구현
  QA       -> 전체 검증
```

메인 Claude가 CEO 역할을 수행하며, 각 팀원을 Claude Code의 Agent tool로 호출합니다. CEO가 태스크를 분류하고, 의존성에 따라 순차 또는 병렬로 팀원을 조율합니다.

### 비교표: Claude Code vs make-company

| | Claude Code | make-company |
|---|---|---|
| **역할** | 범용 AI 1명 | CEO, PM, Designer, FE, BE, QA 등 **8명의 전문가** |
| **명령** | 모든 단계를 직접 지시 | "Todo 앱 만들어줘" 한마디로 **CEO가 자동 위임** |
| **파이프라인** | 단일 컨텍스트가 전부 처리 | PM이 PRD 작성 -> Designer 스펙 -> **FE 구현 -> QA 검증** |
| **병렬 처리** | 순차 실행 | Designer + Backend **동시 실행** |
| **품질 보증** | 수동 리뷰 | **FE-QA + BE-QA가 자동 검증** 후 버그 리포트 |
| **학습** | 세션 종료 시 초기화 | 에이전트별 **메모리 누적** (세션 간 유지) |
| **워크플로우** | 없음 | YAML 파이프라인 + **의존성 해석** |
| **모니터링** | 터미널 출력만 | **웹 대시보드** (실시간 SSE) + tmux + 웹 터미널 |
| **자기 개선** | 불가능 | 병목 감지, 회고, **자율 개선 루프** |

---

## 빠른 시작

### Prerequisites

| 도구 | 최소 버전 | 설치 방법 |
|------|-----------|-----------|
| macOS / Linux | macOS 12+ / Ubuntu 20+ | -- |
| Python 3 | 3.8+ | `brew install python3` |
| tmux | 3.0+ | `brew install tmux` |
| Claude Code CLI | 2.1+ | `npm install -g @anthropic-ai/claude-code` |
| Node.js | 18+ | Claude Code CLI 설치에 필요 |

### 1단계: Clone & Install

```bash
git clone https://github.com/E0min/make-company.git ~/make-company

# 에이전트, 워크플로우, 스킬 설치
mkdir -p ~/.claude/agents ~/.claude/workflows ~/.claude/skills/company
cp ~/make-company/template/agents-v2/*.md ~/.claude/agents/
cp ~/make-company/template/workflows/*.yml ~/.claude/workflows/
cp ~/make-company/template/skill/skill.md ~/.claude/skills/company/

# 런처 등록
cat >> ~/.zshrc << 'ZSHRC'
export VC_TEMPLATE="$HOME/make-company"
claude() {
  if [[ "$1" == "-company" || "$1" == "--company" ]]; then
    shift; bash "$VC_TEMPLATE/vc-launch.sh" "$@"
  else
    command claude "$@"
  fi
}
ZSHRC
source ~/.zshrc
```

### 2단계: Start

```bash
cd ~/your-project
claude -company
```

첫 실행 시 에이전트 선택 화면이 표시됩니다.

```
Virtual Company v2.1
Project: my-project

Available agents:
  1. CEO / Orchestrator (필수)
  2. Product Manager
  3. UI/UX Designer
  4. Frontend Engineer
  5. Backend Engineer
  6. Frontend QA
  7. Backend QA
  8. Marketing Strategist

Select agents (e.g., 1,2,4,5 or all):
```

### 3단계: Use

**CEO 모드** (window 0):
```
/company run Todo 앱에 우선순위와 필터 기능 추가
```

**특정 에이전트와 직접 대화** (tmux window 전환):
```
Ctrl+B -> 4    # Frontend 윈도우로 이동
> 이 컴포넌트를 반응형으로 만들어줘
```

**YAML 워크플로우 실행**:
```
/company workflow new-feature "검색 기능 추가"
```

---

## 대시보드

```
/company dashboard
```

사용 가능한 포트를 자동 탐지하고 웹 대시보드를 엽니다. Python 3 표준 라이브러리만 사용하는 서버가 API와 정적 파일을 동시에 제공합니다.

<p align="center">
  <img src="docs/screenshots/overview.png" alt="Overview - KPI 카드와 에이전트 상태 그리드" width="800" />
</p>

### 12개 탭

| 탭 | 설명 |
|----|------|
| **Overview** | KPI 카드 (전체/작업중/완료/대기), 에이전트 상태 그리드, 터미널 연결 버튼 |
| **Tickets** | 티켓/골 CRUD, 에이전트 할당, 상태 추적, 프리셋 기반 티켓 생성 |
| **Workflows** | React Flow 기반 비주얼 워크플로우 빌더, 자연어 생성, 실행 및 모니터링 |
| **Activity** | 실시간 SSE 기반 활동 로그, 에이전트별 필터링 |
| **Agents** | 에이전트 CRUD, AI 생성, 컬러 피커, 글로벌 에이전트 가져오기 |
| **Skills** | 50+ 스킬 브라우저, 카테고리 관리, 검색, 워크플로우 빌더, 에이전트별 커스터마이징 |
| **Health** | 병목 알림, 에이전트 성능 점수, 워크플로우 효율성 분석 |
| **Retro** | 회고 타임라인, 팀 공유 지식 베이스, 자동 생성된 개선 권고 |
| **Profile** | 에이전트별 메모리 뷰어, 성능 지표, 도구 프로필 관리 |
| **Harness** | 훅 실행 통계, 게이트 이력, 스킬 파이프라인, 워크플로우 규칙 맵 |
| **Docs** | 프로젝트 문서 브라우저 (에이전트/워크플로우/스킬 정의 파일 편집) |
| **Audit** | 구조화된 이벤트 로그 (JSONL), 필터링, 에이전트별 감사 추적 |

<p align="center">
  <img src="docs/screenshots/skills.png" alt="Skills - 50+ 스킬 관리" width="800" />
</p>

### 멀티 프로젝트

하나의 대시보드에서 여러 프로젝트를 관리합니다. Discord 스타일의 프로젝트 바가 좌측에 표시됩니다.

- 초록 점 = 활성 (tmux 세션 실행 중)
- 회색 점 = 오프라인
- 대시보드에서 바로 시작/중지
- 클릭 한 번으로 프로젝트 전환

### 웹 터미널

에이전트의 터미널 버튼을 클릭하면 브라우저에서 바로 터미널을 사용할 수 있습니다.

<p align="center">
  <img src="docs/screenshots/terminal.png" alt="웹 터미널 - xterm.js 기반 직접 키보드 입력" width="800" />
</p>

- **직접 키보드 입력** -- 네이티브 터미널처럼 바로 타이핑
- **풀 반응형** -- tmux 패인이 브라우저 너비에 자동 맞춤
- **ANSI 컬러 지원** -- Powerline 글리프, Claude Code TUI 정상 렌더링
- **스크롤백 유지** -- 닫았다 열어도 이력 보존
- **Canvas 렌더러** -- xterm.js v6 + 하드웨어 가속 Canvas addon

---

## 에이전트

기본 구성은 8명의 전문가로 이루어진 팀입니다.

| ID | 역할 | 담당 업무 |
|----|------|-----------|
| `ceo` | CEO / Orchestrator | 태스크 분석, 팀 위임, 병렬/순차 판단 |
| `product-manager` | Product Manager | Discovery, PRD, 기능 명세, IA, User Flow |
| `ui-ux-designer` | UI/UX Designer | 와이어프레임, 디자인 시스템, 컴포넌트 스펙 |
| `frontend-engineer` | Frontend Engineer | 디자인 스펙 -> 코드 구현 |
| `backend-engineer` | Backend Engineer | API/DB 설계 및 구현 |
| `fe-qa` | Frontend QA | UI/UX/접근성/반응형 검증 |
| `be-qa` | Backend QA | API 계약/통합/성능/보안 검증 |
| `marketing-strategist` | Marketing Strategist | 포지셔닝/메시징/채널 전략/카피 |

에이전트는 `.md` 파일로 정의됩니다. `~/.claude/agents/` (글로벌) 또는 `.claude/agents/` (프로젝트별)에 위치하며, 런타임에 프로젝트 컨텍스트와 누적 메모리가 자동 주입됩니다.

### 에이전트 라이브러리

기본 8명 외에 20+ 전문 에이전트가 카테고리별로 준비되어 있습니다.

| 카테고리 | 에이전트 |
|----------|----------|
| `leadership/` | CEO, CTO, Creative Director |
| `engineering/` | Frontend, Backend, Fullstack, Mobile, DevOps, Data Engineer, ML Engineer |
| `design/` | UI/UX, UI, UX, Brand, Art Director |
| `qa/` | FE-QA, BE-QA, Automation QA |
| `product/` | Product Manager |
| `marketing/` | Marketing Strategist, Content Writer, SEO, Social Media, Growth Hacker |
| `data/` | Data Analyst, Data Scientist |
| `external/` | Gemini (Google Gemini CLI 연동) |

프리셋을 통해 이 라이브러리에서 필요한 에이전트를 조합할 수 있습니다.

---

## 프리셋

프리셋은 팀 구성 템플릿입니다. 프로젝트 성격에 맞는 에이전트 조합을 한 번에 설정합니다.

| 프리셋 | 설명 | 에이전트 |
|--------|------|----------|
| **Default** | 9인 일반 회사 | CEO, PM, Design, Frontend, FE-QA, Backend, BE-QA, Marketing, CTO |
| **IT Startup** | 린 스타트업 | CEO, PM, Fullstack, DevOps, Growth, Designer, QA |
| **Web Design Agency** | 디자인 중심 웹 에이전시 | Director, UX/UI, Frontend, FE-QA, Marketing |
| **Solo Developer** | 1인 개발자 부스트 | CEO, Fullstack, Designer, Gemini |
| **Data Team** | 데이터 팀 | CTO, DataEng, DataAnalyst, DataScientist, MLEng |
| **Content Marketing** | 콘텐츠 마케팅 팀 | Strategist, Writer, SEO, Social, Analyst, Brand |

프리셋 적용:

```bash
# vc-launch.sh 셋업 시 프리셋 선택
claude -company
# -> 프리셋 목록에서 선택 또는 커스텀 구성
```

프리셋 파일은 `template/presets/` 디렉토리에 JSON으로 정의되며, 에이전트 라이브러리(`template/agents-library/`)에서 참조합니다. 프로젝트별 커스텀 프리셋도 `.claude/company/presets/`에 추가할 수 있습니다.

---

## 워크플로우

### 두 가지 실행 모드

#### CEO 모드 -- `/company run <task>`

메인 Claude가 CEO 역할을 수행하며 팀을 자율적으로 조율합니다.

```
/company run "음악 추천 SaaS를 기획부터 구현까지"
```

```
Main Claude (CEO 모드)
  |-> PM: PRD 작성              (Agent tool)
  |     -> PRD 반환
  |-> Designer + Backend        (병렬 Agent tool 호출)
  |     |-> 디자인 스펙 반환
  |     |-> API 설계 반환
  |-> Frontend: 구현            (양쪽 결과 수신)
  |     -> 코드 반환
  |-> QA: 검증
  |     -> 이슈 리포트 반환
```

CEO는 태스크 유형에 따라 동적으로 판단합니다.
- 신규 기능 -> PM 먼저
- UI 변경 -> Designer 직접
- 버그 수정 -> QA 먼저
- 독립 작업 -> 병렬 디스패치

#### 워크플로우 모드 -- `/company workflow <name> [input]`

YAML 파이프라인이 정의된 순서대로 실행되며, `depends_on` 필드로 의존성을 해석합니다.

```yaml
name: 신규 기능 개발
description: CEO 기획 -> PM PRD -> (Designer // Backend) -> Frontend -> (FE-QA // BE-QA)

steps:
  - id: planning
    agent: ceo
    prompt: |
      다음 요청을 분석하고 실행 계획을 수립해주세요:
      {{input}}
    output: plan

  - id: prd
    agent: product-manager
    prompt: |
      CEO 계획 기반으로 PRD를 작성해주세요:
      {{steps.planning.output}}
    depends_on: [planning]

  - id: design
    agent: ui-ux-designer
    prompt: |
      다음 PRD 기반으로 디자인 스펙을 작성해주세요:
      {{steps.prd.output}}
    depends_on: [prd]

  - id: backend
    agent: backend-engineer
    prompt: |
      다음 PRD 기반으로 API/DB 설계 및 구현을 해주세요:
      {{steps.prd.output}}
    depends_on: [prd]

  - id: frontend
    agent: frontend-engineer
    prompt: |
      디자인 스펙과 API 설계를 기반으로 프론트엔드를 구현해주세요:
      디자인: {{steps.design.output}}
      API: {{steps.backend.output}}
    depends_on: [design, backend]
```

### 내장 워크플로우

| 이름 | 파이프라인 | 파일 |
|------|-----------|------|
| **new-feature** | CEO -> PM -> (Designer // Backend) -> Frontend -> (FE-QA // BE-QA) | `new-feature.yml` |
| **bug-fix** | QA 진단 -> Engineer 수정 -> QA 검증 | `bug-fix.yml` |
| **design-only** | PM 요구사항 -> Designer 스펙 -> Frontend 구현 | `design-only.yml` |
| **marketing-launch** | PM 분석 -> (Marketing // Designer) -> CEO 최종 검토 | `marketing-launch.yml` |
| **feature-basic** | PM -> Design -> Frontend -> FE-QA (JSON 형식) | `feature-basic.json` |

### 워크플로우 에디터

대시보드의 Workflows 탭에서 비주얼 에디터를 제공합니다.

- **React Flow 기반** -- 노드 드래그, 연결선으로 의존성 설정
- **자연어 생성** -- "로그인 기능 추가" 입력 시 자동으로 워크플로우 생성
- **단계별 스킬 할당** -- 각 스텝에 적용할 스킬을 지정 가능
- **실행 모니터링** -- 실행 중 각 노드의 상태를 실시간으로 확인

---

## 스킬 시스템

스킬은 에이전트가 수행하는 재사용 가능한 작업 단위입니다. 대시보드의 Skills 탭에서 50+ 스킬을 관리합니다.

<p align="center">
  <img src="docs/screenshots/skills.png" alt="Skills - 카테고리 관리와 에이전트별 커스터마이징" width="800" />
</p>

### 카테고리 관리

스킬을 역할별 카테고리로 분류하고 필터링합니다.

- **내 스킬** -- 설치된 스킬 브라우저, 이름/카테고리 검색, 사용 통계
- **스킬 탐색** -- 로컬/커뮤니티 스킬 탐색
- **스킬 워크플로우** -- 스킬을 시각적 파이프라인으로 조합
- **카테고리 커스터마이징** -- 카테고리 생성/수정, 뱃지 색상 매핑

### 프로젝트별 커스텀

`.claude/company/skill-overrides.json`에서 프로젝트별 스킬 설정을 관리합니다. 원본 스킬 파일은 수정하지 않습니다.

```json
{
  "frontend-engineer": {
    "preferred_skills": ["react-component", "css-layout", "accessibility"],
    "disabled_skills": ["backend-api"]
  }
}
```

### 스킬 사용 추적

에이전트가 스킬을 사용할 때마다 자동으로 기록됩니다.

```
[SKILL_USED:react-component]    # 스킬 시작
[SKILL_DONE:react-component]    # 스킬 완료
```

이 데이터를 기반으로 에이전트별 성공률이 분석되고, 다음 태스크에서 스킬이 자동 추천됩니다.

---

## 하네스 엔지니어링

프롬프트는 가이드이고, 하네스는 보장입니다.

프롬프트는 "JSONL에 로깅하세요"라고 말하지만, 모델이 바쁘면 건너뜁니다. 하네스는 모델이 지시를 따르든 말든 **코드로 강제 실행**합니다. [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)과 [Phil Schmid](https://www.philschmid.de/agent-harness-2026)의 패턴을 기반으로 합니다.

### 3층 구조

```
Prompt Layer (skill.md)         -- 가이드 (CEO가 따르기를 기대)
     |
Code Layer (hooks)              -- 강제 (100% 실행 보장)
     |  |-- agent-harness.sh    -- Agent tool 호출 시 자동 JSONL 로깅
     |  |-- session-boot.sh     -- 세션 시작 시 상태 복원 + 건강 체크
     |  |-- auto-retro.sh       -- CEO가 회고를 잊으면 자동 알림
     |  |-- workflow-harness.sh  -- 워크플로우 실행 검증
     |  |-- ctx-compact-check.sh-- 컨텍스트 사용량 자동 모니터링
     |
Server Layer (server.py)        -- 검증 + 분석 (API)
     |-- harness/health          -- 환경 건강 점수 (0-100)
     |-- harness/progress        -- 자동 생성 진행 요약
     |-- harness/checklist       -- 미완료 태스크 감지
     |-- harness/drift           -- 모델 드리프트 감지 (50+ 이벤트)
     |-- harness/validate        -- 에이전트 출력 품질 게이트
```

### 훅 (Code Layer)

| 훅 | 트리거 | 역할 |
|----|--------|------|
| `agent-harness.sh` | PostToolUse | Agent 호출을 JSONL에 자동 로깅, 파일 변경 추적, 10회 편집마다 체크포인트 제안, 파괴적 명령 감지 |
| `session-boot.sh` | UserPromptSubmit | `/company run` 시 마지막 세션 상태 복원, 회고 action item 주입, 건강 점수 표시, 누락 디렉토리 자동 생성 |
| `auto-retro.sh` | PostToolUse | `task_end` 후 `retro_saved` 없으면 CEO에게 회고 실행 알림 |
| `workflow-harness.sh` | PostToolUse | 워크플로우 단계 실행 검증, 의존성 미충족 경고 |
| `ctx-compact-check.sh` | PostToolUse | 컨텍스트 사용량 모니터링, 임계값 초과 시 compact 제안 |

### 서버 API (Server Layer)

| 엔드포인트 | 역할 |
|------------|------|
| `GET harness/health` | 7개 항목 환경 체크: tmux, config, agents, dirs, memory, retros. 0-100점 반환 |
| `GET harness/progress` | activity.jsonl에서 자동 생성하는 진행 요약 (Anthropic의 claude-progress.txt 패턴) |
| `GET harness/checklist` | 시작했지만 미완료된 태스크 + 회고 없이 종료된 태스크 탐지 |
| `GET harness/drift` | 에이전트 행동 변화 감지: 50%+ 소요시간 증가 또는 20%+ 품질 하락 |
| `POST harness/validate` | 출력 품질 게이트: 너무 짧은 출력 거부, 에러 패턴 감지, 미해결 TODO 플래그 |

### 프롬프트 vs 하네스

```
프롬프트: "Agent 호출 후 JSONL에 로깅하세요"
  -> 모델이 바쁘면? 건너뜀. 컨텍스트 가득 차면? 잊음. 새 세션? 소실.

하네스: PostToolUse 훅이 모든 Agent tool 호출에 실행
  -> 항상 실행. 예외 없음. 데이터 보장.
```

---

## 지능 시스템

<p align="center">
  <img src="docs/screenshots/profile.png" alt="Agent Profile - 메모리, 성능, 도구 관리" width="800" />
</p>

### 에이전트 메모리

각 에이전트는 세션을 넘어 구조화된 지식을 축적합니다.

```markdown
## Learnings
- [2026-04-09] API 계약서를 핸드오프 전 확정할 것 (confidence:8, source:retro-001)

## Patterns
- Next.js static export + Python server: same-origin API, NEXT_PUBLIC 불필요

## Self-Assessment
- 평균 품질: 7.2/10 (최근 5개 태스크)
- 강점: API 계약 준수, 타입 정의
- 약점: 빈 상태 처리 (3/5 태스크)
```

메모리는 `.claude/company/agent-memory/` 디렉토리에 에이전트별 마크다운 파일로 저장됩니다. 매 태스크 완료 시 회고 결과가 자동으로 반영됩니다.

### 공유 지식

에이전트 간 교차 학습입니다. FE-QA가 발견한 내용이 다음 태스크에서 Frontend Engineer에게 자동 제공됩니다.

```json
{
  "author": "fe-qa",
  "type": "pitfall",
  "key": "xss-escape",
  "insight": "모든 동적 콘텐츠에 escapeHtml 적용 필요",
  "confidence": 9,
  "relevant_agents": ["frontend-engineer", "backend-engineer"]
}
```

공유 지식은 `.claude/company/shared-knowledge.jsonl`에 누적되며, 핸드오프 관계에 있는 에이전트에게 자동 전파됩니다.

### 회고 시스템

모든 태스크 완료 후 자동 회고가 실행됩니다.

1. 각 참여 에이전트에게 자기평가 수집 (잘된 점, 문제점, 개선점, 품질 점수)
2. CEO가 종합 요약 작성
3. `.claude/company/retrospectives/`에 JSON으로 저장
4. action item이 에이전트 메모리에 자동 반영
5. 다음 태스크에서 유사 회고를 참조하여 같은 실수 방지

### 성능 분석

- **에이전트 점수**: 완료 태스크 수, 품질 추이, 에러율, 소요시간
- **워크플로우 병목 감지**: 가장 느린 단계 식별, 병렬화 제안
- **자기 개선 루프**: 회고 -> action item -> 에이전트 메모리 -> 행동 개선

### 도구 프로필

에이전트별 도구 사용 선호도를 설정합니다 (Claude Code MCP는 글로벌이므로, 프롬프트 기반으로 에이전트별 관리).

```json
{
  "frontend-engineer": {
    "preferred": ["Read", "Write", "Edit", "Bash", "chrome-devtools"],
    "avoid": ["WebSearch"],
    "instructions": "chrome-devtools MCP로 브라우저 테스트 수행"
  }
}
```

---

## 명령어 참조

### `/company` 서브커맨드

| 명령어 | 설명 |
|--------|------|
| `claude -company` | tmux 세션 시작 (에이전트 선택 + 모든 윈도우 생성) |
| `/company setup` | 에이전트 선택 + 프로젝트 설정 |
| `/company run <task>` | 멀티에이전트 모드 (CEO 자율 조율) |
| `/company workflow <name> [input]` | 워크플로우 모드 (YAML 파이프라인 실행) |
| `/company dashboard` | 웹 대시보드 시작 (자동 포트 + 브라우저 열기) |
| `/company memory [agent-id]` | 에이전트 메모리 조회/수정 |
| `/company retro` | 회고 목록 조회/분석 |
| `/company upgrade` | 최신 버전으로 업그레이드 |

### tmux 키보드 단축키

| 키 | 동작 |
|----|------|
| `Ctrl+B -> 0~8` | 윈도우 전환 |
| `Ctrl+B -> d` | 세션 분리 (백그라운드 유지) |
| `claude -company` | 기존 세션에 다시 연결 |
| `Ctrl+B -> &` | 현재 윈도우 닫기 |

---

## 아키텍처

### 디렉토리 구조

```
make-company/
├── vc-launch.sh                   # claude -company 런처
├── VERSION                        # 버전 (자동 업그레이드 체크)
├── bin/
│   ├── cli.js                     # npx make-company 진입점
│   ├── vc-update-check            # gstack 스타일 버전 체크
│   ├── vc-upgrade                 # 업그레이드 스크립트
│   └── vc-usage-monitor           # 컨텍스트 사용량 모니터
├── template/
│   ├── agents-v2/                 # 기본 8명 에이전트 정의 (.md)
│   ├── agents-library/            # 20+ 확장 에이전트 라이브러리
│   │   ├── leadership/            # CEO, CTO, Creative Director
│   │   ├── engineering/           # FE, BE, Fullstack, Mobile, DevOps ...
│   │   ├── design/                # UI/UX, Brand, Art Director ...
│   │   ├── qa/                    # FE-QA, BE-QA, Automation QA
│   │   ├── product/               # PM
│   │   ├── marketing/             # Marketing, Content, SEO, Social ...
│   │   ├── data/                  # Data Analyst, Data Scientist
│   │   └── external/              # Gemini
│   ├── presets/                   # 6종 팀 구성 프리셋 (JSON)
│   ├── workflows/                 # 5종 YAML/JSON 워크플로우
│   ├── skill/                     # /company 스킬 정의
│   ├── hooks/                     # 하네스 훅 (10개)
│   ├── scripts/                   # 유틸리티 스크립트
│   ├── dashboard/
│   │   └── server.py              # Python stdlib API 서버 (의존성 0)
│   └── dashboard-next-v2/         # Next.js 대시보드 소스
│       ├── app/                   # App Router
│       ├── components/dashboard/  # 12개 탭 컴포넌트
│       └── lib/                   # API 클라이언트, 타입, 유틸
```

### 프로젝트별 데이터 파일

```
.claude/company/
├── config.json              # 프로젝트 + 에이전트 설정
├── activity.log             # 사람이 읽는 활동 로그
├── activity.jsonl           # 기계가 읽는 구조화 이벤트
├── shared-knowledge.jsonl   # 에이전트 간 공유 지식
├── agent-memory/            # 에이전트별 구조화 메모리 (.md)
├── agent-output/            # 에이전트별 출력 로그
├── retrospectives/          # 자동 생성 회고 JSON
├── analytics/               # 점수, 사용량, 추이 데이터
├── tool-profiles.json       # 에이전트별 도구 선호도
├── skill-overrides.json     # 프로젝트별 스킬 커스터마이징
├── improvements/            # 자기 개선 권고
└── dashboard/               # 서버 + 정적 대시보드 (out/)
```

### 기술 스택

| 영역 | 기술 |
|------|------|
| **오케스트레이션** | Claude Code Agent tool (네이티브 `subagent_type` 매핑) |
| **세션 관리** | tmux (에이전트당 1개 윈도우) |
| **서버** | Python 3 stdlib `ThreadingHTTPServer` (외부 의존성 0) |
| **대시보드** | Next.js 16 + shadcn/ui + React Flow + xterm.js v6 (정적 export) |
| **터미널** | xterm.js + Canvas addon, tmux `pipe-pane` + `send-keys` |
| **데이터** | 파일 기반 (JSONL: append, JSON: snapshot, Markdown: 메모리) |
| **스크립트** | Bash 3.x 호환 (macOS 기본 Bash 지원) |

---

## 트러블슈팅

<details>
<summary><code>claude</code> 명령어를 찾을 수 없음</summary>

```bash
npm install -g @anthropic-ai/claude-code
```
</details>

<details>
<summary><code>tmux</code> 명령어를 찾을 수 없음</summary>

```bash
brew install tmux          # macOS
sudo apt install tmux      # Ubuntu/Debian
```
</details>

<details>
<summary>대시보드 포트 충돌</summary>

```bash
lsof -ti:7777 | xargs kill                              # 기존 프로세스 종료
python3 .claude/company/dashboard/server.py 8080         # 다른 포트 사용
```
</details>

<details>
<summary><code>/company</code> 스킬이 인식되지 않음</summary>

```bash
ls ~/.claude/skills/company/skill.md
# 파일이 없으면:
mkdir -p ~/.claude/skills/company
cp ~/make-company/template/skill/skill.md ~/.claude/skills/company/
```
</details>

<details>
<summary>에이전트가 응답하지 않음</summary>

- Claude Code 로그인 확인: `claude` 실행
- Anthropic API 키 또는 Claude Pro/Max 구독 확인
- 네트워크 연결 확인
</details>

<details>
<summary>기존 프로젝트에 에이전트가 있는 경우</summary>

`.claude/agents/`에 이미 커스텀 에이전트가 있어도 `/company setup`이 자동 감지합니다. v2 플레이스홀더(`{{project_context}}`, `{{agent_memory}}`)가 없는 에이전트는 마이그레이션을 제안하며, 기존 내용을 수정하지 않고 플레이스홀더만 추가합니다.
</details>

<details>
<summary>하네스 건강 점수가 낮음</summary>

```bash
# 대시보드 Health 탭에서 상세 확인 또는 직접 API 호출
curl http://localhost:7777/api/your-project/harness/health
```

주요 원인: 누락된 디렉토리, config.json 오류, 에이전트 파일 부재. `session-boot.sh` 훅이 세션 시작 시 자동으로 디렉토리를 복구합니다.
</details>

---

## 기여 가이드

PR을 환영합니다.

- **새 에이전트**: `template/agents-library/<category>/`에 `.md` 파일 추가
- **새 워크플로우**: `template/workflows/`에 `.yml` 파일 추가
- **새 프리셋**: `template/presets/`에 `.json` 파일 추가
- **대시보드 UI**: [DESIGN.md](DESIGN.md) 참조 -- dark-first, 단일 인디고 액센트 (#5e6ad2), Geist 폰트
- **하네스 훅**: `template/hooks/`에 추가, `tests/test-harness.sh`로 테스트

### 테스트

```bash
bash tests/test-harness.sh            # 하네스 전체 테스트
bash tests/test-harness.sh --verbose  # 상세 출력
```

---

## 라이선스

MIT -- [LICENSE](LICENSE) 참조.

---

<div align="center">

Built with Claude Code.

</div>

> **v1 (tmux 메시지 버스)는 deprecated되었습니다.** v2 (Claude Code Agent tool)가 기본입니다.
