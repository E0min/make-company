# /company Skill

## Preamble (매 실행 시 자동)

```bash
_VC_DIR="${VC_TEMPLATE:-$HOME/make-company}"
_UPD=""
if [ -x "$_VC_DIR/bin/vc-update-check" ]; then
  _UPD=$("$_VC_DIR/bin/vc-update-check" 2>/dev/null || true)
fi
[ -n "$_UPD" ] && echo "$_UPD" || true
_VC_VER=$(cat "$_VC_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
echo "VC_VERSION: $_VC_VER"
```

- `JUST_UPGRADED <old> <new>` → "make-company v{new}로 업그레이드 완료!" 메시지 표시
- `UPGRADE_AVAILABLE <old> <new>` → "⬆ make-company 업데이트 있음 (v{old} → v{new}). `/company upgrade` 로 업데이트하세요." 표시
- 그 외 → 무시하고 진행

---

사용자가 `/company`를 호출하면 뒤에 오는 서브커맨드에 따라 분기한다.
- `/company setup` → 프로젝트 에이전트 셋업
- `/company run <태스크>` → **멀티에이전트** (메인 Claude가 CEO로서 자율 조율)
- `/company workflow <name> [input]` → **서브에이전트** (YAML 파이프라인)
- `/company dashboard` → tmux 대시보드 시작
- `/company memory [agent-id]` → 에이전트 메모리 조회/수정
- `/company retro` → 회고 목록 조회/분석
- `/company upgrade` → 최신 버전으로 업그레이드
- 서브커맨드 없으면 → 사용법 안내 (한국어)

---

## 1. `/company setup`

### 1-1. 기존 프로젝트 에이전트 감지
먼저 `.claude/agents/` 디렉토리가 이미 존재하는지 확인한다.
존재하면 기존 에이전트 .md 파일 목록을 읽고 사용자에게 보여준다:

```
기존 프로젝트 에이전트 감지됨:
  - my-custom-agent.md
  - data-engineer.md
  - devops.md
```

각 기존 에이전트 파일을 Read로 읽어 `{{project_context}}`와 `{{agent_memory}}` 플레이스홀더가 있는지 확인한다.

- **플레이스홀더가 있으면**: v2 호환. 그대로 유지.
- **플레이스홀더가 없으면**: 마이그레이션 제안.
  사용자에게 "기존 에이전트를 v2 형식으로 업그레이드하시겠습니까? (y/n)" 묻는다.
  y이면 각 에이전트 .md 파일의 Role 섹션 바로 뒤에 다음 두 블록을 삽입한다:
  ```
  ## 프로젝트 컨텍스트
  {{project_context}}

  ## 누적 기억
  {{agent_memory}}
  ```
  기존 내용은 절대 삭제하지 않는다 — 플레이스홀더만 추가.

기존 에이전트는 config.json의 agents 목록에 자동으로 포함된다.

### 1-2. 글로벌 에이전트 목록 표시
- Bash로 `ls ~/.claude/agents/*.md` 파일을 모두 찾는다.
- 이미 프로젝트에 있는 에이전트는 "(이미 설치됨)"으로 표시한다.
- 나머지를 번호와 함께 표시:
  ```
  글로벌 에이전트:
  1. ceo — 전체 프로젝트를 총괄하는 시니어 오케스트레이터
  2. product-manager — Discovery-first PM (이미 설치됨)
  3. frontend-engineer — 시니어 프론트엔드 개발자
  ...
  ```
- 사용자에게 "추가할 에이전트 번호를 선택하세요 (예: 1,3,5 또는 all 또는 skip)" 라고 묻는다.
- **CEO는 반드시 포함**되어야 한다. 프로젝트에도 글로벌에도 없으면 글로벌에서 자동 복사.

### 1-3. 프로젝트 컨텍스트 자동 감지
현재 프로젝트 루트에서 다음 파일들을 Read로 읽어 기술 스택을 파악:
- `CLAUDE.md`, `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod` 등

### 1-4. 에이전트 파일 복사
선택된 글로벌 에이전트만 복사: `~/.claude/agents/<name>.md` → `.claude/agents/<name>.md`.
이미 프로젝트에 있는 동명 파일은 **덮어쓰지 않는다** (기존 커스텀 보존).
`{{project_context}}`와 `{{agent_memory}}`는 런타임에 해석되므로 건드리지 않는다.

### 1-4. 설정 파일 생성
`.claude/company/config.json`:
```json
{
  "project": "<감지된 프로젝트명>",
  "tech_stack": "<감지된 기술 스택 요약>",
  "agents": ["ceo", "product-manager", "frontend-engineer", ...],
  "language": "ko"
}
```

### 1-5. 에이전트 메모리 + 출력 + 회고 디렉토리 생성
- `mkdir -p .claude/company/agent-memory .claude/company/agent-output .claude/company/retrospectives`
- 각 에이전트별 메모리/출력 파일 생성 (이미 있으면 건드리지 않음)

