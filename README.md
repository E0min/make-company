# Virtual Company — Multi-Agent Orchestration System

Claude Code + Gemini CLI 기반의 멀티 에이전트 협업 시스템.
tmux 세션에서 9명의 에이전트가 **독립된 대화형 세션**으로 실행되며, **파일 기반 메시지 버스**로 통신합니다.

---

## 빠른 시작

### 새 프로젝트에 설치

```bash
# 1. virtual-company 저장소를 한 번 클론 (어디든)
git clone https://github.com/<your>/virtual-company.git ~/virtual-company

# 2. 적용할 프로젝트 디렉토리로 이동
cd ~/내프로젝트

# 3. install.sh 실행 (대화형 setup 자동 진입)
bash ~/virtual-company/install.sh
```

`install.sh`가 자동으로:
- `.claude/company/` — 모든 스크립트, 디렉토리 생성
- `.claude/agents/` — 8개 에이전트 정의 파일 복사 (기존 파일 보존)
- 대화형 setup으로 회사명, 세션명, compact 임계치 설정

### 시작 → 사용 → 종료

```bash
# 회사 시작
bash .claude/company/run.sh

# 태스크 전달 (Orchestrator가 받아서 적절한 팀원에게 위임)
bash .claude/company/kickoff.sh '@pm 태그 자동 추천 기능 PRD 작성'

# 또는 --watch 모드 (kickoff 후 자동으로 모니터 진입)
bash .claude/company/kickoff.sh --watch '@design 다크모드 UI 개선'

# 실시간 모니터링
tmux attach -t {세션명}
# Ctrl+B → 숫자로 윈도우 전환 (0=Monitor, 1=Orch, 2=PM ...)

# 개별 에이전트 재시작 (zombie watcher 방지)
bash .claude/company/restart-agent.sh pm

# 종료
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
  ↓ kickoff.sh / @회사 / /kickoff
┌──────────────────────────────────────────────────┐
│ tmux: {프로젝트}-company                          │
│                                                  │
│ [0] Monitor   — 실시간 대시보드 (상태/태스크/채널) │
│ [1] Orch      — 오케스트레이터 (CEO, 위임)        │
│ [2] PM        — 기획 (PRD, 유저스토리)            │
│ [3] Design    — UI/UX 설계                       │
│ [4] Frontend  — 프론트엔드 개발                   │
│ [5] FE-QA     — 프론트엔드 품질 검증              │
│ [6] Backend   — 백엔드 개발                       │
│ [7] BE-QA     — 백엔드 품질 검증                  │
│ [8] Marketing — 마케팅 전략                       │
│ [9] Gemini    — 외부 자문 / 코드 리뷰 / 토론      │
│ [10] Router   — 메시지 라우팅 데몬                │
└──────────────────────────────────────────────────┘
```

### 통신 흐름

```
kickoff.sh "기능 추가"
  → state/tasks/{task_id}.json 생성 (status: created)
  → state/current_task.txt에 ID 기록
  → inbox/orch.md에 [TEAM-TASK] 메시지 추가
  ↓
Orch 에이전트의 watcher가 inbox 감지
  → 메시지를 tmux send-keys로 Claude에 전달
  → status: working
  → Orch가 분석 → "@pm PRD 작성, @design UI 설계"
  → watcher가 응답을 outbox/orch.md에 캡처
  → status: done
  ↓
router.sh가 outbox 감지
  → @mention 파싱 (자기 멘션 차단)
  → inbox/pm.md, inbox/design.md에 [TEAM-MSG] 추가
  → status: routed
  ↓
PM, Design 각각 동일 사이클 반복
  ↓
모든 흐름이 channel/general.md에 실시간 기록
```

### 메시지 버스

