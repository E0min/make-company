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
4. 최근 개선 권고: `.claude/company/improvements/` 최신 JSON 읽기 (있으면)
5. 로그 기록 (반드시 둘 다):
```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚀 멀티에이전트 시작 | 태스크: <태스크>" >> .claude/company/activity.log
echo '{"event":"task_start","task_id":"task-'$(date +%Y%m%d-%H%M%S)'","task":"<태스크>","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
```
6. 디렉토리 보장:
```bash
mkdir -p .claude/company/retrospectives .claude/company/analytics .claude/company/improvements
```

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

**a) 호출 전 — 로그 기록 (activity.log + activity.jsonl 둘 다):**
```bash
_START=$(date +%s)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [agent-id] 🟢 시작 | 작업 설명" >> .claude/company/activity.log
echo '{"event":"agent_start","agent":"agent-id","task_id":"TASK_ID","workflow":"WORKFLOW","step":"STEP","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
echo -e "\n━━━ $(date '+%H:%M:%S') 작업 시작 ━━━\n요청: 작업 설명\n" >> .claude/company/agent-output/agent-id.log
```

**b) Agent tool 호출:**
- `subagent_type`: 매핑표 참조 (아래)
- `prompt`: **에이전트 프롬프트 구성 방법** (아래 섹션) 에 따라 구성

**c) 호출 후 — 로그 + JSONL 기록 (duration 포함):**
```bash
_END=$(date +%s)
_DUR=$((_END - _START))
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [agent-id] ✅ 완료 | 출력 요약" >> .claude/company/activity.log
echo '{"event":"agent_end","agent":"agent-id","task_id":"TASK_ID","duration_sec":'$_DUR',"quality_self":0,"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
echo -e "━━━ $(date '+%H:%M:%S') 작업 완료 ━━━\n결과 요약: ...\n" >> .claude/company/agent-output/agent-id.log
```
**중요**: `TASK_ID`는 2-1에서 생성한 값, `quality_self`는 CEO가 에이전트 출력 품질을 1~10으로 주관 평가 (없으면 0).

### 2-4. CEO 원칙 적용
- **병렬화**: 의존성 없는 팀원은 같은 응답에서 여러 Agent tool을 동시 호출
- **순차**: 이전 결과가 필요하면 결과 받은 후 다음 호출
- **수정 요청**: 결과가 불충분하면 같은 팀원에게 재요청
- **진행 표시**: 각 단계마다 `[진행] PRD ✓ · 디자인 ◔ · 프론트 ⏳` 형태로 사용자에게 표시

### 2-5. 완료 처리
모든 팀원 작업 완료 후, **반드시 아래 5단계를 순서대로 실행**:

**1) 태스크 종료 로그:**
```bash
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🏁 완료 | 태스크: <태스크>" >> .claude/company/activity.log
echo '{"event":"task_end","task_id":"TASK_ID","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
```

**2) 참여 에이전트별 자기평가 수집 (Agent tool 병렬 호출):**
각 참여 에이전트에게 다음 프롬프트로 호출:
```
이번 작업에 대해 자기평가를 JSON으로만 응답하세요:
{"went_well": "잘 된 것", "went_wrong": "문제였던 것", "action_item": "다음에 개선할 점", "quality_score": 7, "learned_pattern": "발견한 재사용 가능한 패턴 (없으면 빈 문자열)"}
```

**3) 회고 JSON 저장** (2-6 실행)

**4) 에이전트 메모리 업데이트** (2-7 실행)

**5) 사용자에게 최종 결과 + 회고 요약 표시

### 2-6. 회고 수집 및 저장 (자동)
2-5의 자기평가 결과를 받은 후 **실제로 JSON 파일을 생성**한다:

**a) RETRO_ID와 파일경로 결정:**
```bash
mkdir -p .claude/company/retrospectives
RETRO_DATE=$(date '+%Y-%m-%d')
# 같은 날짜의 기존 회고 수 세기
RETRO_SEQ=$(ls .claude/company/retrospectives/retro-${RETRO_DATE}-*.json 2>/dev/null | wc -l | tr -d ' ')
RETRO_SEQ=$((RETRO_SEQ + 1))
RETRO_ID="retro-${RETRO_DATE}-$(printf '%03d' $RETRO_SEQ)"
RETRO_FILE=".claude/company/retrospectives/${RETRO_ID}.json"
```