### 1-6. 워크플로우 템플릿 복사
`~/.claude/workflows/*.yml` → `.claude/workflows/`로 복사 (없는 것만)

### 1-7. 완료 메시지 표시

---

## 2. `/company run <태스크>` — 멀티에이전트 모드

**메인 Claude 자신이 CEO 역할을 수행하며, 팀원을 Agent tool로 직접 호출한다.**

서브에이전트는 Agent tool을 중첩 호출할 수 없으므로, CEO를 별도 에이전트로 spawn하지 않는다.
대신 메인 Claude가 CEO .md의 원칙과 행동 규칙을 따라 직접 오케스트레이션한다.

### 2-1. 사전 준비
1. `.claude/company/config.json` 읽기 → project, tech_stack, agents 목록 확인
2. `.claude/agents/ceo.md` 읽기 → CEO의 핵심 원칙/행동 규칙을 내면화
3. CEO의 누적 기억: `.claude/company/agent-memory/ceo.md` 읽기
4. `.claude/company/activity.log`에 시작 기록 (Bash echo >>)
5. 대시보드가 떠 있으면 자동으로 표시됨

### 2-2. CEO 모드로 태스크 분석

**a) 과거 회고 참조:**
1. `.claude/company/retrospectives/` 디렉토리 확인
2. 존재하면 최근 JSON 파일들의 `tags`와 `task`를 스캔
3. 현재 태스크와 유사한 과거 회고를 최대 3건 선택 (tags 교집합 2개 이상 or 키워드 매칭)
4. 매칭된 회고의 action_item들을 이번 계획에 반영:
   ```
   [과거 회고 참조]
   - retro-2026-04-09-001: "API 계약서를 핸드오프 전 확정" (frontend, backend)
   ```

**b) 태스크 분류:**
CEO .md의 "Discovery 우선" 원칙에 따라:
- 신규 제품/기능 → PM 먼저
- UI 변경 → Designer 직접
- 버그 → QA 먼저
- 코드 리팩토링 → Engineer 직접
- 마케팅 → Marketing 직접

### 2-3. 팀원 호출 (Agent tool)
각 팀원을 호출할 때 **반드시 3단계**를 수행:

**a) 호출 전 — 로그 + 출력 기록:**
```bash
# activity.log에 시작 기록
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [agent-id] 🟢 시작 | 작업 설명" >> .claude/company/activity.log
# agent-output에 시작 표시
echo -e "\n━━━ $(date '+%H:%M:%S') 작업 시작 ━━━\n요청: 작업 설명\n" >> .claude/company/agent-output/agent-id.log
```

**b) Agent tool 호출:**
- `subagent_type`: 매핑표 참조 (아래)
- `prompt`: 팀원의 `.claude/agents/<id>.md` 내용 ({{project_context}}와 {{agent_memory}}를 치환) + 구체적 태스크

**c) 호출 후 — 로그 + 출력 기록:**
```bash
# activity.log에 완료 기록
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [agent-id] ✅ 완료 | 출력 요약" >> .claude/company/activity.log
# agent-output에 결과 기록
echo -e "━━━ $(date '+%H:%M:%S') 작업 완료 ━━━\n결과 요약: ...\n\n전체 출력:\n..." >> .claude/company/agent-output/agent-id.log
```

### 2-4. CEO 원칙 적용
- **병렬화**: 의존성 없는 팀원은 같은 응답에서 여러 Agent tool을 동시 호출
- **순차**: 이전 결과가 필요하면 결과 받은 후 다음 호출
- **수정 요청**: 결과가 불충분하면 같은 팀원에게 재요청
- **진행 표시**: 각 단계마다 `[진행] PRD ✓ · 디자인 ◔ · 프론트 ⏳` 형태로 사용자에게 표시

### 2-5. 완료 처리
모든 팀원 작업 완료 후:
1. activity.log에 완료 기록
2. 참여 에이전트 메모리 업데이트 (각 에이전트에 "배운 점 3줄 요약" Agent 호출 → append)
3. **회고 수집** (2-6 자동 실행)
4. 사용자에게 최종 결과 + 회고 요약 표시

### 2-6. 회고 수집 (자동)
2-5 완료 직후 자동 실행. 사용자 개입 없음.

**a) 디렉토리 보장:**
```bash
mkdir -p .claude/company/retrospectives
```

**b) 참여 에이전트에게 회고 요청 (병렬 Agent 호출):**
각 참여 에이전트에게 다음 프롬프트로 Agent tool 호출:
```
이번 작업에 대해 3줄 회고를 JSON으로만 응답하세요:
{"went_well": "잘 된 것", "went_wrong": "문제였던 것", "action_item": "다음 개선점"}
```
JSON 파싱 실패 시 원문을 raw_response에 보존.

**c) CEO 요약:**
수집된 feedback을 읽고 1~2줄 summary 생성. 2명 이상 같은 문제 지적 시 반드시 포함.

**d) 태그 자동 부여:**
participants에서 역할 기반 태그 + 태스크 키워드 매칭 (버그→bugfix, 디자인→design 등)

