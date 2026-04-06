# Virtual Company — Multi-Agent Orchestration System

Claude Code + Gemini CLI 기반의 멀티 에이전트 협업 시스템.
tmux 세션에서 각 에이전트가 **독립된 대화형 세션**으로 실행되며, **파일 기반 메시지 버스**로 통신합니다.

---

## 빠른 시작

```bash
# 0. 초기 설정 (회사 이름, 세션명, compact 임계치)
bash .claude/company/setup.sh

# 1. 회사 시작
bash .claude/company/run.sh

# 2. 태스크 전달
bash .claude/company/kickoff.sh '태그 자동 추천 기능 추가해줘'

# 3. 실시간 모니터링
tmux attach -t mindlink-company
# Ctrl+B → 숫자로 윈도우 전환 (0=Monitor, 1=Orch, 2=PM ...)

# 4. 종료
bash .claude/company/stop.sh
```

### Claude Code 대화 중 사용

```
# 슬래시 커맨드
/kickoff 디자인 개선해줘

# @회사 접두사 (훅이 자동 전달)
@회사 그래프 성능 최적화해줘
```

---

## 아키텍처

```
사용자 (CEO)
  ↓ @회사 / /kickoff
Claude Code (이 대화) — 전략, 의사결정
  ↓ kickoff.sh
┌──────────────────────────────────────────────────┐
│ tmux: mindlink-company                           │
│                                                  │
│ [0] Monitor  — 전체 상태 + 채널 실시간 표시       │
│ [1] Orch     — 오케스트레이터 (태스크 분배)       │
│ [2] PM       — 기획 (PRD, 유저스토리)             │
│ [3] Design   — UI/UX 설계                        │
│ [4] Frontend — 프론트엔드 개발                    │
│ [5] FE-QA    — 프론트엔드 품질 검증               │
│ [6] Backend  — 백엔드 개발                        │
│ [7] BE-QA    — 백엔드 품질 검증                   │
│ [8] Marketing— 마케팅 전략                        │
│ [9] Gemini   — 외부 자문 / 코드 리뷰 / 토론       │
│ [10] Router  — 메시지 라우팅 데몬                  │
└──────────────────────────────────────────────────┘
```

### 통신 흐름

```
kickoff.sh "기능 추가"
  → inbox/orch.md
  → Orch가 분석 → "@pm PRD 작성, @design UI 설계, @gemini 의견 부탁"
  → outbox/orch.md
  → router.sh가 @mention 파싱
  → inbox/pm.md, inbox/design.md, inbox/gemini.md
  → 각 에이전트 응답 → outbox → router → 다음 에이전트
  → 전체 흐름이 channel/general.md에 실시간 기록
```

### 메시지 버스

| 디렉토리 | 용도 |
|----------|------|
| `inbox/{agent}.md` | 에이전트 수신함 (라우터가 기록) |
| `outbox/{agent}.md` | 에이전트 발신함 (워처가 캡처) |
| `channel/general.md` | 전체 공용 채널 (모니터에 표시) |
| `state/{agent}.state` | 상태: idle, working, compacting, error... |

---

## config.json — 프로젝트별 설정

```json
{
  "project": "MindLink",
  "session_name": "mindlink-company",
  "compact_threshold": 50,
  "skill_index_refresh_interval": 300,
  "agents": [
    { "id": "orch",     "engine": "claude", "agent_file": "ceo",        "label": "Orch" },
    { "id": "pm",       "engine": "claude", "agent_file": "product-manager", "label": "PM" },
    { "id": "gemini",   "engine": "gemini", "agent_file": "",           "label": "Gemini" }
  ]
}
```

**다른 프로젝트에 적용할 때:**

1. `.claude/company/` 디렉토리를 복사
2. `config.json`의 `project`, `session_name`, `agents` 수정
3. `.claude/agents/`에 에이전트 정의 파일 작성
4. `bash .claude/company/run.sh`

---

## 스킬 자동 탐색

수동 매핑 없이, 스킬 디렉토리를 스캔하여 메시지에 맞는 스킬을 자동 추천합니다.

### 동작 원리

```
스킬 설치/업데이트
  ↓
build-skill-index.sh — 프로젝트+글로벌 스킬 스캔 → skill-index.json
  ↓
에이전트에 메시지 전달 시
  ↓
suggest-skills.sh — 에이전트 역할 + 메시지 키워드 ↔ 인덱스 매칭
  ↓
상위 3개 추천 → 메시지에 첨부
```

### 스캔 대상

| 경로 | 타입 |
|------|------|
| `.claude/skills/*/SKILL.md` | 프로젝트 스킬 |
| `~/.claude/skills/*/SKILL.md` | 글로벌 스킬 |

