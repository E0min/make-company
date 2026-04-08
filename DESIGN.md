# Design System — Virtual Company

> **Linear-leaning Cyber Refined**
> 정보 밀도 + 정확성 + 단일 보라 액센트
> 영감: Linear (메인) + Vercel (geometric) + Stripe (refinement) + Notion (가독성)

---

## Product Context

- **What this is**: 9인 멀티 에이전트 시스템의 모니터링/관리 대시보드. tmux 기반 회사 시스템의 웹 컨트롤 플레인.
- **Who it's for**: CLI/터미널에 익숙한 builder — 개발자, PM, 디자이너. 정보 밀도가 높아도 괜찮은 사용자.
- **Project type**: 내부 SaaS 도구 (information-dense dashboard, 다크모드 우선)
- **Reference DNA**: Linear (정보 밀도, 보라 액센트), Vercel (극단 다크, 정밀 타이포), Stripe (refinement), Notion (가독성)

---

## Aesthetic Direction

- **Direction**: Linear-leaning Cyber Refined
- **Decoration level**: Minimal — 타이포와 spacing이 모든 일을 함
- **Mood**: 정확하고 빠르고 조용한 도구. 개발자가 "이 사람들 진지하게 만들었네"라고 느낌. 화려하지 않지만 모든 1px이 의도된 것.
- **Reference sites**: linear.app, vercel.com, stripe.com/dashboard, notion.so

---

## Typography

### Font Stack

```css
--font-display: "Geist", -apple-system, "SF Pro Display", system-ui, sans-serif;
--font-body:    "Geist", -apple-system, system-ui, sans-serif;
--font-mono:    "Geist Mono", "JetBrains Mono", "SF Mono", Menlo, monospace;
```

**Loading**: Self-host Geist + Geist Mono (Vercel 무료 제공). CDN: `https://vercel.com/font`

### Scale (modular 1.2)

| Token | px | line-height | Use |
|-------|----|----|-----|
| `text-xs` | 11 | 16 | Badges, micro labels |
| `text-sm` | 12 | 18 | Meta, captions, table cells |
| `text-base` | 13 | 20 | **Body (Linear standard)** |
| `text-md` | 14 | 22 | UI labels, buttons |
| `text-lg` | 16 | 24 | Subheading |
| `text-xl` | 18 | 28 | Section title |
| `text-2xl` | 22 | 32 | Page title |
| `text-3xl` | 28 | 36 | Display only |

### Weight

| Token | Value | Use |
|-------|-------|-----|
| regular | 400 | Body, paragraphs |
| medium | 500 | UI labels, buttons, table headers |
| semibold | 600 | Headings, emphasis |
| bold | 700 | Display only (rare) |

### Letter Spacing

- `display: -0.01em` (tighter for large text)
- `body: -0.005em`
- `caps: +0.04em` (uppercase labels)

### Tabular Numbers (필수)

모든 숫자/시간/카운터에 강제 적용:

```css
font-feature-settings: "tnum", "cv11";
font-variant-numeric: tabular-nums;
```

이것이 안 되면 디자인 시스템 위반.

---

## Color

### Background System (다크 우선)

```css
--bg-base:     #08080a;  /* 가장 어두움, page bg */
--bg-elevated: #0d0d10;  /* cards, sidebars */
--bg-overlay:  #15151a;  /* modals, dropdowns */
--bg-hover:    #1c1c22;  /* hover states */
--bg-active:   #2a2a32;  /* active/pressed */
```

### Border System

```css
--border-subtle: #1f1f25;  /* 1px default, 90% 사용 */
--border-strong: #2e2e36;  /* focused, separators */
--border-accent: #5e6ad2;  /* primary state */
```

**규칙**: solid 만, dashed/dotted 금지

### Foreground

```css
--fg:          #ededed;  /* high contrast text */
--fg-muted:    #9ca3af;  /* secondary */
--fg-subtle:   #6b7280;  /* tertiary, captions */
--fg-disabled: #4b5563;
```

### Accent (단일)