**e) JSON 저장:**
`.claude/company/retrospectives/retro-{날짜}-{순번}.json`에 저장.
구조: id, project, task, trigger, completed_at, duration_seconds, participants, feedback, summary, tags

**f) 에이전트 메모리에 action_item 반영:**
각 에이전트의 action_item을 `agent-memory/<id>.md`에 append:
```
- [retro-2026-04-10-001] API 계약서를 핸드오프 전 확정
```

**g) activity.log에 기록:**
```bash
echo "[timestamp] 📝 회고 저장 | retro-id | 참여: agents" >> .claude/company/activity.log
```

---

## 3. `/company workflow <name> [input]` — 서브에이전트 모드

**YAML 워크플로우 파이프라인이 흐름을 결정. 정해진 순서대로 에이전트를 호출.**

name이 없으면 `.claude/workflows/` 디렉토리의 파일 목록을 보여주고 선택하게 한다.
input이 없으면 사용자에게 "이 워크플로우에 전달할 입력을 입력하세요" 라고 묻는다.

### 3-1. 워크플로우 읽기 및 파싱
- `.claude/workflows/<name>.yml`을 Read로 읽는다.
- Bash로 YAML을 파싱 (python3 -c). 워크플로우의 steps 추출.

### 3-2. 토폴로지 순서 실행
2-3과 동일한 로그/출력 기록 패턴을 사용하여 각 스텝을 실행.
의존성 해결된 스텝을 동시 실행 (병렬 Agent tool 호출).

### 3-3. 완료 처리
2-5와 동일.

---

## 4. `/company dashboard`

웹 대시보드를 시작한다. 포트를 자동으로 탐색하고, 브라우저를 열어준다.

Bash로 실행:
```bash
PORT=7777
while lsof -ti:$PORT >/dev/null 2>&1 && [ $PORT -lt 7800 ]; do
  PORT=$((PORT + 1))
done
if [ $PORT -ge 7800 ]; then
  echo "❌ 사용 가능한 포트를 찾을 수 없습니다 (7777~7799 모두 점유)"
else
  python3 .claude/company/dashboard/server.py $PORT &
  sleep 1
  open "http://localhost:$PORT"
  echo "🌐 대시보드: http://localhost:$PORT"
fi
```

- 포트 7777부터 시작, 점유 시 +1씩 증가 (최대 7799)
- 두 프로젝트를 동시에 실행하면 각각 다른 포트에서 뜸
- 브라우저 탭 타이틀에 프로젝트 이름이 표시되어 구분 가능
- `open` 명령으로 기본 브라우저 자동 오픈

---

## 5. `/company memory [agent-id]`

### agent-id 없이 호출
- `.claude/company/agent-memory/*.md`를 찾기
- 각 파일의 처음 5줄 미리보기 표시

### agent-id와 함께 호출
- 해당 에이전트 메모리 전체 표시
- 수정 여부 확인

---

## Agent ID → subagent_type 매핑

| agent-id | subagent_type |
|---|---|
| ceo | CEO / Orchestrator |
| product-manager | Product Manager |
| ui-ux-designer | UI/UX Designer |
| frontend-engineer | Frontend Engineer |
| backend-engineer | Backend Engineer |
| fe-qa | Frontend QA |
| be-qa | Backend QA |
| marketing-strategist | Marketing Strategist |

매핑에 없는 agent-id는 `general-purpose`를 사용한다.

---

## 에이전트 프롬프트 구성 방법

팀원에게 Agent tool을 호출할 때, prompt는 다음 순서로 구성:

1. `.claude/agents/<agent-id>.md`의 전체 내용
2. `{{project_context}}` → config.json의 tech_stack 값으로 치환
3. `{{agent_memory}}` → `.claude/company/agent-memory/<agent-id>.md` 내용으로 치환 (비어있으면 "(아직 없음)")
4. 구체적 태스크 지시

---

## 7. `/company upgrade`

make-company를 최신 버전으로 업그레이드한다.

Bash로 실행:
```bash
bash "${VC_TEMPLATE:-$HOME/make-company}/bin/vc-upgrade"
```

업그레이드가 하는 일:
1. `git pull` (make-company repo)
2. 글로벌 에이전트 업데이트 (`~/.claude/agents/`)
3. 글로벌 워크플로우 업데이트 (`~/.claude/workflows/`)
4. 스킬 업데이트 (`~/.claude/skills/company/`)
5. 현재 프로젝트 대시보드 업데이트 (있으면)

완료 후 "v{old} → v{new} 업그레이드 완료!" 메시지 표시.

---

## 에러 처리

- config.json 없으면: "❌ `/company setup`을 먼저 실행하세요."
- 에이전트 파일 없으면: "❌ 에이전트 '<id>'를 찾을 수 없습니다."
- 워크플로우 파일 없으면: "❌ 워크플로우 '<name>'을 찾을 수 없습니다."

## 언어

사용자에게 보여주는 모든 메시지는 한국어로 작성한다.