### 수동 재인덱싱

```bash
OUTPUT=.claude/company/skill-index.json \
PROJECT_DIR=$(pwd) \
bash .claude/company/scripts/build-skill-index.sh
```

### 추천 테스트

```bash
bash .claude/company/scripts/suggest-skills.sh "frontend" "버그 디버깅"
# → [추천: /investigate, /webapp-testing, /browse]
```

### 토큰 절약 효과

```
변경 전: 50+ 스킬 전부 system prompt에 로드 = ~8,000 토큰/메시지
변경 후: 관련 3개만 첨부                     = ~100 토큰/메시지
절약:    ~98%
```

---

## 자동 Compact

각 Claude 에이전트는 **대화형 세션**으로 실행되어 컨텍스트가 누적됩니다.
워처가 `ctx:XX%`를 모니터링하여 `compact_threshold`(기본 50%) 초과 시 자동으로 `/compact`를 실행합니다.

```
에이전트 응답 완료
  ↓
워처: tmux capture-pane → ctx:XX% 파싱
  ↓
50% 초과? → tmux send-keys "/compact" Enter
  ↓
상태: "compacting" → 완료 후 "idle"
```

---

## 에이전트 상태 목록

| 상태 | 의미 |
|------|------|
| `idle` | 대기 중 |
| `working` | 메시지 처리 중 |
| `compacting` | /compact 실행 중 |
| `booting` | 초기화 중 |
| `error` | 오류 발생 |
| `rate-limited` | 토큰/API 리밋 |
| `done` | [TASK COMPLETE] 수신 |
| `stopped` | 세션 종료됨 |

---

## 파일 구조

```
.claude/company/
├── config.json              ← 프로젝트별 설정 (에이전트, 세션명 등)
├── run.sh                   ← 회사 시작 (config.json 기반 동적 생성)
├── stop.sh                  ← 회사 종료
├── kickoff.sh               ← Orchestrator에 태스크 전달
├── router.sh                ← @mention 기반 메시지 라우팅 데몬
├── monitor.sh               ← 실시간 대시보드
├── skill-index.json         ← 자동 생성 (스킬 인덱스)
├── agents/
│   ├── run-agent.sh         ← Claude 대화형 에이전트 러너
│   └── run-gemini.sh        ← Gemini 대화형 에이전트 러너
├── scripts/
│   ├── build-skill-index.sh ← 스킬 디렉토리 스캔 → 인덱스 생성
│   └── suggest-skills.sh    ← 메시지 기반 스킬 추천
├── inbox/                   ← 런타임: 에이전트 수신함
├── outbox/                  ← 런타임: 에이전트 발신함
├── channel/                 ← 런타임: 전체 채널
├── state/                   ← 런타임: 에이전트 상태
└── logs/                    ← 런타임: 로그

.claude/agents/              ← 에이전트 정의 파일 (프로젝트별)
├── ceo.md                   ← Orchestrator가 사용
├── product-manager.md
├── ui-ux-designer.md
├── frontend-engineer.md
├── backend-engineer.md
├── fe-qa.md
├── be-qa.md
└── marketing-strategist.md

.claude/hooks/
├── start-company.sh         ← 대화 시작 시 자동 실행
└── ...

.claude/skills/kickoff/
└── SKILL.md                 ← /kickoff 슬래시 커맨드
```

---

## 다른 프로젝트에 적용하기

### 1. 디렉토리 복사

```bash
cp -r .claude/company/ /path/to/new-project/.claude/company/
```

### 2. config.json 수정

```json
{
  "project": "NewProject",
  "session_name": "newproject-company",
  "agents": [
    { "id": "orch",  "engine": "claude", "agent_file": "orchestrator", "label": "Orch" },
    { "id": "dev",   "engine": "claude", "agent_file": "developer",    "label": "Dev" },
    { "id": "review","engine": "gemini", "agent_file": "",             "label": "Reviewer" }
  ]
}
```

### 3. 에이전트 정의 작성

```bash
# .claude/agents/orchestrator.md
# .claude/agents/developer.md
# 각 에이전트의 역할, 전문성, 통신 프로토콜 정의
```

### 4. 시작

```bash
bash .claude/company/run.sh
bash .claude/company/kickoff.sh '첫 번째 태스크'
```

에이전트 메모리(`agent-memory/`)가 프로젝트별로 자동 축적되므로, 사용할수록 프로젝트에 특화됩니다.

---

## 요구사항

- macOS / Linux
- tmux
- python3
- Claude Code CLI (`claude`)
- Gemini CLI (`gemini`) — Gemini 에이전트 사용 시
