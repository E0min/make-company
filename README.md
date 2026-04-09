<div align="center">

# make-company

### One command. Eight AI agents. Ship faster.

**한 마디로 기획 → 디자인 → 구현 → QA까지.**

```bash
claude -company
> "할일 앱 만들어줘"
# → PM이 기획 → Designer가 디자인 → Frontend가 구현 → QA가 검증
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-v2.1+-5e6ad2)](https://docs.anthropic.com/en/docs/claude-code)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Bash](https://img.shields.io/badge/Bash-3.x%2B-1f425f?logo=gnu-bash)](https://www.gnu.org/software/bash/)

</div>

---

## What is this?

`make-company` turns your Claude Code into an **8-person AI team**.

Claude Code = one brilliant developer.
make-company = that developer leading a full team of specialists.

```
You: "Build a todo app"

  CEO     → analyzes, delegates
  PM      → writes PRD
  Designer ─┐
  Backend  ─┤ work in parallel
  Frontend ← takes both outputs, builds
  QA      → tests everything
```

Each agent runs as an independent `claude --agent` session in its own tmux window. Talk to any of them directly, or let the CEO orchestrate everything.

### Why make-company? (기본 Claude Code와 뭐가 다른가)

Claude Code는 이미 훌륭한 AI 코딩 도구입니다. make-company는 그 위에 **조직**을 얹습니다.

| | 기본 Claude Code | make-company |
|---|---|---|
| **역할** | 하나의 범용 AI | CEO, PM, Designer, FE, BE, QA, Marketing **7가지 전문 역할** |
| **지시 방식** | 사용자가 매번 직접 지시 | "할일 앱 만들어" 한 마디 → **CEO가 알아서 팀 분배** |
| **기획 → 구현** | 한 맥락에서 전부 처리 | PM이 PRD 작성 → Designer가 스펙 → **FE가 구현 → QA가 검증** |
| **병렬 처리** | 순차 실행 | Designer + Backend **동시 호출**, 시간 절반 |
| **품질 검증** | 사용자가 직접 리뷰 | **FE-QA / BE-QA가 자동 검증** 후 이슈 리포트 |
| **누적 학습** | 대화 끝나면 리셋 | 에이전트별 **메모리가 누적** — 다음 대화에서도 프로젝트 이해 |
| **워크플로우** | 없음 | YAML로 파이프라인 정의, **반복 실행** 가능 |
| **모니터링** | 터미널 출력만 | **웹 대시보드** (실시간 SSE) + tmux 대시보드 |
| **에이전트 커스텀** | 시스템 프롬프트 수정 | 에이전트 .md 편집, **AI 생성**, 색상, 글로벌/로컬 관리 |
| **자기 보완** | 불가능 | QA 에이전트가 시스템 자체를 검증하고 **엔지니어가 수정** |

요약하면:

> **Claude Code** = 뛰어난 개발자 1명
> **make-company** = 그 개발자가 이끄는 **8명짜리 전문 팀**

```
기본 Claude Code:
  사용자 → Claude → 결과

make-company:
  사용자 → CEO(Claude) → PM → Designer ─┐
                         → Backend  ─────┤→ Frontend → QA → 결과
```

### v1 → v2 변경점

| | v1 (tmux 기반) | v2 (Agent tool 기반) |
|---|---|---|
| 에이전트 실행 | tmux 윈도우마다 독립 claude CLI | Claude Code 네이티브 Agent tool |
| 통신 | 파일 기반 inbox/outbox + router.sh | Agent tool 직접 호출 + 결과 반환 |
| 비용 | 에이전트 수 x 상시 실행 | 필요할 때만 spawn |
| 안정성 | tmux send-keys, pane ID 이슈 | 네이티브 API, 안정적 |
| 모니터링 | tmux + Next.js 대시보드 | tmux 대시보드 + **SSE 웹 대시보드** |
| 워크플로우 | JSON DAG | **YAML 파이프라인** + CEO 자율 모드 |

---

## Prerequisites (전제 조건)

### 필수

| 도구 | 최소 버전 | 설치 방법 | 확인 명령 |
|---|---|---|---|
| **macOS** 또는 **Linux** | macOS 12+ / Ubuntu 20+ | — | `uname -s` |
| **Bash** | 3.x+ | OS 내장 | `bash --version` |
| **Python 3** | 3.8+ | OS 내장 또는 `brew install python3` | `python3 --version` |
| **tmux** | 3.0+ | `brew install tmux` (macOS) / `sudo apt install tmux` (Linux) | `tmux -V` |
| **Claude Code CLI** | 2.1+ | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| **Node.js** | 18+ | Claude Code CLI 설치에 필요 | `node --version` |
| **npm** | 8+ | Node.js와 함께 설치됨 | `npm --version` |
| **Anthropic API 키** 또는 **Claude Pro/Max** | — | Claude Code 로그인 필요 | `claude` 실행 후 로그인 |

### 선택

| 도구 | 용도 | 설치 방법 |
|---|---|---|
| **Gemini CLI** | Gemini 에이전트 (외부 자문) | `npm install -g @anthropic-ai/gemini-cli` |
| **Git** | 프로젝트 관리 | OS 내장 또는 `brew install git` |

### 전제 조건 한 번에 설치 (macOS)

```bash
# Homebrew가 없으면 먼저 설치
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 필수 도구 설치
brew install python3 tmux node