| 디렉토리/파일 | 용도 |
|----------|------|
| `inbox/{agent}.md` | 에이전트 수신함 (라우터/kickoff가 기록) |
| `outbox/{agent}.md` | 에이전트 발신함 (워처가 캡처) |
| `channel/general.md` | 전체 공용 채널 (모니터에 표시) |
| `state/{agent}.state` | 상태 + 타임스탬프 |
| `state/{agent}.heartbeat` | 30초+ 무갱신 시 죽음 감지 |
| `state/tasks/{task_id}.json` | 태스크 라이프사이클 추적 |
| `state/current_task.txt` | 현재 태스크 ID (status 갱신용) |
| `.archive/` | 1MB 초과 시 자동 회전된 로그 |

---

## config.json — 프로젝트별 설정

```json
{
  "project": "MyProject",
  "session_name": "myproject-company",
  "compact_threshold": 50,
  "agents": [
    { "id": "orch",     "engine": "claude", "agent_file": "ceo",                "label": "Orch" },
    { "id": "pm",       "engine": "claude", "agent_file": "product-manager",    "label": "PM" },
    { "id": "design",   "engine": "claude", "agent_file": "ui-ux-designer",     "label": "Design" },
    { "id": "frontend", "engine": "claude", "agent_file": "frontend-engineer",  "label": "Frontend" },
    { "id": "fe-qa",    "engine": "claude", "agent_file": "fe-qa",              "label": "FE-QA" },
    { "id": "backend",  "engine": "claude", "agent_file": "backend-engineer",   "label": "Backend" },
    { "id": "be-qa",    "engine": "claude", "agent_file": "be-qa",              "label": "BE-QA" },
    { "id": "marketing","engine": "claude", "agent_file": "marketing-strategist","label": "Marketing" },
    { "id": "gemini",   "engine": "gemini", "agent_file": "",                   "label": "Gemini" }
  ]
}
```

`agent_file`은 `.claude/agents/{agent_file}.md`를 가리킵니다 (Claude `--agent` 모드 로드).

---

## 에이전트 정의 파일 (`.claude/agents/`)

`install.sh`가 8개 기본 에이전트 정의를 자동 복사합니다:

| 파일 | 역할 |
|------|------|
| `ceo.md` | Orchestrator — 태스크 분석 + 위임 |
| `product-manager.md` | PRD, 유저스토리, 우선순위 |
| `ui-ux-designer.md` | 와이어프레임, 디자인 시스템 |
| `frontend-engineer.md` | UI 컴포넌트 구현 |
| `backend-engineer.md` | API, DB, 비즈니스 로직 |
| `fe-qa.md` / `be-qa.md` | 품질 검증, 버그 리포트 |
| `marketing-strategist.md` | 마케팅, 콘텐츠 |

각 파일은 "당신은 지금 tmux 세션 안에서 실행 중인 ... 에이전트입니다"로 시작하여 시스템 자각을 명시하고, 응답에 `@에이전트ID`를 쓰면 자동 라우팅됨을 알려줍니다.

기존 파일이 있으면 보존됩니다 — 사용자 커스텀 우선.

---

## 자동 Compact

각 Claude 에이전트는 **대화형 세션**으로 실행되어 컨텍스트가 누적됩니다.
워처가 `ctx:XX%`를 모니터링하여 `compact_threshold` 초과 시 자동 `/compact` 실행.
`is_ready()` 폴링으로 compact 완료를 확인 (sleep 하드코딩 제거).

---

## 응답 추출 — 화이트리스트 필터

watcher는 tmux scrollback에서 Claude 응답을 추출할 때 **⏺ 마커 + 들여쓰기 텍스트**만 보존합니다.
도구 호출(`Bash(...)`, `Read(...)` 등 13종), thinking 인디케이터(`✻ Cogitated`), 권한 프롬프트, 박스 문자(`├└│⎿`)는 자동 제거.

서브에이전트 실행이 완료될 때까지 안정화 대기:
- `is_ready()` 연속 3회 + scrollback 줄 수 변화 없음 = 진짜 완료
- 권한 프롬프트 자동 승인 (5회 상한, 초과 시 error)
- 최대 300초 대기 후 timeout 상태 전환

---

## 에이전트 상태 목록