**b) JSON 구성 및 저장** — Write tool로 파일 생성:
```json
{
  "id": "RETRO_ID",
  "project": "config.json의 project 값",
  "task": "실행했던 태스크",
  "trigger": "automatic",
  "completed_at": "ISO 8601 타임스탬프",
  "duration_seconds": "태스크 시작~종료 초",
  "participants": [
    {"agent_id": "frontend-engineer", "role": "Frontend Engineer"}
  ],
  "feedback": [
    {
      "agent_id": "frontend-engineer",
      "went_well": "에이전트 응답에서 가져온 값",
      "went_wrong": "에이전트 응답에서 가져온 값",
      "action_item": "에이전트 응답에서 가져온 값"
    }
  ],
  "summary": "CEO가 작성한 1~2줄 요약 (2명 이상 같은 문제 지적 시 반드시 포함)",
  "tags": ["역할 기반 태그", "태스크 키워드 태그"]
}
```
**태그 규칙**: 참여 에이전트 역할 → qa, frontend, backend, design, marketing. 태스크 키워드 → bugfix, feature, refactor, testing 등.

**c) JSONL 이벤트 기록:**
```bash
echo '{"event":"retro_saved","retro_id":"RETRO_ID","participants":["agent-ids"],"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📝 회고 저장 | ${RETRO_ID} | 참여: agent-ids" >> .claude/company/activity.log
```

### 2-7. 메모리 + 공유 지식 업데이트 (자동)
회고 저장 직후 실행:

**a) 에이전트별 메모리 업데이트** — 각 에이전트의 action_item + learned_pattern을 메모리에 추가.
Bash로 직접 append:
```bash
# action_item → Learnings 섹션
echo "" >> .claude/company/agent-memory/agent-id.md
grep -q "## Learnings" .claude/company/agent-memory/agent-id.md || echo -e "\n## Learnings" >> .claude/company/agent-memory/agent-id.md
echo "- [$(date '+%Y-%m-%d')] ACTION_ITEM (source:${RETRO_ID})" >> .claude/company/agent-memory/agent-id.md

# learned_pattern이 비어있지 않으면 → Patterns 섹션
grep -q "## Patterns" .claude/company/agent-memory/agent-id.md || echo -e "\n## Patterns" >> .claude/company/agent-memory/agent-id.md
echo "- LEARNED_PATTERN" >> .claude/company/agent-memory/agent-id.md
```

**b) 메모리 업데이트 이벤트:**
```bash
echo '{"event":"memory_updated","agent":"agent-id","retro_ref":"RETRO_ID","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/activity.jsonl
```

**c) 교차 에이전트 공유 지식 생성:**
action_item이 다른 에이전트에게도 관련이 있으면 (예: QA가 발견한 보안 이슈 → 엔지니어에게 공유), shared-knowledge.jsonl에 추가:
```bash
echo '{"author":"agent-id","type":"pitfall또는pattern","key":"짧은키","insight":"교훈 내용","confidence":8,"relevant_agents":["관련 에이전트들"],"retro_ref":"RETRO_ID","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> .claude/company/shared-knowledge.jsonl
```
**판단 기준**: QA→엔지니어, 엔지니어→QA, 디자이너→프론트엔드 등 핸드오프 관계의 에이전트에게 공유.

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

웹 대시보드를 tmux 윈도우에서 시작한다. 세션 종료 시 자동으로 꺼진다.