# Claude Code CLI 설치
npm install -g @anthropic-ai/claude-code

# 설치 확인
python3 --version   # 3.8+
tmux -V             # tmux 3.0+
node --version      # v18+
claude --version    # 2.1+
```

### 전제 조건 한 번에 설치 (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install -y python3 tmux curl git

# Node.js 18+ (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Claude Code 로그인
claude
```

---

## Quick Start

### 1. 클론 + 설치 (한 번만)

```bash
# 클론
git clone https://github.com/E0min/make-company.git ~/make-company

# 에이전트 + 워크플로우 + 스킬 설치
mkdir -p ~/.claude/agents ~/.claude/workflows ~/.claude/skills/company
cp ~/make-company/template/agents-v2/*.md ~/.claude/agents/
cp ~/make-company/template/workflows/*.yml ~/.claude/workflows/
cp ~/make-company/template/skill/skill.md ~/.claude/skills/company/

# zsh에 런처 등록
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

### 2. 회사 시작

```bash
cd ~/your-project
claude -company
```

처음 실행하면 에이전트 선택 화면이 나타납니다:

```
🏢 Virtual Company v2
프로젝트: my-project

사용 가능한 에이전트:
  1. CEO / Orchestrator (필수)
  2. Product Manager
  3. UI/UX Designer
  4. Frontend Engineer
  5. Backend Engineer
  6. Frontend QA
  7. Backend QA
  8. Marketing Strategist

활성화할 에이전트 번호를 선택하세요 (예: 1,2,4,5 또는 all):
```

선택하면 tmux 세션이 열립니다:

```
┌─────────────────────────────────────────────────┐
│ 0: claude              ← 메인 (CEO 모드)         │
│ 1: Monitor             ← activity.log 실시간     │
│ 2: PM                  ← claude --agent pm       │
│ 3: Designer            ← claude --agent designer │
│ 4: Frontend            ← claude --agent frontend │
│ 5: Backend             ← claude --agent backend  │
│ 6: FE-QA               ← claude --agent fe-qa   │
│ 7: BE-QA               ← claude --agent be-qa   │
│ 8: Marketing           ← claude --agent marketing│
└─────────────────────────────────────────────────┘
```

### 3. 사용법

**방법 A: CEO 모드 (윈도우 0에서)**
```
/company run 할일 앱 만들어줘
```
CEO가 자동으로 PM → Designer → FE → QA 순서로 팀을 분배합니다.

**방법 B: 에이전트한테 직접 말 걸기**
```
Ctrl+B → 4    (Frontend 윈도우로 이동)
> 이 컴포넌트 반응형으로 바꿔줘

Ctrl+B → 2    (PM 윈도우로 이동)
> PRD에 비용 분석 섹션 추가해줘

Ctrl+B → 0    (메인으로 돌아감)
```

**방법 C: YAML 워크플로우 실행**
```
/company workflow new-feature "검색 기능 추가"
```

### 조작법

| 키 | 동작 |
|---|---|
| `Ctrl+B → 0~8` | 윈도우 전환 |
| `Ctrl+B → d` | detach (세션 유지, 터미널 복귀) |
| `claude -company` | 다시 attach (기존 세션 재연결) |
| `Ctrl+B → &` | 현재 윈도우 종료 |

---

## Existing Project Migration (기존 프로젝트에 적용하기)

이미 `.claude/agents/`에 커스텀 에이전트가 있는 프로젝트에도 바로 사용할 수 있습니다.

### 자동 감지

`/company setup`을 실행하면 기존 에이전트를 자동으로 감지합니다:

```
기존 프로젝트 에이전트 감지됨:
  ✅ data-engineer.md      — v2 호환 (플레이스홀더 있음)
  ⚠️  my-custom-agent.md   — 마이그레이션 필요 (플레이스홀더 없음)
  ✅ devops.md             — v2 호환