| 상태 | 의미 |
|------|------|
| `idle` | ○ 대기 중 |
| `working` | ● 메시지 처리 중 |
| `compacting` | ♻ /compact 실행 중 |
| `booting` | ⏳ 초기화 중 |
| `error` | ✗ 오류 (승인 5회 초과 등) |
| `timeout` | ⏱ 300초 응답 대기 초과 |
| `dead` | 💀 heartbeat 30초+ 무갱신 |
| `rate-limited` | ⏳ 토큰/API 리밋 |
| `done` | ✓ [TASK COMPLETE] 수신 |
| `stopped` | ■ 세션 종료됨 |

---

## 태스크 추적

`kickoff.sh`로 보낸 모든 태스크는 `state/tasks/{task_id}.json`에 기록됩니다:

```json
{
  "id": "task_1775501283_22276",
  "status": "done",
  "created_at": "2026-04-07 03:48:03",
  "task": "@pm 6차 업그레이드 완료 확인..."
}
```

라이프사이클: `created → working → routed → done`

모니터 상단에 현재 태스크 상태가 표시됩니다.

---

## 파일 구조

```
.claude/company/
├── config.json              ← 프로젝트별 설정 (자동 생성)
├── config.json.default      ← 기본값 (참조용)
├── run.sh                   ← 회사 시작 (config.json 기반 동적 생성)
├── stop.sh                  ← 회사 종료
├── kickoff.sh               ← Orchestrator에 태스크 전달 (--watch 옵션)
├── restart-agent.sh         ← 개별 에이전트 재시작 (zombie 방지)
├── router.sh                ← @mention 기반 메시지 라우팅 데몬
├── monitor.sh               ← 실시간 대시보드
├── setup.sh                 ← 대화형 설정
├── agents/
│   ├── run-agent.sh         ← Claude 대화형 에이전트 러너
│   └── run-gemini.sh        ← Gemini 대화형 에이전트 러너
├── scripts/
│   ├── build-skill-index.sh ← 스킬 디렉토리 스캔
│   └── suggest-skills.sh    ← 메시지 기반 스킬 추천
├── inbox/                   ← 런타임: 에이전트 수신함
├── outbox/                  ← 런타임: 에이전트 발신함
├── channel/                 ← 런타임: 전체 채널
├── state/                   ← 런타임: 에이전트 상태 + heartbeat + 태스크
│   ├── tasks/               ← 태스크 라이프사이클 JSON
│   └── current_task.txt     ← 현재 태스크 ID
├── logs/                    ← 런타임: router.log
└── .archive/                ← 자동 회전된 로그 (1MB+)

.claude/agents/              ← 에이전트 정의 파일 (install.sh가 자동 복사)
├── ceo.md                   ← Orchestrator 정의
├── product-manager.md
├── ui-ux-designer.md
├── frontend-engineer.md
├── backend-engineer.md
├── fe-qa.md
├── be-qa.md
└── marketing-strategist.md
```

---

## 요구사항

- **macOS / Linux** (tmux 의존)
- **tmux** — `brew install tmux` / `apt install tmux`
- **python3** — 설정 파싱 (대부분 시스템 기본)
- **Claude Code CLI** (`claude`) — 8명의 Claude 에이전트
- **Gemini CLI** (`gemini`) — Gemini 에이전트 (선택, 없으면 9번째만 booting 유지)

---

## 안정성 기능

| 기능 | 설명 |
|------|------|
| Atomic mv 패턴 | inbox/outbox 읽기 시 TOCTOU race 방지 |
| Signal trap | 종료 시 watcher + temp 파일 자동 정리 |
| Heartbeat | 30초+ 무갱신 시 모니터에 💀 표시 |
| 자기 멘션 차단 | router가 sender == recipient 시 무한 루프 방지 |
| 권한 자동 승인 | 5회 상한 + 초과 시 error 전환 |
| 로그 회전 | 1MB 초과 시 `.archive/`로 이동 |
| 타임아웃 | 300초 응답 없으면 timeout 상태 |
| Config 검증 | 필수 키, 에이전트 배열 시작 시 검사 |
| 한글 정렬 | UTF-8 표시폭 기반 truncate |
