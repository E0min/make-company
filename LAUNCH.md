# Launch Plan — make-company

## HN Post

**Title** (78 chars):
```
Show HN: make-company – Turn Claude Code into an 8-agent AI team that ships for you
```

**Body** (~280 words):

**What it is:**
make-company turns a single Claude Code CLI into an 8-person AI team — CEO, PM, Designer, Frontend, Backend, FE-QA, BE-QA, and Marketing. Each agent has a specialized system prompt, persistent memory, and runs as a Claude Code `--agent` session inside tmux. You say "build a todo app" and the CEO delegates: PM writes a PRD, Designer and Backend work in parallel, Frontend implements, QA validates.

**Why I built it:**
Claude Code is great at executing one task at a time. But real software projects need coordination: specs before code, design alongside API work, QA after implementation. I was manually copy-pasting context between conversations. make-company automates that entire pipeline — one command, full team.

**How it works:**

```bash
git clone https://github.com/E0min/make-company.git ~/make-company
bash ~/make-company/install.sh
cd your-project && claude -company
> /company run "Build a music recommendation SaaS"

# CEO analyzes → PM writes PRD → Designer + Backend in parallel
# → Frontend builds → QA validates → done
```

Agents communicate via Claude Code's native Agent tool. YAML workflows define pipelines (new-feature, bug-fix, design-only, marketing-launch). A web dashboard (Python SSE, zero deps) shows real-time agent status.

**How is this different from vanilla Claude Code?**
- Vanilla: one generalist. make-company: 8 specialists with role-specific prompts.
- Vanilla: you direct every step. make-company: CEO orchestrates autonomously.
- Vanilla: sequential. make-company: Designer + Backend run in parallel.
- Vanilla: context resets. make-company: per-agent memory persists across sessions.
- Vanilla: no QA. make-company: FE-QA and BE-QA auto-validate before delivery.

**Stack:** Bash + Python 3 (stdlib only) + Claude Code CLI + tmux. Zero npm runtime deps.

GitHub: https://github.com/E0min/make-company

---

## X/Twitter Thread (한국어)

**트윗 1:**
Claude Code로 "앱 만들어줘" 하면 바로 코딩부터 시작합니다.
기획은? 디자인은? QA는?
한 명의 천재 개발자한테 모든 걸 맡긴 거랑 같음.
결과: 돌아가긴 하는데, 팀이 만든 것과는 다릅니다.
#ClaudeCode #AI개발

**트윗 2:**
그래서 만들었습니다 — make-company
Claude Code 위에 8명의 AI 팀을 얹는 오픈소스.
CEO가 분석하고, PM이 기획하고, 디자이너와 백엔드가 동시에 작업하고, 프론트엔드가 구현하고, QA가 검증합니다.
"할일 앱 만들어줘" 한 마디로 15분 만에 PRD + 코드 + QA 리포트.
#오픈소스 #멀티에이전트

**트윗 3:**
사용법:
git clone https://github.com/E0min/make-company.git
cd your-project
claude -company
> /company run "음악 추천 SaaS 만들어줘"
CEO → PM(PRD) → Designer + Backend(병렬) → Frontend → QA
tmux 윈도우로 각 에이전트한테 직접 말 걸기도 가능.
#ClaudeCode #AIAgent

**트윗 4:**
기본 Claude Code vs make-company:
- 범용 1명 vs 전문 8명
- 매번 직접 지시 vs CEO가 자율 분배
- 순차 실행 vs 디자인+백엔드 병렬
- 대화 끝나면 리셋 vs 에이전트별 메모리 누적
- QA 없음 vs 자동 검증 후 이슈 리포트
#DeveloperTools #AI

**트윗 5:**
MIT 라이선스. 지금 바로 쓸 수 있습니다.
GitHub: https://github.com/E0min/make-company
에이전트 .md 파일 수정으로 역할 커스텀 가능.
YAML로 워크플로우 정의, 웹 대시보드로 실시간 모니터링.
스타 찍어주시면 다음 기능 개발에 큰 힘이 됩니다.
#OpenSource #make_company #ClaudeCode

---

## Timing

- HN: 미국 동부 화~목 오전 8-9시 (한국 밤 9-10시)
- X: HN 포스팅 30분 후