```css
--accent:        #5e6ad2;             /* Linear purple */
--accent-hover:  #6c78dc;
--accent-active: #4f5ac0;
--accent-bg:     rgba(94, 106, 210, 0.1);   /* subtle bg */
--accent-border: rgba(94, 106, 210, 0.3);   /* subtle border */
```

### Semantic (상태 표시만)

```css
--success:    #4cb782;   --success-bg: rgba(76, 183, 130, 0.1);
--warning:    #f2c94c;   --warning-bg: rgba(242, 201, 76, 0.1);
--danger:     #eb5757;   --danger-bg:  rgba(235, 87, 87, 0.1);
--info:       #4ea7e7;   --info-bg:    rgba(78, 167, 231, 0.1);
```

**규칙**: semantic 색은 오직 상태 표시 (success/error/etc) — 장식 금지

---

## Spacing (4px base, 8px grid 우선)

```css
--space-0_5: 2px;   /* hairline */
--space-1:   4px;   /* gap-tight */
--space-1_5: 6px;
--space-2:   8px;   /* ★ 기본 단위 */
--space-3:  12px;   /* icon gap */
--space-4:  16px;   /* ★ card padding */
--space-5:  20px;
--space-6:  24px;   /* ★ section gap */
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;   /* page section */
--space-20: 80px;
```

**density**: comfortable (Linear 정확히 따라감) — 패딩 작게, 정보 많게

---

## Layout

- **sidebar-width**: 240px (fixed)
- **header-height**: 48px (Linear standard)
- **max-content**: 1280px
- **gutter-desktop**: 24px
- **gutter-mobile**: 16px
- **grid**: 8 columns content area

### Border Radius

```css
--radius-sm:  4px;   /* badges, tiny */
--radius-md:  6px;   /* ★ Linear default — buttons, inputs */
--radius-lg:  8px;   /* cards */
--radius-xl:  12px;  /* modals */
--radius-2xl: 16px;  /* large surfaces, sparingly */
--radius-full: 9999px; /* pills only */
```

---

## Motion

### Duration

```css
--motion-instant: 50ms;   /* hover state */
--motion-fast:   150ms;   /* ★ default */
--motion-medium: 250ms;   /* modal open */
--motion-slow:   400ms;   /* page transition */
```

### Easing

```css
--ease-default: cubic-bezier(0.16, 1, 0.3, 1);   /* ★ Linear/Vercel */
--ease-smooth:  cubic-bezier(0.4, 0, 0.2, 1);
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
```

**규칙**: 과한 애니메이션 금지. 모든 transition 150ms 기본.

---

## Elevation (Border 우선)

대부분의 elevation은 border로 표현. shadow는 modal/popover에만.

```css
--elevation-0: 1px solid var(--border-subtle);
--elevation-1: 1px solid var(--border-subtle); /* + bg-elevated */
--elevation-2: 1px solid var(--border-strong); /* + bg-overlay + shadow-sm */

--shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
--shadow-md: 0 4px 12px rgba(0,0,0,0.5);  /* modals only */
--shadow-lg: 0 12px 32px rgba(0,0,0,0.6);
```

---

## Component Conventions

### Button

```
height: 28px (sm) | 32px (md) | 36px (lg)
padding: 0 12px (sm) | 0 16px (md) | 0 20px (lg)
border-radius: 6px (md)
font: text-md, weight 500
transition: all 150ms ease-default
```

variants:
- `primary` — accent bg, white text
- `secondary` — bg-elevated, border-subtle, fg
- `ghost` — transparent, fg-muted → fg on hover
- `danger` — danger bg

### Input

```
height: 32px
padding: 0 12px
bg: bg-base
border: 1px solid border-subtle
border-focus: 1px solid accent
border-radius: 6px
font: text-md
```

### Card

```
bg: bg-elevated
border: 1px solid border-subtle
border-radius: 8px
padding: 16px
```

### Badge / Pill

```
height: 20px
padding: 0 8px
border-radius: 4px (sm) | 9999px (pill)
font: text-xs, weight 500, uppercase, letter-spacing +0.04em
```

### Table

```
font: text-sm
row-height: 36px
header bg: bg-elevated
header weight: 500, text-xs uppercase
border-bottom: 1px solid border-subtle (rows)
hover: bg-hover
숫자/시간 column: tabular-nums
```