Bash로 실행:
```bash
# 포트 자동 탐색
PORT=7777
while lsof -ti:$PORT >/dev/null 2>&1 && [ $PORT -lt 7800 ]; do
  PORT=$((PORT + 1))
done
if [ $PORT -ge 7800 ]; then
  echo "❌ 사용 가능한 포트를 찾을 수 없습니다 (7777~7799 모두 점유)"
else
  # 현재 tmux 세션에 Dashboard 윈도우 추가 (세션 종료 시 같이 죽음)
  SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null)
  if [ -n "$SESSION" ]; then
    tmux new-window -d -t "$SESSION:" -n Dashboard
    DASH_IDX=$(tmux list-windows -t "$SESSION" -F '#{window_index} #{window_name}' | grep 'Dashboard$' | tail -1 | awk '{print $1}')
    tmux send-keys -t "$SESSION:$DASH_IDX" "python3 .claude/company/dashboard/server.py $PORT" Enter
  else
    # tmux 밖이면 포그라운드로 실행
    python3 .claude/company/dashboard/server.py $PORT &
  fi
  sleep 1
  open "http://localhost:$PORT"
  echo "🌐 대시보드: http://localhost:$PORT (Dashboard 윈도우)"
fi
```

- 포트 7777부터 시작, 점유 시 +1씩 증가 (최대 7799)
- **tmux 세션 안에서 실행** → 세션 종료 시 대시보드도 자동 종료
- 브라우저 탭 타이틀에 프로젝트 이름 표시
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
4. **팀 공유 지식 주입** (있으면):
   `.claude/company/shared-knowledge.jsonl`에서 `relevant_agents`에 현재 agent-id가 포함된 항목을 confidence 내림차순으로 최대 5건 읽어서 다음 섹션 추가:
   ```
   ## 팀 공유 지식
   - [pitfall] 동적 콘텐츠에 escapeHtml 필수 (by fe-qa, confidence:9)
   - [pattern] API contract validation before impl (by be-qa, confidence:8)
   ```
5. **도구 사용 가이드 주입** (있으면):
   `.claude/company/tool-profiles.json`에서 해당 agent-id의 프로필을 읽어서:
   ```
   ## 도구 사용 가이드
   - 우선 사용: Read, Write, Edit, Bash, chrome-devtools
   - 사용 금지: WebSearch
   - 참고: 브라우저 테스트 시 chrome-devtools MCP 사용
   ```
6. **최근 개선 사항 주입** (있으면):
   `.claude/company/improvements/` 최신 JSON에서 해당 agent-id 관련 findings를 읽어서:
   ```
   ## 최근 개선 사항
   - [2026-04-11] 빈 상태(empty) 처리를 매번 자가 점검할 것
   ```
7. **구조화된 워크플로우 강제** (하네스 핵심):
   `config.json`의 `agent_role_map`과 `agent_profiles`를 읽어서 에이전트 역할에 맞는 체크포인트를 주입.

   **역할별 체크포인트 (config.json에서 동적 결정):**

   - **engineer** (frontend-engineer, backend-engineer):
     `[CHECKPOINT:analyze]` → `[CHECKPOINT:plan]` → `[CHECKPOINT:implement]` → `[CHECKPOINT:verify]` → `[CHECKPOINT:complete]`

   - **qa** (fe-qa, be-qa):
     `[CHECKPOINT:scope]` → `[CHECKPOINT:test]` → `[CHECKPOINT:report]` → `[CHECKPOINT:complete]`

   - **planner** (ceo, product-manager):
     `[CHECKPOINT:research]` → `[CHECKPOINT:draft]` → `[CHECKPOINT:review]` → `[CHECKPOINT:complete]`

   - **creative** (ui-ux-designer, marketing-strategist):
     `[CHECKPOINT:research]` → `[CHECKPOINT:draft]` → `[CHECKPOINT:iterate]` → `[CHECKPOINT:complete]`

   에이전트 프롬프트에 해당 역할의 체크포인트를 주입:
   ```
   ## 필수 워크플로우 (반드시 이 순서대로 실행하세요)
   각 단계 완료 후 [CHECKPOINT:step_name] 형식으로 보고하세요.
   마지막 단계에서 반드시 품질자가평가: N/10을 포함하세요.
   ```
   구체적 스텝 설명은 역할에 맞게 CEO가 구성한다.

   **프로젝트별 커스텀**: config.json의 `agent_profiles`에 새 역할 타입을 추가하면 하네스가 자동 적응.
   예: data-engineer → `{"role_type": "data", "checkpoints": ["ingest", "transform", "validate", "complete"], "quality_gate": 8}`

   **동적 에이전트 추가**: config.json의 `agents` 배열에 새 에이전트 ID 추가 + `agent_role_map`에 매핑 추가 → 즉시 적용.
   에이전트 .md 파일만 `.claude/agents/`에 생성하면 됨.

   **CEO는 에이전트 출력에서 `[CHECKPOINT:...]` 패턴을 파싱하여 모든 스텝이 완료되었는지 확인한다.**
   누락된 체크포인트가 있으면 → 해당 스텝을 다시 요청한다.
   (이 검증은 agent-harness.sh PostToolUse hook이 코드 레벨로도 강제한다.)

