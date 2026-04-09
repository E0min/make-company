# /company Skill

사용자가 `/company`를 호출하면 뒤에 오는 서브커맨드에 따라 분기한다.
- `/company setup` → 프로젝트 에이전트 셋업
- `/company run <태스크>` → **멀티에이전트** (메인 Claude가 CEO로서 자율 조율)
- `/company workflow <name> [input]` → **서브에이전트** (YAML 파이프라인)
- `/company dashboard` → tmux 대시보드 시작
- `/company memory [agent-id]` → 에이전트 메모리 조회/수정
- 서브커맨드 없으면 → 사용법 안내 (한국어)

---

## 1. `/company setup`

### 1-1. 에이전트 목록 표시
- Bash로 `ls ~/.claude/agents/*.md` 파일을 모두 찾는다.
- 각 파일의 frontmatter에서 `name`과 `description`을 읽어 표시:
  ```
  사용 가능한 에이전트:
  1. ceo — 전체 프로젝트를 총괄하는 시니어 오케스트레이터
  2. product-manager — Discovery-first PM
  ...
  ```
- 사용자에게 "사용할 에이전트 번호를 선택하세요 (예: 1,2,3,5 또는 all)" 라고 묻는다.
- **CEO는 반드시 포함**되어야 한다. 선택 안 했으면 자동 추가.

### 1-2. 프로젝트 컨텍스트 자동 감지
현재 프로젝트 루트에서 다음 파일들을 Read로 읽어 기술 스택을 파악:
- `CLAUDE.md`, `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod` 등

### 1-3. 에이전트 파일 복사
선택된 각 에이전트: `~/.claude/agents/<name>.md` → `.claude/agents/<name>.md`로 복사.
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

### 1-5. 에이전트 메모리 + 출력 디렉토리 생성
- `mkdir -p .claude/company/agent-memory .claude/company/agent-output`
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
CEO .md의 "Discovery 우선" 원칙에 따라 태스크를 분류:
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
3. 사용자에게 최종 결과 표시

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

tmux 대시보드를 시작한다:

```bash
bash .claude/company/dashboard.sh
```

대시보드 구조:
- 윈도우 0: Monitor — `tail -f activity.log` (전체 활동 흐름)
- 윈도우 1~N: 각 에이전트 — `tail -f agent-output/{agent-id}.log` (개별 에이전트 출력)

사용자에게 안내:
```
대시보드가 시작되었습니다.
다른 터미널에서: tmux attach -t vc-dashboard
윈도우 전환: Ctrl+B → 번호
```

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

## 에러 처리

- config.json 없으면: "❌ `/company setup`을 먼저 실행하세요."
- 에이전트 파일 없으면: "❌ 에이전트 '<id>'를 찾을 수 없습니다."
- 워크플로우 파일 없으면: "❌ 워크플로우 '<name>'을 찾을 수 없습니다."

## 언어

사용자에게 보여주는 모든 메시지는 한국어로 작성한다.
