# 사용 예시: 새 Claude 프로젝트 → Virtual Company 스토리보드

새 프로젝트에서 Virtual Company를 처음 설치하고 사용하는 전체 흐름.
주인공: **민지**, 풀스택 개발자. 새 SaaS 사이드 프로젝트를 시작.

---

## 🎬 Scene 1 — 빈 폴더에서 시작 (T+0s)

```
~/projects/my-saas $ claude
```

민지가 빈 폴더에서 Claude Code를 연다.

> **민지**: `/make-company`

Claude가 `make-company` 스킬을 인식. 안내:
> *"`! bash ~/깃허브/virtual-company/install.sh .claude/company` 를 실행하세요."*

---

## 🎬 Scene 2 — 회사 종류 선택 (T+10s)

민지가 명령어 입력. 터미널에 메뉴:

```
  Virtual Company Installer

  회사 종류를 선택하세요:
    1) Default                  - 9인 일반 회사
    2) 🎨 Web Design Agency
    3) 🚀 IT Startup
    4) 📝 Content Marketing
    5) 📊 Data Team
    6) 👤 Solo Developer
    7) ✏  Custom

  선택 [1]: 3
```

SaaS 빌딩이라 **3 (IT Startup)** 선택.

```
  프리셋 적용 중: it-startup
  ✓ 에이전트 8명 구성
    - CEO        (orch)        claude  skills=4
    - CTO        (cto)         claude  skills=5
    - PM         (pm)          claude  skills=4
    - Fullstack  (fullstack)   claude  skills=6
    - DevOps     (devops)      claude  skills=4
    - Designer   (designer)    claude  skills=5
    - Growth     (growth)      claude  skills=3
    - Gemini     (gemini)      gemini  skills=0
  ✓ .claude/agents/ 에 8개 .md 복사
  ✓ config.json 저장
  설치 완료: .claude/company
```

`setup.sh`가 회사 이름·세션명 묻고 저장.

---

## 🎬 Scene 3 — 첫 시동 (T+30s)

> **민지**: `bash .claude/company/run.sh`

tmux 세션이 뜬다. 8개 윈도우 + Monitor + Router. 동시에 `localhost:7777`이 자동으로 브라우저에 열린다.

**대시보드 첫 인상:**
- 헤더: `VC My SaaS Company` · `Tokens 0 / 200K ▓░░░░` · `⌘K Search`
- 4개 KPI 카드: Active 8 · Working 0 · Tokens 0 · Workflows 0
- Legend: ● working ● idle ● compacting ● paused ● error
- 8개 에이전트 타일이 전부 `idle`. 깔끔한 다크 인터페이스.
- 하단 status bar: `● Live · updated 1s ago · 8 agents · 0 workflows · ⌘K palette · ? shortcuts`

민지: *"아 이거 진짜 회사처럼 생겼네."*

---

## 🎬 Scene 4 — 첫 태스크 던지기 (T+1m)

민지가 Claude 대화창으로 돌아가 입력:

> **민지**: `@회사: Stripe 결제 통합한 구독 결제 페이지 만들어줘`

훅이 `@회사:` 패턴을 감지 → `kickoff.sh "Stripe..."` 자동 실행 → `inbox/orch.md`에 기록.

대시보드 watch:
- CEO 타일이 `idle` → `working`. 좌측 보라 bar pulse 시작.
- Status bar: "1 working"
- KPI Working: 0 → 1

---

## 🎬 Scene 5 — 회사가 일하는 모습 (T+2m ~ T+8m)

CEO가 응답을 outbox에 쓴다:

> `@pm 결제 페이지 PRD 작성해줘. @designer 와이어프레임 준비. @fullstack Stripe SDK 조사 시작.`

Router가 파싱해서 PM/Designer/Fullstack inbox로 전달. 동시에 채널에 로그.

대시보드:
- CEO → idle, PM/Designer/Fullstack 3개가 동시에 `working`
- KPI Working: 1 → 3
- 우상단 토스트: `CEO 완료 · 작업 종료됨` (4초 후 fade out)
- Channel 탭: 메시지가 색상 구분되어 들어옴
  ```
  orch  →  pm        결제 페이지 PRD 작성해줘
  orch  →  designer  와이어프레임 준비
  orch  →  fullstack Stripe SDK 조사 시작
  ```