기존 에이전트를 v2 형식으로 업그레이드하시겠습니까? (y/n)
```

### v2 호환이란?

에이전트 `.md` 파일에 다음 두 플레이스홀더가 있으면 v2 호환입니다:

```markdown
## 프로젝트 컨텍스트
{{project_context}}

## 누적 기억
{{agent_memory}}
```

- `{{project_context}}` → 실행 시 config.json의 tech_stack으로 자동 치환
- `{{agent_memory}}` → 실행 시 에이전트 메모리 파일 내용으로 자동 치환

### 마이그레이션 (자동)

`y`를 선택하면 기존 에이전트 파일에 **플레이스홀더만 추가**합니다. 기존 내용은 절대 삭제하지 않습니다.

### 마이그레이션 (수동)

직접 하려면 에이전트 `.md` 파일의 Role 설명 바로 뒤에 다음을 추가하면 됩니다:

```markdown
## 프로젝트 컨텍스트
{{project_context}}

## 누적 기억
{{agent_memory}}
```

### 기존 에이전트 + 글로벌 에이전트 혼합

setup 시 기존 에이전트는 그대로 유지하고, 글로벌 에이전트(CEO, PM, QA 등)를 **추가로** 선택할 수 있습니다. 이미 프로젝트에 있는 동명 에이전트는 덮어쓰지 않습니다.

```
글로벌 에이전트:
  1. ceo — 오케스트레이터
  2. product-manager (이미 설치됨)
  3. frontend-engineer — 프론트엔드
  ...

추가할 번호를 선택하세요 (1,3,5 / all / skip):
```

결과적으로 프로젝트에는 **기존 커스텀 에이전트 + 선택한 글로벌 에이전트**가 함께 동작합니다.

---

## Two Modes (두 가지 모드)

### 멀티에이전트 모드 — `/company run <태스크>`

메인 Claude가 **CEO 역할**을 수행하며 팀원을 자율적으로 호출합니다.

```
/company run "음악 추천 SaaS를 기획부터 구현까지"
```

흐름:
```
메인 Claude (CEO 모드)
  ├→ PM에게 기획 요청 (Agent tool)
  │   └→ PRD 반환
  ├→ Designer + Backend 병렬 호출
  │   ├→ 디자인 스펙 반환
  │   └→ API 설계 반환
  ├→ Frontend에게 구현 요청
  │   └→ 코드 반환
  └→ QA에게 검증 요청
      └→ 이슈 리포트 반환
```

CEO가 상황에 따라 **동적으로** 판단합니다:
- 신규 기능 → PM 먼저
- UI 변경 → Designer 직접
- 버그 → QA 먼저
- 병렬 가능한 작업은 동시 호출

### 서브에이전트 모드 — `/company workflow <name> [input]`

YAML 파이프라인을 **정해진 순서대로** 실행합니다.

```
/company workflow new-feature "검색 기능 추가"
```

기본 워크플로우 4종:

| 이름 | 흐름 |
|---|---|
| `new-feature` | CEO → PM → (Designer ∥ Backend) → Frontend → (FE-QA ∥ BE-QA) |
| `bug-fix` | FE-QA 진단 → FE 수정 → FE-QA 검증 |
| `design-only` | PM → Designer → Frontend |
| `marketing-launch` | PM → (Marketing ∥ Designer) → CEO 검토 |

커스텀 워크플로우는 `.claude/workflows/`에 YAML로 작성:

```yaml
name: 내 워크플로우
description: PM → Designer → Frontend
steps:
  - id: spec
    agent: product-manager
    prompt: "{{input}} 에 대한 요구사항 정리"
    output: spec
  - id: design
    agent: ui-ux-designer
    prompt: "{{steps.spec.output}} 기반 디자인"
    depends_on: [spec]
    output: design
  - id: code
    agent: frontend-engineer
    prompt: "{{steps.design.output}} 구현"
    depends_on: [design]
