#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# test-harness.sh — 하네스 자동화 테스트 스위트
#
# make-company 프로젝트의 8개 하네스 파일에 대한 격리 테스트.
# bash + python3만 사용, 외부 의존성 없음.
#
# 사용법:
#   bash tests/test-harness.sh          # 전체 실행
#   bash tests/test-harness.sh --verbose  # 상세 출력
#
# 테스트 원칙:
#   - 각 테스트는 독립된 임시 디렉토리에서 실행
#   - 기존 ~/.claude 데이터 오염 없음 (HOME 오버라이드)
#   - 결과: PASS/FAIL + 요약 리포트
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -euo pipefail

# ── 설정 ──
VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

# 실제 하네스 파일 경로 (HOME의 hooks 디렉토리)
REAL_HOOKS_DIR="$HOME/.claude/hooks"
if [ ! -d "$REAL_HOOKS_DIR" ]; then
  echo "FATAL: $REAL_HOOKS_DIR 가 존재하지 않습니다."
  exit 1
fi

# ── 컬러 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 카운터 ──
TOTAL=0
PASSED=0
FAILED=0
FAILURES=""

# ── 유틸리티 ──

log_verbose() {
  $VERBOSE && echo -e "  ${CYAN}[DBG]${NC} $*" || true
}

# 임시 환경 생성: 가짜 HOME에 .claude/company + .claude/agents + .claude/workflows + .claude/hooks + .claude/skills 구조
setup_sandbox() {
  local tmpdir
  tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/vc-test-XXXXXX")

  # 가짜 HOME 구조
  mkdir -p "$tmpdir/home/.claude/company/agent-memory"
  mkdir -p "$tmpdir/home/.claude/company/agent-output"
  mkdir -p "$tmpdir/home/.claude/company/retrospectives"
  mkdir -p "$tmpdir/home/.claude/company/analytics"
  mkdir -p "$tmpdir/home/.claude/company/improvements"
  mkdir -p "$tmpdir/home/.claude/agents"
  mkdir -p "$tmpdir/home/.claude/workflows"
  mkdir -p "$tmpdir/home/.claude/skills"
  mkdir -p "$tmpdir/home/.claude/hooks"

  # 하네스 파일 복사 (실제 코드 테스트)
  cp "$REAL_HOOKS_DIR"/agent-harness.sh       "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/agent-create-harness.sh "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/workflow-harness.sh     "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/workflow-validate.py    "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/integrity-harness.sh    "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/integrity.py            "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/session-boot.sh         "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/auto-retro.sh           "$tmpdir/home/.claude/hooks/"
  cp "$REAL_HOOKS_DIR"/ctx-compact-check.sh    "$tmpdir/home/.claude/hooks/"
  chmod +x "$tmpdir/home/.claude/hooks/"*.sh

  # 기본 config.json
  cat > "$tmpdir/home/.claude/company/config.json" << 'CONFIGEOF'
{
  "project": "test-project",
  "agents": [
    "backend-engineer",
    "frontend-engineer",
    "product-manager",
    "be-qa"
  ],
  "agent_profiles": {
    "_default": {
      "checkpoints": ["analyze", "plan", "implement", "verify", "complete"],
      "quality_gate": 6
    },
    "engineer": {
      "checkpoints": ["analyze", "plan", "implement", "verify", "complete"],
      "quality_gate": 7
    },
    "qa": {
      "checkpoints": ["scope", "test", "report", "complete"],
      "quality_gate": 6
    },
    "planner": {
      "checkpoints": ["research", "draft", "review", "complete"],
      "quality_gate": 6
    }
  },
  "agent_role_map": {
    "backend-engineer": "engineer",
    "frontend-engineer": "engineer",
    "product-manager": "planner",
    "be-qa": "qa"
  },
  "skill_pipelines": {
    "engineer": {
      "feature": ["investigate", "plan-eng-review", "implement", "qa", "review"]
    }
  }
}
CONFIGEOF

  # 기본 에이전트 .md 파일 생성
  for agent in backend-engineer frontend-engineer product-manager be-qa; do
    cat > "$tmpdir/home/.claude/agents/${agent}.md" << AGENTEOF
---
name: ${agent}
description: Test agent for ${agent}
category: engineering
---
# Role
{{project_context}}
{{agent_memory}}
## 핵심 원칙
AGENTEOF
  done

  # 에이전트 메모리 파일 생성
  for agent in backend-engineer frontend-engineer product-manager be-qa; do
    touch "$tmpdir/home/.claude/company/agent-memory/${agent}.md"
    touch "$tmpdir/home/.claude/company/agent-output/${agent}.log"
  done

  # 빈 activity.jsonl
  touch "$tmpdir/home/.claude/company/activity.jsonl"

  echo "$tmpdir"
}