민지는 Overview의 Recent Tasks에서 `working stripe-integration` 보고 흐름 파악.

---

## 🎬 Scene 6 — 워크플로 발견 (T+10m)

민지가 `⌘K` 누른다. Command Palette 열림:

```
┌──────────────────────────────────────┐
│ 🔍 Type a command or search...       │
├──────────────────────────────────────┤
│ NAVIGATE                             │
│ ↗  Go to Overview              g o   │
│ ↗  Go to Workflows             g w   │
│ ↗  Go to Agents                g a   │
│ ACTIONS                              │
│ +  New Workflow                n     │
│ +  Add Agent                   N     │
│ AGENTS                               │
│ C  CEO                         orch  │
│ C  PM                          pm    │
└──────────────────────────────────────┘
```

`workflow` 타이핑 → 필터링 → Enter → New Workflow 모달.

Stripe 통합을 표준 워크플로로 만들어 노드 4개 정의:
1. `pm` → 요구사항
2. `designer` → 시안 (`{{n1.output_artifact}}`)
3. `fullstack` → 구현
4. `gemini` → 외부 검토

저장. 갤러리에 카드 등장. 토스트: `워크플로 저장됨 · stripe-flow`

---

## 🎬 Scene 7 — 부드러운 사고 (T+25m)

Fullstack이 갑자기 `error` 상태로 빠짐 (Stripe API 키 없음).

대시보드 즉각 반응:
- 타일 좌측 bar가 빨강으로 바뀜
- 우상단 토스트: `Fullstack 오류 · 상태: error` (danger 색)
- Status bar 변화 없음 (시스템은 살아있음)

민지가 `g a` 두 번 눌러 Agents 탭 점프 → Fullstack 카드의 Skills 버튼 → 권한 확인 → 환경변수 추가 → `Resume` 버튼.

토스트: `재개 · 모든 에이전트 재개됨`. Fullstack 다시 working.

---

## 🎬 Scene 8 — 완료 (T+45m)

작업이 끝난다. 마지막 토스트 연쇄:
- `Designer 완료 · 작업 종료됨`
- `Fullstack 완료 · 작업 종료됨`
- `PM 완료 · 작업 종료됨`

KPI: Working 3 → 0. KPI Tokens: `0 → 87.3K (43%)` — bar는 아직 accent 보라.

Knowledge 탭에서 에이전트들이 적은 학습 노트가 마크다운으로 렌더링되어 있음.

---

## 🎬 Scene 9 — 자기 회사로 만들기 (T+60m)

민지: *"이 구성 마음에 든다. 다음 사이드 프로젝트에도 쓰자."*

`g a` → `Save as Preset` → `id: minji-saas-stack` `name: Minji's SaaS Team` 입력 → 저장.

토스트: `프리셋 저장됨 · presets/minji-saas-stack.json`

다음에 `bash install.sh` 할 때 옵션 7 (Custom) 또는 직접 프리셋 ID로 호출하면 동일한 8명이 그대로 배치됨.

---

## 🎬 Scene 10 — 종료 (T+90m)

> **민지**: `bash .claude/company/stop.sh`

tmux 세션 종료. Knowledge/channel/state 파일들은 그대로 남음. 내일 `run.sh` 다시 하면 같은 자리에서 이어짐.

---

## 흐름의 핵심 5가지

1. **15초 안에 회사 가동.** install → preset 선택 → 시동.
2. **첫 1초에 상태 파악.** KPI strip이 "지금 회사가 어떤지" 즉답.
3. **⌘K가 모든 것의 입구.** 탭/액션/에이전트/워크플로 단일 진입점.
4. **자동 피드백.** Toast가 silent failure를 막음. 에이전트 죽으면 즉시 알림.
5. **반복 가능.** 한번 만든 회사 구성을 프리셋으로 박제 → 다음 프로젝트에 복붙.

이 흐름의 진짜 가치: 민지는 한 번도 `cat .claude/company/inbox/orch.md`를 안 친다. 모든 게 대시보드에서 보이고, 모든 액션이 한 키보드 단축키 안에 있다.