### Tab

```
height: 36px
padding: 0 12px
font: text-md, weight 500
underline: 2px accent (active)
color: fg-muted → fg (active)
```

### Sidebar

```
width: 240px
bg: bg-elevated
border-right: 1px solid border-subtle
item-height: 28px
item-padding: 0 8px
item-radius: 4px
item-font: text-md, weight 500
item-hover: bg-hover
item-active: accent-bg + accent fg
```

---

## 핵심 원칙 (디자인 시스템의 영혼)

1. **Border > Shadow** — Linear/Vercel 따라 elevation은 border로
2. **Tabular numbers** — 모든 숫자가 monospace tabular
3. **8px grid 엄격** — 모든 spacing은 4의 배수, 가급적 8의 배수
4. **단일 액센트** — 보라 1색만 + semantic 상태 4색, 나머지 없음
5. **High info density** — Linear 처럼 packed but breathable
6. **Subtle motion** — 150ms cubic-bezier, 과한 애니메이션 금지
7. **Geist 일관 사용** — 다른 폰트 절대 안 섞음
8. **Border 1px solid** — dashed/dotted 금지

---

## Anti-Patterns (절대 금지)

- ❌ 보라색 외 액센트 추가 (파랑/초록 액센트)
- ❌ Gradient buttons (특히 보라→핑크)
- ❌ 3-column icon grids with colored circles
- ❌ Soft drop shadows on cards (border 사용)
- ❌ Rounded everything (지나친 border-radius)
- ❌ Inter / Roboto / Open Sans (Geist만)
- ❌ Decorative animations
- ❌ Large hero illustrations (개발자 도구 아님)
- ❌ Centered marketing copy
- ❌ "Built for X" 카피 패턴

---

## UX Patterns (강화 레이어)

토큰만으로는 부족하다. 정보 위계, 피드백, 발견 가능성을 패턴으로 표준화한다.

### 1. Command Palette (⌘K)

Linear/Vercel 시그니처. 모든 액션·탭·에이전트·워크플로의 단일 진입점.

```
height: 480px (max), width: 560px
position: fixed top: 12vh, centered
trigger: ⌘K / Ctrl+K (전역) | ESC (닫기)
filter: substring + fuzzy on label
sections: Tabs / Actions / Agents / Workflows / Skills
keyboard: ↑↓ navigate, Enter execute, ESC close
```

검색 input 자동 focus. 결과 0개일 때 "결과 없음" 마이크로카피. 최근 사용 액션은 sessionStorage.

### 2. Status Bar (footer, 24px)

화면 최하단 sticky. polling이 살아있음을 항상 증명.

```
height: 24px
bg: bg-elevated
border-top: 1px solid border-subtle
font: text-xs (11px) tabular-nums
slots: ● Live · updated 2s ago | N agents · M workflows | ⌘K hint
```

`updated Xs ago`는 1초마다 증가. polling 실패 시 dot이 yellow → 5s 이상 fail 시 red.

### 3. KPI Strip (Overview 상단)

평평한 그리드를 정보 위계로 분리. 첫 1초에 "회사가 어떤 상태야"를 답한다.

```
4 카드 grid: Active Agents | Working Now | Tokens (progress) | Workflows
height: 88px each
font: stat-value 24px semibold tabular-nums
hover: bg-overlay
clickable: 해당 탭으로 jump
```

토큰 카드만 progress bar 포함 (한도 대비 사용량). 80%↑ warning, 95%↑ danger 색상.

### 4. Empty / Loading / Error States

모든 빈 영역에 표준 패턴.

**Empty:**
```
center align, padding: 48px
icon (1px stroke svg, 32px) + headline (text-md fg-muted) + action button
```

**Loading (skeleton):**
```
3-4 회색 박스 (bg-overlay, radius-md)
shimmer 없음 — DESIGN.md "subtle motion" 원칙
opacity 1, 단순 정적
```

**Error:**
```
danger-bg, danger border, fg-text
"문제 발생: {message}" + retry 버튼
```