```

---

## Agents (에이전트 8종)

| ID | 역할 | 하는 일 |
|---|---|---|
| `ceo` | CEO / Orchestrator | 태스크 분석, 팀원 배정, 병렬/순차 결정, 최종 정리 |
| `product-manager` | Product Manager | Discovery, PRD, Features, IA, User Flow |
| `ui-ux-designer` | UI/UX Designer | 와이어프레임, 디자인 시스템, 컴포넌트 스펙 |
| `frontend-engineer` | Frontend Engineer | 디자인 스펙 → 코드 구현 |
| `backend-engineer` | Backend Engineer | API/DB 설계 및 구현 |
| `fe-qa` | Frontend QA | UI/UX/접근성/반응형 검증 |
| `be-qa` | Backend QA | API 계약/통합/성능/보안 검증 |
| `marketing-strategist` | Marketing Strategist | 포지셔닝/메시징/채널 전략/카피 |

에이전트는 `~/.claude/agents/`(글로벌) 또는 `.claude/agents/`(프로젝트)에 `.md` 파일로 정의됩니다. 각 에이전트는 프로젝트 컨텍스트와 누적 메모리를 런타임에 주입받습니다.

---

## Dashboard (대시보드)

### 웹 대시보드 (SSE 실시간)

```bash
python3 .claude/company/dashboard/server.py 7778
# → http://localhost:7778
```

| 탭 | 기능 |
|---|---|
| **Overview** | KPI (총원/작업중/완료/대기), 에이전트 상태 그리드 |
| **Run** | 멀티에이전트 실행 + 워크플로우 실행 (브라우저에서 직접) |
| **Activity** | SSE 실시간 활동 로그 |
| **Agents** | 에이전트 목록, 편집, 생성 (AI 생성), 삭제, 글로벌 가져오기, 색상 선택 |

- 디자인: Linear-leaning Cyber Refined (다크, Geist 폰트, Lucide 아이콘)
- 보안: 인증 토큰 (POST 요청), Path Traversal 방지, Agent ID 검증

### tmux 대시보드 (터미널)

```bash
bash .claude/company/dashboard.sh
# 다른 터미널에서:
tmux attach -t vc-dashboard
```

- 윈도우 0: Monitor (`tail -f activity.log`)
- 윈도우 1~N: 에이전트별 출력 (`tail -f agent-output/{id}.log`)

---

## Agent Memory (에이전트 메모리)

각 에이전트는 작업 후 배운 점을 `.claude/company/agent-memory/{id}.md`에 누적합니다.

```bash
/company memory                    # 전체 메모리 미리보기
/company memory frontend-engineer  # 특정 에이전트 메모리 조회
```

메모리는 다음 실행 시 에이전트 프롬프트에 자동 주입되어, 프로젝트에 대한 이해도가 점차 높아집니다.

---

## Commands Summary

| 명령 | 설명 |
|---|---|
| `/company setup` | 에이전트 선택 + 프로젝트 설정 |
| `/company run <태스크>` | 멀티에이전트 (CEO 자율 모드) |
| `/company workflow <name> [input]` | 서브에이전트 (YAML 파이프라인) |
| `/company dashboard` | tmux 대시보드 시작 |
| `/company memory [agent-id]` | 에이전트 메모리 조회/수정 |

---

## Project Structure (설치 후)

```
your-project/
├── .claude/
│   ├── agents/                    # 프로젝트 에이전트 (.md)
│   │   ├── ceo.md
│   │   ├── product-manager.md
│   │   ├── frontend-engineer.md
│   │   └── ...
│   ├── workflows/                 # YAML 워크플로우
│   │   ├── new-feature.yml
│   │   ├── bug-fix.yml
│   │   └── ...
│   ├── company/
│   │   ├── config.json            # 프로젝트 설정
│   │   ├── activity.log           # 활동 로그 (tail -f 가능)
│   │   ├── agent-memory/          # 에이전트별 누적 메모리
│   │   ├── agent-output/          # 에이전트별 출력 로그
│   │   ├── dashboard/             # 웹 대시보드 (server.py + HTML/CSS/JS)
│   │   └── dashboard.sh           # tmux 대시보드 스크립트
│   └── skills/
│       └── company/
│           └── skill.md           # /company 스킬 정의
```

---

## Repository Layout

```
make-company/
├── README.md
├── LICENSE
├── install.sh                     # 프로젝트에 설치하는 스크립트
├── vc-launch.sh                   # claude -company 런처
├── template/
│   ├── agents-v2/                 # v2 에이전트 정의 8종
│   ├── workflows/                 # YAML 워크플로우 4종
│   ├── skill/                     # /company 스킬 정의
│   ├── dashboard/                 # 웹 대시보드 (Python + vanilla JS)
│   │   ├── server.py              # SSE 서버 (stdlib only)
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   ├── dashboard.sh               # tmux 대시보드
│   ├── config-v2-example.json     # 설정 예시
│   ├── agents/                    # v1 에이전트 스크립트 (legacy)
│   ├── dashboard-next/            # v1 Next.js 대시보드 (legacy)
│   └── ...                        # v1 파일들 (run.sh, router.sh 등)
├── CLAUDE.md
└── DESIGN.md
```

---

## Troubleshooting

### `claude` 명령을 찾을 수 없음
```bash
npm install -g @anthropic-ai/claude-code
# 또는 npx로 실행:
npx @anthropic-ai/claude-code
```

### `tmux` 명령을 찾을 수 없음
```bash
# macOS
brew install tmux
# Ubuntu/Debian
sudo apt install tmux
```

### `python3` 명령을 찾을 수 없음
```bash
# macOS
brew install python3
# Ubuntu/Debian
sudo apt install python3
```

### 대시보드 포트 충돌 (Address already in use)
```bash
# 기존 프로세스 확인 및 종료
lsof -ti:7778 | xargs kill
# 다른 포트로 시작
python3 .claude/company/dashboard/server.py 8080
```

### `/company` 스킬이 인식되지 않음
```bash
# 스킬 파일이 올바른 위치에 있는지 확인
ls ~/.claude/skills/company/skill.md
# 없으면 복사
mkdir -p ~/.claude/skills/company
cp ~/make-company/template/skill/skill.md ~/.claude/skills/company/
```

### 에이전트가 응답하지 않음
- Claude Code CLI 로그인 상태 확인: `claude` 실행
- Anthropic API 키 또는 Claude Pro/Max 구독 확인
- 네트워크 연결 확인

---

## Examples — Built with make-company

### Example 1: "할일 앱 만들어줘" (15분)

```
/company run 할일 앱 만들어줘
```

```
[00:00] CEO    → 태스크 분석, PM에게 기획 요청
[01:30] PM     → PRD 작성 (CRUD + 우선순위 + 필터)
[03:00] Designer + Backend 병렬 시작
[05:00] Backend → API 설계 완료 (REST 5개 엔드포인트)
[06:30] Designer → 디자인 스펙 완료 (3개 화면)
[07:00] Frontend → 구현 시작 (디자인 + API 기반)
[12:00] Frontend → 컴포넌트 8개 구현 완료
[13:00] FE-QA  → 검증 (이슈 2건 발견)
[14:00] Frontend → 이슈 수정
[15:00] CEO    → 최종 정리, 완료
```

산출물: PRD, 디자인 스펙, API 설계, 프론트엔드 코드, QA 리포트

### Example 2: 시스템 자기 보완 (20분)

```
/company run 이 시스템의 코드를 QA 테스트하고 버그를 수정해줘
```

```
라운드 1: FE-QA + BE-QA 병렬 → 34건 발견
          Frontend + Backend 병렬 → 14건 수정 (Critical/High)