cleanup_sandbox() {
  local tmpdir="$1"
  rm -rf "$tmpdir" 2>/dev/null || true
}

# 테스트 실행 래퍼
run_test() {
  local test_name="$1"
  local test_func="$2"
  TOTAL=$((TOTAL + 1))

  echo -n "  [$TOTAL] $test_name ... "

  local tmpdir
  tmpdir=$(setup_sandbox)
  local result
  result=0

  # 테스트 함수 실행 (서브셸, HOME 오버라이드)
  if (export HOME="$tmpdir/home"; eval "$test_func" "$tmpdir") 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}FAIL${NC}"
    FAILED=$((FAILED + 1))
    FAILURES="${FAILURES}\n  - $test_name"
  fi

  cleanup_sandbox "$tmpdir"
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 1: 유효한 에이전트 생성 -> config.json 자동 등록
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_agent_create_valid() {
  local tmpdir="$1"
  local agent_file="$HOME/.claude/agents/new-agent.md"

  # 유효한 에이전트 파일 생성
  cat > "$agent_file" << 'EOF'
---
name: New Agent
description: A brand new test agent
category: engineering
---
# Role
{{project_context}}
{{agent_memory}}
## 핵심 원칙
Test content
EOF

  # agent-create-harness.sh에 Write 이벤트 전달
  local input='{"tool_name":"Write","tool_input":{"file_path":"'"$agent_file"'"}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-create-harness.sh" 2>&1)

  # config.json에 new-agent가 등록되었는지 확인
  python3 -c "
import json
config = json.load(open('$HOME/.claude/company/config.json'))
assert 'new-agent' in config['agents'], 'new-agent not in agents'
assert 'new-agent' in config['agent_role_map'], 'new-agent not in role_map'
assert config['agent_role_map']['new-agent'] == 'engineer', 'role should be engineer for engineering category'
"

  # agent-memory 파일 생성 확인
  [ -f "$HOME/.claude/company/agent-memory/new-agent.md" ] || return 1

  # agent-output 파일 생성 확인
  [ -f "$HOME/.claude/company/agent-output/new-agent.log" ] || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 2: 잘못된 에이전트 (frontmatter 없음) -> 검증 실패
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_agent_create_invalid_no_frontmatter() {
  local tmpdir="$1"
  local agent_file="$HOME/.claude/agents/bad-agent.md"

  # frontmatter 없는 에이전트 파일
  cat > "$agent_file" << 'EOF'
# Bad Agent
No frontmatter here
{{project_context}}
{{agent_memory}}
EOF

  local input='{"tool_name":"Write","tool_input":{"file_path":"'"$agent_file"'"}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-create-harness.sh" 2>&1)

  # "검증 실패" 메시지가 출력에 포함되어야 함
  echo "$output" | grep -q "검증 실패" || return 1

  # config.json에 등록되지 않아야 함
  python3 -c "
import json
config = json.load(open('$HOME/.claude/company/config.json'))
assert 'bad-agent' not in config['agents'], 'bad-agent should not be registered'
"
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 3: 체크포인트 완전 -> 경고 없음
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_checkpoint_complete() {
  local tmpdir="$1"

  # 모든 체크포인트가 포함된 에이전트 출력 시뮬레이션 (engineer role)
  local agent_output="[CHECKPOINT:analyze] 분석 완료
[CHECKPOINT:plan] 계획 수립
[CHECKPOINT:implement] 구현 완료
[CHECKPOINT:verify] 검증 완료
[CHECKPOINT:complete] 작업 완료
품질자가평가: 8/10"

  local input
  input=$(python3 -c "
import json
d = {
    'tool_name': 'Agent',
    'tool_input': {'subagent_type': 'backend-engineer'},
    'tool_output': '''$agent_output'''
}
print(json.dumps(d))
")

  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-harness.sh" 2>&1)

  # "누락" 경고가 없어야 함
  if echo "$output" | grep -q "누락된 체크포인트"; then
    return 1
  fi

  # "품질.*기준 미달" 경고가 없어야 함
  if echo "$output" | grep -q "기준 미달"; then
    return 1
  fi

  return 0
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 4: 체크포인트 누락 -> 경고 출력
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_checkpoint_missing() {
  local tmpdir="$1"

  # verify와 complete 누락
  local agent_output="[CHECKPOINT:analyze] 분석 완료
[CHECKPOINT:plan] 계획 수립
[CHECKPOINT:implement] 구현 완료
품질자가평가: 8/10"

  local input
  input=$(python3 -c "
import json
d = {
    'tool_name': 'Agent',
    'tool_input': {'subagent_type': 'backend-engineer'},
    'tool_output': '''$agent_output'''
}
print(json.dumps(d))
")

  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-harness.sh" 2>&1)

  # "누락된 체크포인트" 경고가 있어야 함
  echo "$output" | grep -q "누락된 체크포인트" || return 1

  # verify 또는 complete가 누락으로 표시되어야 함
  echo "$output" | grep -qE "(verify|complete)" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 5: 품질 게이트 미달 -> 경고 출력
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_quality_gate_fail() {
  local tmpdir="$1"

  # engineer quality_gate=7 인데 5/10 점수
  local agent_output="[CHECKPOINT:analyze] ok
[CHECKPOINT:plan] ok
[CHECKPOINT:implement] ok
[CHECKPOINT:verify] ok
[CHECKPOINT:complete] ok
품질자가평가: 5/10"

  local input
  input=$(python3 -c "
import json
d = {
    'tool_name': 'Agent',
    'tool_input': {'subagent_type': 'backend-engineer'},
    'tool_output': '''$agent_output'''
}
print(json.dumps(d))
")

  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-harness.sh" 2>&1)

  # "기준 미달" 경고가 있어야 함
  echo "$output" | grep -q "기준 미달" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 6: 유효한 워크플로우 -> 검증 통과
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_workflow_valid() {
  local tmpdir="$1"
  local wf_file="$HOME/.claude/workflows/test-workflow.yml"

  cat > "$wf_file" << 'EOF'
name: Test Workflow
steps:
  - id: plan
    agent: product-manager
    prompt: Plan the feature

  - id: build
    agent: backend-engineer
    depends_on: [plan]
    prompt: Build it

  - id: test
    agent: be-qa
    depends_on: [build]
    prompt: Test it
EOF

  # workflow-validate.py 직접 실행 (workflow-harness.sh는 stdin을 읽으므로 validate.py를 직접 테스트)
  local output
  output=$(python3 "$HOME/.claude/hooks/workflow-validate.py" "$wf_file" "$HOME/.claude/company/config.json" 2>&1)

  # "검증 통과" 메시지가 있어야 함
  echo "$output" | grep -q "검증 통과" || return 1

  # 오류가 없어야 함
  if echo "$output" | grep -q "오류:"; then
    return 1
  fi
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 7: 순환 의존성 워크플로우 -> 에러 출력
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_workflow_cycle() {
  local tmpdir="$1"
  local wf_file="$HOME/.claude/workflows/cycle-workflow.yml"

  cat > "$wf_file" << 'EOF'
name: Cycle Workflow
steps:
  - id: step-a
    agent: backend-engineer
    depends_on: [step-b]
    prompt: Do A

  - id: step-b
    agent: frontend-engineer
    depends_on: [step-a]
    prompt: Do B
EOF

  local output
  output=$(python3 "$HOME/.claude/hooks/workflow-validate.py" "$wf_file" "$HOME/.claude/company/config.json" 2>&1)

  # "순환 의존성" 에러가 있어야 함
  echo "$output" | grep -q "순환 의존성" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 8: config.json 정합성 위반 -> 경고 출력
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_config_integrity_violation() {
  local tmpdir="$1"

  # config.json에 존재하지 않는 에이전트를 role_map에 추가
  python3 -c "
import json
config = json.load(open('$HOME/.claude/company/config.json'))
config['agent_role_map']['ghost-agent'] = 'engineer'
with open('$HOME/.claude/company/config.json', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"

  local output
  output=$(python3 "$HOME/.claude/hooks/integrity.py" "$HOME/.claude/company" config 2>&1)

  # "ghost-agent" 관련 오류/경고가 있어야 함
  echo "$output" | grep -q "ghost-agent" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 9: L4 패턴 — pending-fix 파일 -> session-boot에서 주입
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_l4_pending_fix_injection() {
  local tmpdir="$1"

  # pending-fix 파일 생성 (현재 프로세스 PID 사용하지 않고 고정 이름)
  # session-boot.sh는 /tmp/vc-pending-fix-* 글로브로 읽음
  local pending_file="/tmp/vc-pending-fix-testharness-$$"
  echo "[CHECKPOINT_MISSING] test-agent의 체크포인트 누락: verify" > "$pending_file"

  local input='{"prompt":"/company run new-feature"}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/session-boot.sh" 2>&1)

  # pending-fix 내용이 주입되었는지 확인
  echo "$output" | grep -q "이전 작업에서 감지된 문제" || { rm -f "$pending_file"; return 1; }
  echo "$output" | grep -q "CHECKPOINT_MISSING" || { rm -f "$pending_file"; return 1; }

  # pending 파일이 삭제되었는지 확인
  if [ -f "$pending_file" ]; then
    rm -f "$pending_file"
    return 1
  fi

  return 0
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 10: 회고 게이트 — task_end 후 retro 없이 /company run -> 경고
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_retro_gate_missing() {
  local tmpdir="$1"

  # task_end 이벤트가 있지만 retro_saved가 없는 activity.jsonl
  cat > "$HOME/.claude/company/activity.jsonl" << 'EOF'
{"event":"session_boot","ts":"2026-04-10T10:00:00Z","source":"harness"}
{"event":"agent_start_harness","agent":"backend-engineer","ts":"2026-04-10T10:05:00Z","source":"harness"}
{"event":"agent_end_harness","agent":"backend-engineer","ts":"2026-04-10T10:30:00Z","source":"harness"}
{"event":"task_end","task_id":"TASK-001","ts":"2026-04-10T10:35:00Z","source":"harness"}
EOF

  local input='{"prompt":"/company run new-feature"}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/session-boot.sh" 2>&1)

  # "회고게이트" + "누락" 메시지가 있어야 함
  echo "$output" | grep -q "회고게이트" || return 1
  echo "$output" | grep -q "누락" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 11: 스킬 오버라이드 검증 — 존재하지 않는 에이전트 참조 -> 경고
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_skill_override_nonexistent_agent() {
  local tmpdir="$1"

  # skill-overrides.json에 존재하지 않는 에이전트 참조
  cat > "$HOME/.claude/company/skill-overrides.json" << 'EOF'
{
  "investigate": {
    "default_config": {"depth": "shallow"},
    "agent_overrides": {
      "nonexistent-agent": {"depth": "deep"},
      "backend-engineer": {"depth": "medium"}
    }
  }
}
EOF

  local output
  output=$(python3 "$HOME/.claude/hooks/integrity.py" "$HOME/.claude/company" overrides 2>&1)

  # "nonexistent-agent" 관련 경고가 있어야 함
  echo "$output" | grep -q "nonexistent-agent" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 12: 워크플로우에서 미등록 에이전트 참조 -> 에러
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_workflow_unregistered_agent() {
  local tmpdir="$1"
  local wf_file="$HOME/.claude/workflows/bad-workflow.yml"

  cat > "$wf_file" << 'EOF'
name: Bad Workflow
steps:
  - id: plan
    agent: product-manager
    prompt: Plan it

  - id: build
    agent: ghost-engineer
    depends_on: [plan]
    prompt: Build it
EOF

  local output
  output=$(python3 "$HOME/.claude/hooks/workflow-validate.py" "$wf_file" "$HOME/.claude/company/config.json" 2>&1)

  # "미등록" 에러가 있어야 함
  echo "$output" | grep -q "ghost-engineer" || return 1
  echo "$output" | grep -q "미등록" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 13: auto-retro — task_end 후 retro 없이 Bash 실행 -> 경고
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_auto_retro_reminder() {
  local tmpdir="$1"

  # task_end 있지만 retro_saved 없음
  cat > "$HOME/.claude/company/activity.jsonl" << 'EOF'
{"event":"task_end","task_id":"TASK-042","ts":"2026-04-10T14:00:00Z","source":"harness"}
EOF

  # /tmp/vc-retro-warned-$$ 파일이 없어야 함 (fresh session)
  rm -f "/tmp/vc-retro-warned-$$" 2>/dev/null

  local input='{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/auto-retro.sh" 2>&1)

  # "회고" 알림 메시지가 있어야 함
  echo "$output" | grep -q "회고" || return 1
  echo "$output" | grep -q "TASK-042" || return 1

  # 경고 파일 정리
  rm -f "/tmp/vc-retro-warned-$$" 2>/dev/null
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 14: ctx-compact-check — 60% 이상 -> 경고 출력
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_ctx_compact_warning() {
  local tmpdir="$1"

  # 세션 경고 파일 삭제 (fresh)
  rm -f "/tmp/vc-ctx-warned-${PPID}" 2>/dev/null

  local input='{"session":{"context_window":{"used_percentage":75}}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/ctx-compact-check.sh" 2>&1)

  # compact 제안 메시지가 있어야 함
  echo "$output" | grep -q "75%" || return 1
  echo "$output" | grep -q "compact" || return 1

  # 경고 파일 정리
  rm -f "/tmp/vc-ctx-warned-${PPID}" 2>/dev/null
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 15: ctx-compact-check — 40% 미만 -> 경고 없음
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_ctx_compact_no_warning() {
  local tmpdir="$1"

  rm -f "/tmp/vc-ctx-warned-${PPID}" 2>/dev/null

  local input='{"session":{"context_window":{"used_percentage":40}}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/ctx-compact-check.sh" 2>&1)

  # 출력이 비어있어야 함
  if [ -n "$output" ]; then
    return 1
  fi
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 16: integrity.py 전체 검증 통과 (정상 상태)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_integrity_full_pass() {
  local tmpdir="$1"

  local output
  output=$(python3 "$HOME/.claude/hooks/integrity.py" "$HOME/.claude/company" full 2>&1)

  # "오류:" 가 없어야 함
  if echo "$output" | grep -q "오류:"; then
    return 1
  fi
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 17: 파괴적 명령 감지 (agent-harness.sh)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_destructive_command_detection() {
  local tmpdir="$1"

  local input='{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD~5"}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-harness.sh" 2>&1)

  # "파괴적 명령 감지" 경고가 있어야 함
  echo "$output" | grep -q "파괴적 명령 감지" || return 1
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 테스트 18: agent-create-harness — 필수 플레이스홀더 누락 -> 검증 실패
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test_agent_create_missing_placeholder() {
  local tmpdir="$1"
  local agent_file="$HOME/.claude/agents/incomplete-agent.md"

  # frontmatter는 있지만 플레이스홀더 누락
  cat > "$agent_file" << 'EOF'
---
name: Incomplete Agent
description: Missing placeholders
category: qa
---
# Role
Just some content without required placeholders
EOF

  local input='{"tool_name":"Write","tool_input":{"file_path":"'"$agent_file"'"}}'
  local output
  output=$(echo "$input" | bash "$HOME/.claude/hooks/agent-create-harness.sh" 2>&1)

  # "검증 실패" + "플레이스홀더" 관련 에러가 있어야 함
  echo "$output" | grep -q "검증 실패" || return 1
  echo "$output" | grep -q "플레이스홀더" || return 1

  # config.json에 등록되지 않아야 함
  python3 -c "
import json
config = json.load(open('$HOME/.claude/company/config.json'))
assert 'incomplete-agent' not in config['agents'], 'incomplete-agent should not be registered'
"
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 실행
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN} make-company Harness Test Suite${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}[agent-create-harness.sh]${NC}"
run_test "유효한 에이전트 생성 -> config.json 자동 등록" test_agent_create_valid
run_test "frontmatter 없는 에이전트 -> 검증 실패" test_agent_create_invalid_no_frontmatter
run_test "필수 플레이스홀더 누락 -> 검증 실패" test_agent_create_missing_placeholder

echo ""
echo -e "${YELLOW}[agent-harness.sh]${NC}"
run_test "체크포인트 완전 -> 경고 없음" test_checkpoint_complete
run_test "체크포인트 누락 -> 경고 출력" test_checkpoint_missing
run_test "품질 게이트 미달 -> 경고 출력" test_quality_gate_fail
run_test "파괴적 명령 감지" test_destructive_command_detection

echo ""
echo -e "${YELLOW}[workflow-validate.py]${NC}"
run_test "유효한 워크플로우 -> 검증 통과" test_workflow_valid
run_test "순환 의존성 워크플로우 -> 에러 출력" test_workflow_cycle
run_test "미등록 에이전트 참조 -> 에러 출력" test_workflow_unregistered_agent

echo ""
echo -e "${YELLOW}[integrity.py]${NC}"
run_test "전체 정합성 검증 통과 (정상 상태)" test_integrity_full_pass
run_test "config.json 정합성 위반 -> 경고" test_config_integrity_violation
run_test "스킬 오버라이드 — 존재하지 않는 에이전트 참조 -> 경고" test_skill_override_nonexistent_agent

echo ""
echo -e "${YELLOW}[session-boot.sh]${NC}"
run_test "L4 패턴: pending-fix -> 부팅 시 강제 주입" test_l4_pending_fix_injection
run_test "회고 게이트: task_end 후 retro 없이 -> 경고" test_retro_gate_missing

echo ""
echo -e "${YELLOW}[auto-retro.sh]${NC}"
run_test "회고 누락 리마인더 출력" test_auto_retro_reminder

echo ""
echo -e "${YELLOW}[ctx-compact-check.sh]${NC}"
run_test "컨텍스트 60% 초과 -> compact 경고" test_ctx_compact_warning
run_test "컨텍스트 40% 미만 -> 경고 없음" test_ctx_compact_no_warning

# ── 요약 ──
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e " 결과: ${GREEN}${PASSED} PASS${NC} / ${RED}${FAILED} FAIL${NC} / ${TOTAL} TOTAL"

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED} 실패한 테스트:${FAILURES}${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
else
  echo -e " ${GREEN}All tests passed.${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
fi