8. 구체적 태스크 지시

---

## 경계 하네스: 호출 후 검증 (CEO가 실행)

에이전트 출력을 받은 후, CEO는 **반드시** 다음 검증을 수행한다:

### a) 체크포인트 완전성 검증
에이전트 출력에서 `[CHECKPOINT:analyze]`, `[CHECKPOINT:plan]`, `[CHECKPOINT:implement]`, `[CHECKPOINT:verify]`, `[CHECKPOINT:complete]` 5개가 모두 있는지 확인.

누락 시:
```
에이전트에게 재요청: "Step N이 누락되었습니다. 해당 스텝을 실행하고 [CHECKPOINT:step_name] 형식으로 보고하세요."
```

### b) 품질 게이트
`[CHECKPOINT:complete]` 에서 `품질자가평가`가 6 미만이면:
- 에이전트에게 재작업 요청: "품질 점수가 N/10으로 낮습니다. 개선 후 다시 보고하세요."

### c) 출력 검증 API 호출
서버의 `POST harness/validate`를 호출하여 출력 품질을 기계적으로 검증:
- 너무 짧은 출력 → 재작업
- 에러 패턴 감지 → 수정 요청
- TODO 과다 → 미해결 작업 처리 요청

### d) 멀티콜 분해 (복잡한 태스크)
태스크가 복잡하면 한 번에 전부 시키지 말고, **스텝별로 나눠 호출**:

```
Call 1: Agent(frontend-engineer, "Step 1-2만: 분석 + 계획 수립. [CHECKPOINT:analyze]와 [CHECKPOINT:plan]을 출력하세요.")
  → CEO가 계획을 검토
  → 문제 있으면 수정 요청

Call 2: Agent(frontend-engineer, "이 계획대로 구현하세요: {plan}. [CHECKPOINT:implement]와 [CHECKPOINT:verify]를 출력하세요.")
  → CEO가 결과 검증
  → Bash로 빌드/테스트 실행

Call 3 (필요 시): Agent(frontend-engineer, "이 이슈를 수정하세요: {issues}")
```

이 패턴은 에이전트 내부를 통제할 수 없는 한계를 **호출 경계에서의 반복 검증**으로 보완한다.

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

## 컨텍스트 관리 (CTX 60% 규칙)

PostToolUse 훅이 컨텍스트 사용률 60%를 감지하면 알림이 표시된다.
이 알림이 뜨면 다음을 수행:

1. 사용자에게 물어본다: "컨텍스트가 60%를 넘었습니다. /compact 전에 보존할 내용이 있으면 알려주세요."
2. 사용자가 보존할 내용을 알려주면:
   - `.claude/company/agent-memory/<현재-에이전트>.md`에 해당 내용을 저장
   - 그 후 `/compact` 실행
3. 사용자가 "그냥 해"라고 하면 바로 `/compact` 실행

---

## 에러 처리

- config.json 없으면: "❌ `/company setup`을 먼저 실행하세요."
- 에이전트 파일 없으면: "❌ 에이전트 '<id>'를 찾을 수 없습니다."
- 워크플로우 파일 없으면: "❌ 워크플로우 '<name>'을 찾을 수 없습니다."

## 언어

사용자에게 보여주는 모든 메시지는 한국어로 작성한다.