라운드 2: 재검증 → 13/14 PASS + 신규 11건 발견
          수정 → 6건 추가 수정

라운드 3: 최종 검증 → 6/6 PASS + 9건 추가 수정

총 수정: 29건 (보안 7, 기능 9, 성능 5, 안정성 5, UX 3)
```

### Example 3: 에이전트 직접 대화

```bash
Ctrl+B → 4   # Frontend 윈도우로 이동

> 이 컴포넌트에 다크모드 지원 추가해줘
# Frontend 에이전트가 프로젝트 컨텍스트를 알고 있는 상태에서 바로 작업

Ctrl+B → 2   # PM 윈도우로 이동

> PRD에 경쟁사 분석 섹션 추가해줘
# PM이 독립적으로 작업
```

---

## Contributing

PR 환영합니다.

- **새 에이전트**: `template/agents-v2/`에 `.md` 파일 추가
- **새 워크플로우**: `template/workflows/`에 `.yml` 파일 추가
- **대시보드 UI**: [DESIGN.md](DESIGN.md) 참고 — Linear 스타일, 다크 우선, 단일 보라 액센트

---

## License

MIT — [LICENSE](LICENSE) 참고.

---

<div align="center">

**v1: Made with tmux send-keys**
**v2: Made with Claude Code Agent tool**

</div>
