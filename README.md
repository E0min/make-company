<div align="center">

# 🏢 make-company

**Spin up an entire AI company in your terminal — multi-agent orchestration on tmux + Claude Code + Gemini, with a Next.js dashboard.**

**터미널 안에서 AI 회사 한 채를 통째로 띄우세요 — tmux 위에서 Claude Code와 Gemini가 협업하고, Next.js 대시보드로 한눈에 관리합니다.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bash](https://img.shields.io/badge/Bash-3.x%2B-1f425f?logo=gnu-bash)](https://www.gnu.org/software/bash/)
[![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-radix-000)](https://ui.shadcn.com/)

</div>

---

## 🇺🇸 English

### What is this?

`make-company` turns a single project folder into a small AI company. Each role — CEO, PM, Designer, Frontend, Backend, QA, Marketing, DevOps, Growth — runs as **its own interactive Claude Code (or Gemini) session inside a tmux window**. The agents talk to each other through a tiny **file-based message bus** (`inbox/` ⇄ `outbox/`), coordinated by a router daemon. A **Next.js + shadcn dashboard** sits on top so you can watch the whole thing breathe in real time.

You install once, pick a company preset (Web Design Agency, IT Startup, Data Team…), and from then on every project gets its own dedicated team that you can talk to with `@회사: build me a Stripe checkout page`.

### Why it exists

Most "agent frameworks" are libraries you wire up in code. This one is the opposite: **the agents are real CLI sessions you can attach to, watch, and interrupt**, the bus is plain markdown files you can `cat`, and the dashboard is a static export served by 250 lines of stdlib Python. Zero hidden state. Zero cloud lock-in. You can rip the whole thing out with `rm -rf .claude/company`.

### Highlights

- 🪟 **One tmux session, many agents** — every role is its own window, fully attachable
- 📨 **File-based message bus** — `outbox/{agent}.md` → router parses `@mentions` → `inbox/{recipient}.md`
- 🎨 **Next.js 16 + shadcn dashboard** — Overview / Workflows / Agents / Knowledge / Channel, with ⌘K command palette and keyboard shortcuts
- 🏭 **Industry presets** — Default, Web Design Agency, IT Startup, Content Marketing, Data Team, Solo Developer, or build your own
- 🧠 **Skill recommender** — agents auto-receive only the top-3 most relevant skills per task (~98% token savings vs loading everything)
- 🔁 **Workflow templates** — DAG-based, save & reuse common pipelines
- 🛟 **Self-healing** — heartbeat watchdog, auto-compact, restart, pause/resume
- 💸 **Token-aware** — per-agent + global token budget with warn/danger thresholds
- 🌑 **Dark, Linear-leaning, single accent** — see [DESIGN.md](DESIGN.md)

### Requirements

- macOS or Linux
- `tmux`
- `python3` (stdlib only — no pip dependencies)
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code) (Anthropic Claude Code)
- [`gemini` CLI](https://github.com/google-gemini/gemini-cli) (optional, for Gemini agents)
- Node 20+ **only if you want to rebuild the dashboard** (the prebuilt static export is shipped in the repo)

### Quick start

```bash
# 1) Clone once, anywhere
git clone https://github.com/E0min/make-company.git ~/make-company

# 2) Optional: drop the tmux launcher into your shell
echo 'export VC_TEMPLATE="$HOME/make-company"' >> ~/.zshrc
echo 'claude() {
  if [[ "$1" == "-company" || "$1" == "--company" ]]; then
    shift
    bash "$VC_TEMPLATE/vc-launch.sh" "$@"
  else
    command claude "$@"
  fi
}' >> ~/.zshrc
source ~/.zshrc

# 3) Go to any project and launch
cd ~/projects/my-saas
claude -company
```

That's it. On first run you'll see an interactive preset menu, then a tmux session opens with one window per agent plus a `claude` window for you. Your browser auto-opens the dashboard at `http://localhost:7777`.

### Talking to the company

From inside the `claude` window:

```
@회사: Stripe 결제 통합한 구독 페이지 만들어줘
```

A `UserPromptSubmit` hook detects `@회사:` and forwards the task to the Orchestrator (CEO), who delegates to PM/Designer/Engineers via the bus. You watch it happen in the dashboard.

You can also kick off tasks directly:

```bash
bash .claude/company/kickoff.sh 'Stripe checkout 페이지 만들기'
```

### Dashboard

Open `http://localhost:7777` after `run.sh`.

| Tab | What you see |
|---|---|
| **Overview** | 4 KPI cards (Active / Working / Tokens / Workflows), agent grid colored by state, recent tasks, channel preview |
| **Workflows** | Active DAGs, template gallery, visual builder dialog |
| **Agents** | Add from category-grouped library with skill chips, custom mode, skills assignment, save current as preset |
| **Knowledge** | Markdown-rendered shared notes |
| **Channel** | Full message log with parsed `[from→to]` sender colors |

**Keyboard:**

| Keys | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `g o` / `g w` / `g a` / `g k` / `g c` | Jump to Overview / Workflows / Agents / Knowledge / Channel |
| `n` / `N` | New Workflow / Add Agent |
| `?` | Show shortcuts |
| `Esc` | Close modal |

### Architecture (the 30-second version)

```
kickoff.sh "task"
        │
        ▼
inbox/orch.md  ──▶  Orchestrator agent processes
                              │
                              ▼
                  outbox/orch.md  ──▶  router.sh polls every 1s
                                          │
                          parses @mentions, fans out
                                          ▼
                  inbox/{pm, designer, frontend, ...}.md
                                          │
                                          ▼
                            recipients process → outbox → ...
                                          │
                                          ▼
                            channel/general.md  (single source of truth)
```

- **`run.sh`** — boots tmux session, one window per agent
- **`router.sh`** — message bus daemon (1s poll)
- **`run-agent.sh`** — wraps `claude` CLI, polls inbox every 2s, sends via tmux send-keys, captures responses from scrollback, auto-compacts at threshold
- **`run-gemini.sh`** — same idea for `gemini --yolo`
- **`monitor.sh`** — terminal dashboard (3s refresh)
- **`dashboard/server.py`** — 250-LOC stdlib HTTP server, serves the Next.js static export + JSON API
- **`dashboard-next/`** — Next.js 16 + TS + Tailwind v4 + shadcn/ui (Radix), exported to static `out/`

See [CLAUDE.md](CLAUDE.md) and [DESIGN.md](DESIGN.md) for the full picture.

### Company presets

Pick one during install, or build your own.

| # | Preset | Team | Best for |
|---|---|---|---|
| 1 | **Default** | 9-person general | First-time users |
| 2 | 🎨 **Web Design Agency** | Director + UX + UI + Frontend + FE-QA + Marketing | Client websites |
| 3 | 🚀 **IT Startup** | CEO + PM + Fullstack + DevOps + Growth + Designer | SaaS / MVPs |
| 4 | 📝 **Content Marketing** | Strategist + Writer + SEO + Social + Brand | Content teams |
| 5 | 📊 **Data Team** | CTO + Data Eng + Analyst + Scientist + ML + PM | Analytics / ML |
| 6 | 👤 **Solo Developer** | CEO + Fullstack + Designer + Gemini | Side projects |
| 7 | ✏️ **Custom** | Pick from the agent library yourself | Power users |

You can save any running configuration back as a preset from the dashboard's Agents tab → "Save as Preset".

### Common commands

```bash
bash install.sh [target_dir]                         # install into a project
bash .claude/company/run.sh                          # start the tmux session
bash .claude/company/kickoff.sh '태스크 설명'         # send a task to the Orchestrator
bash .claude/company/stop.sh                         # stop the session
tmux attach -t <session_name>                        # attach manually
```

### Repository layout

```
make-company/
├── install.sh                    # Install template into a target dir
├── vc-launch.sh                  # `claude -company` launcher
├── template/                     # The thing that gets copied
│   ├── run.sh, router.sh, kickoff.sh, ...
│   ├── agents-library/           # 25+ reusable agent definitions
│   ├── presets/                  # Industry preset JSONs
│   ├── dashboard/                # Legacy vanilla dashboard (fallback)
│   ├── dashboard-next/           # Next.js + shadcn dashboard (source + prebuilt out/)
│   └── workflows/                # Example workflow templates
├── examples/                     # Usage storyboards
├── DESIGN.md                     # Visual design system
└── CLAUDE.md                     # Repo guide for Claude Code
```

### Contributing

PRs welcome. Please read [DESIGN.md](DESIGN.md) before any UI changes — the dashboard follows a strict "Linear-leaning, dark-first, single purple accent" system.

For new agents:
1. Drop a `.md` in `template/agents-library/{category}/` with frontmatter (`name`, `category`, `description`, `default_label`, `default_skills`)
2. Test with `bash install.sh /tmp/test-co` → pick Custom → verify it appears in the library

For new presets:
1. Add `template/presets/{id}.json`
2. Add the menu line in `install.sh`

### License

MIT — see [LICENSE](LICENSE).

---

## 🇰🇷 한국어

### 무엇인가요?

`make-company`는 프로젝트 폴더 하나를 작은 AI 회사로 바꿔줍니다. CEO, PM, 디자이너, 프론트엔드, 백엔드, QA, 마케팅, DevOps, Growth 등 각 역할이 **tmux 윈도우 안에서 독립된 Claude Code (또는 Gemini) 세션**으로 실행되고, 작은 **파일 기반 메시지 버스**(`inbox/` ⇄ `outbox/`)로 서로 대화합니다. 위에는 **Next.js + shadcn 대시보드**가 얹혀 있어 회사가 숨 쉬는 모습을 실시간으로 봅니다.

설치는 한 번. 회사 종류만 고르면 (웹 디자인 에이전시, IT 스타트업, 데이터 팀…) 그 다음부턴 어떤 프로젝트를 열든 전용 팀이 따라붙습니다. 그 팀과 대화하는 방법: `@회사: Stripe 결제 페이지 만들어줘`.

### 왜 만들었나요?

대부분의 "에이전트 프레임워크"는 코드로 wiring하는 라이브러리입니다. 이건 정반대입니다. **에이전트가 진짜 CLI 세션이라 attach해서 직접 보고 가로챌 수 있고**, 메시지 버스는 그냥 `cat`으로 읽히는 마크다운 파일이고, 대시보드는 250줄짜리 stdlib Python 서버가 정적 파일로 서빙합니다. 숨겨진 상태 0개. 클라우드 종속 0개. `rm -rf .claude/company` 한 줄로 통째로 뽑아낼 수 있습니다.

### 핵심 기능

- 🪟 **tmux 세션 1개에 에이전트 N개** — 각 역할이 윈도우 하나, 언제든 attach
- 📨 **파일 기반 메시지 버스** — `outbox/{agent}.md` → router가 `@멘션` 파싱 → `inbox/{recipient}.md`
- 🎨 **Next.js 16 + shadcn 대시보드** — Overview / Workflows / Agents / Knowledge / Channel, ⌘K 명령 팔레트, vim식 단축키
- 🏭 **산업별 프리셋** — Default, Web Design Agency, IT Startup, Content Marketing, Data Team, Solo Developer, Custom
- 🧠 **스킬 추천기** — 매 태스크마다 가장 관련 있는 top-3 스킬만 자동 주입 (전체 로딩 대비 ~98% 토큰 절감)
- 🔁 **워크플로 템플릿** — DAG 기반, 자주 쓰는 파이프라인 저장/재사용
- 🛟 **자가 회복** — heartbeat watchdog, 자동 compact, 재시작, 일시정지/재개
- 💸 **토큰 관리** — 에이전트별 + 전역 토큰 예산, warn/danger 임계값
- 🌑 **다크 우선, 보라 단일 액센트** — [DESIGN.md](DESIGN.md) 참고

### 요구사항

- macOS 또는 Linux
- `tmux`
- `python3` (stdlib만 — pip 의존성 0)
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code)
- [`gemini` CLI](https://github.com/google-gemini/gemini-cli) (선택, Gemini 에이전트용)
- Node 20+ **대시보드를 직접 빌드할 때만** (리포에 prebuilt 정적 산출물 포함)

### 빠른 시작

```bash
# 1) 한 번만 클론 (어디든)
git clone https://github.com/E0min/make-company.git ~/make-company

# 2) (선택) tmux 런처를 zsh에 등록
echo 'export VC_TEMPLATE="$HOME/make-company"' >> ~/.zshrc
echo 'claude() {
  if [[ "$1" == "-company" || "$1" == "--company" ]]; then
    shift
    bash "$VC_TEMPLATE/vc-launch.sh" "$@"
  else
    command claude "$@"
  fi
}' >> ~/.zshrc
source ~/.zshrc

# 3) 아무 프로젝트로 가서 한 줄
cd ~/projects/my-saas
claude -company
```

끝. 첫 실행 때 회사 종류 선택 메뉴가 뜨고, 그 다음 tmux 세션이 열립니다. 윈도우 0번은 `claude`, 나머지는 각 에이전트. 브라우저가 자동으로 `http://localhost:7777` 대시보드를 엽니다.

### 회사에 일 시키기

`claude` 윈도우에서:

```
@회사: Stripe 결제 통합한 구독 페이지 만들어줘
```

`UserPromptSubmit` 훅이 `@회사:`를 감지해 Orchestrator(CEO)에게 전달하고, CEO가 PM/디자이너/엔지니어에게 분배합니다. 진행 과정은 대시보드에서 실시간으로 보입니다.

직접 던지는 것도 가능:

```bash
bash .claude/company/kickoff.sh 'Stripe 결제 페이지 만들기'
```

### 대시보드

`run.sh` 후 `http://localhost:7777`.

| 탭 | 보이는 것 |
|---|---|
| **Overview** | 4개 KPI 카드 (Active / Working / Tokens / Workflows), 상태 색상별 에이전트 그리드, 최근 태스크, 채널 미리보기 |
| **Workflows** | 활성 DAG, 템플릿 갤러리, 시각적 빌더 다이얼로그 |
| **Agents** | 카테고리 그룹 + 스킬 칩 라이브러리에서 추가, 커스텀 모드, 스킬 할당, 현재 구성을 프리셋으로 저장 |
| **Knowledge** | 공유 노트 마크다운 렌더링 |
| **Channel** | `[from→to]` sender 색상 파싱된 전체 메시지 로그 |

**키보드:**

| 키 | 동작 |
|---|---|
| `⌘K` / `Ctrl+K` | 명령 팔레트 |
| `g o` / `g w` / `g a` / `g k` / `g c` | Overview / Workflows / Agents / Knowledge / Channel 점프 |
| `n` / `N` | 새 워크플로 / 에이전트 추가 |
| `?` | 단축키 도움말 |
| `Esc` | 모달 닫기 |

### 아키텍처 (30초 버전)

```
kickoff.sh "태스크"
        │
        ▼
inbox/orch.md  ──▶  Orchestrator가 처리
                              │
                              ▼
                  outbox/orch.md  ──▶  router.sh가 1초마다 폴링
                                          │
                              @멘션 파싱, 분배
                                          ▼
                  inbox/{pm, designer, frontend, ...}.md
                                          │
                                          ▼
                            수신자가 처리 → outbox → ...
                                          │
                                          ▼
                            channel/general.md  (단일 진실 공급원)
```

- **`run.sh`** — tmux 세션 부팅, 에이전트당 윈도우 1개
- **`router.sh`** — 메시지 버스 데몬 (1초 폴링)
- **`run-agent.sh`** — `claude` CLI를 감싸고, inbox 2초마다 폴링, tmux send-keys로 전송, 스크롤백에서 응답 캡처, 임계값에서 자동 compact
- **`run-gemini.sh`** — `gemini --yolo` 버전
- **`monitor.sh`** — 터미널 대시보드 (3초 갱신)
- **`dashboard/server.py`** — 250줄 stdlib HTTP 서버, Next.js 정적 산출물과 JSON API 동시 서빙
- **`dashboard-next/`** — Next.js 16 + TS + Tailwind v4 + shadcn/ui (Radix), 정적 `out/`으로 export

자세한 것은 [CLAUDE.md](CLAUDE.md) 와 [DESIGN.md](DESIGN.md).

### 회사 프리셋

설치 시 선택하거나, 직접 만드세요.

| # | 프리셋 | 팀 구성 | 추천 대상 |
|---|---|---|---|
| 1 | **Default** | 9인 일반 회사 | 처음 써보는 사용자 |
| 2 | 🎨 **Web Design Agency** | Director + UX + UI + Frontend + FE-QA + Marketing | 클라이언트 웹사이트 |
| 3 | 🚀 **IT Startup** | CEO + PM + Fullstack + DevOps + Growth + Designer | SaaS / MVP |
| 4 | 📝 **Content Marketing** | Strategist + Writer + SEO + Social + Brand | 콘텐츠 팀 |
| 5 | 📊 **Data Team** | CTO + Data Eng + Analyst + Scientist + ML + PM | 분석 / ML |
| 6 | 👤 **Solo Developer** | CEO + Fullstack + Designer + Gemini | 사이드 프로젝트 |
| 7 | ✏️ **Custom** | 라이브러리에서 직접 고르기 | 파워 유저 |

가동 중인 구성을 대시보드 → Agents 탭 → "Save as Preset"으로 프리셋화 가능.

### 자주 쓰는 명령

```bash
bash install.sh [target_dir]                         # 프로젝트에 설치
bash .claude/company/run.sh                          # tmux 세션 시작
bash .claude/company/kickoff.sh '태스크 설명'         # Orchestrator에게 태스크 전달
bash .claude/company/stop.sh                         # 세션 종료
tmux attach -t <session_name>                        # 수동 attach
```

### 디렉토리 구조

```
make-company/
├── install.sh                    # 타깃 디렉토리에 템플릿 설치
├── vc-launch.sh                  # `claude -company` 런처
├── template/                     # 복사되는 본체
│   ├── run.sh, router.sh, kickoff.sh, ...
│   ├── agents-library/           # 25+ 재사용 가능한 에이전트 정의
│   ├── presets/                  # 산업별 프리셋 JSON
│   ├── dashboard/                # Legacy vanilla 대시보드 (폴백)
│   ├── dashboard-next/           # Next.js + shadcn 대시보드 (소스 + prebuilt out/)
│   └── workflows/                # 워크플로 템플릿 예시
├── examples/                     # 사용 스토리보드
├── DESIGN.md                     # 시각 디자인 시스템
└── CLAUDE.md                     # Claude Code용 리포 가이드
```

### 기여 환영

PR 환영합니다. UI 변경 전엔 [DESIGN.md](DESIGN.md)를 꼭 읽어주세요. 대시보드는 "Linear 스타일, 다크 우선, 단일 보라 액센트" 시스템을 엄격하게 따릅니다.

새 에이전트 추가:
1. `template/agents-library/{category}/`에 frontmatter (`name`, `category`, `description`, `default_label`, `default_skills`)를 가진 `.md` 파일 추가
2. `bash install.sh /tmp/test-co` → Custom 선택 → 라이브러리에 나타나는지 확인

새 프리셋 추가:
1. `template/presets/{id}.json` 추가
2. `install.sh`에 메뉴 라인 추가

### 라이선스

MIT — [LICENSE](LICENSE) 참고.

---

<div align="center">

**Made with ☕ and a lot of `tmux send-keys`.**

</div>