### 5. Agent State Legend

Overview 그리드 위 한 줄. 신규 사용자가 색상을 추측할 필요 없음.

```
display: flex gap: 16px
font: text-xs uppercase letter-spacing 0.04em
each item: ●(8px dot) + label
states: working / idle / compacting / paused / error
```

### 6. Cost Progress Bar (header)

`0 / 200K` 텍스트 + 우측 80px linear bar.

```
height: 4px
bg: border-subtle
fill: accent (→ warning at 80% → danger at 95%)
radius-full
```

### 7. Channel / Knowledge 파싱

`<pre>` 덤프 금지. 패턴 인식 후 컴포넌트 렌더.

**Channel format:** `[from→to] body` 또는 `from: body`
- `from`/`to`: accent color, font-weight 500
- 메시지 사이 4px gap
- 새 메시지 push 시 자동 스크롤 (사용자가 수동 위로 안 갔을 때만)

**Knowledge:** 최소 markdown — h2/h3/code/list만. 나머지는 plain.

### 8. Modal Hygiene

모든 모달이 동일하게 동작.

```
ESC: 닫기
backdrop click: 닫기 (modal-content 외부)
focus trap: tab 순환을 modal 내부로 제한
autofocus: 첫 input
animation: 200ms scale 0.98 → 1 + opacity (이미 적용됨)
```

위험 액션(삭제, 일시정지)은 native `confirm()` 대신 in-modal confirm 패턴.

### 9. Toast Notifications

상단 우측 stack. 4초 자동 사라짐.

```
position: fixed top: 64px right: 16px
width: 320px
gap: 8px
variants: success / warning / danger / info (semantic 색)
animation: slide-in from right + fade-out
trigger: agent error 진입, workflow 완료, 비용 한도 임박
```

native `alert()` 전부 toast로 교체.

### 10. Keyboard Shortcuts

CLI 사용자 대상. ⌘K 외 추가:

```
g o → Overview
g w → Workflows
g a → Agents
g k → Knowledge
g c → Channel
n → 새 워크플로 (Workflows 탭에서)
N → 새 에이전트 (Agents 탭에서)
?  → 단축키 도움말 모달
ESC → 모달/팔레트 닫기
```

`g` 후 1초 내 다음 키. (Vim/Linear 패턴)

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-08 | Initial design system created | /design-consultation 으로 Linear/Stripe/Notion/Vercel DNA 분석 후 정의. 개발자 도구 + 정보 밀도 컨텍스트 → Linear-leaning + Vercel geometric 하이브리드 선택. |
| 2026-04-08 | Geist 폰트 단일 사용 | Vercel 패턴. Inter는 너무 흔함. Geist는 modern + 개발자 친화적. |
| 2026-04-08 | bg-base #08080a (극단 다크) | Vercel 값. 정보 밀도 높은 도구에서 눈 피로 최소화. |
| 2026-04-08 | 보라 #5E6AD2 단일 액센트 | Linear 시그니처. 개발자 도구에서 흔하지 않아 차별화. |
| 2026-04-08 | 13px base text | Linear 표준. 더 많은 정보 표시를 위해 일반(14-15px)보다 작게. |
| 2026-04-08 | Border-only elevation | Shadow 거의 안 씀 (modal만). 더 sharper, more refined. |
| 2026-04-08 | UX Patterns 레이어 추가 (10개) | 토큰만으로는 부족. 정보 위계/피드백/발견 가능성을 패턴으로 표준화. ⌘K, status bar, KPI strip, toast 등. |

---

## Implementation Notes

이 디자인 시스템을 코드로 구현할 때:

1. **CSS Custom Properties로 모든 토큰 정의** (`:root`)
2. **Geist 폰트 self-host** (`@font-face`)
3. **모든 숫자에 `tabular-nums` class 강제**
4. **dark mode가 default** — light mode는 차후
5. **`/design-html` 또는 `/frontend-design` 스킬로 구현 시작**

다음 단계: `/frontend-design` 스킬로 대시보드 5개 탭 (Overview, Workflows, Agents, Knowledge, Channel)을 이 시스템 기반으로 재구현
