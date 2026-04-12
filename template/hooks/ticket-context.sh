#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ticket-context.sh — UserPromptSubmit 훅
#
# 모든 프롬프트 제출 시 현재 티켓 컨텍스트를 강제 주입.
# 시스템 우회를 방지하고 에이전트가 항상 티켓 맥락에서 작업하도록 강제.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# company 디렉토리 찾기
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

# 대시보드 서버가 돌고 있는지 빠르게 체크 (100ms 타임아웃)
DASH_PORT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$COMPANY_DIR/config.json" 2>/dev/null || echo 7777)
if ! curl -s --max-time 0.3 "http://localhost:${DASH_PORT}/api/token" >/dev/null 2>&1; then
  exit 0  # 서버 안 돌면 무시
fi

PROJECT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$COMPANY_DIR/config.json" 2>/dev/null)
[ -z "$PROJECT_ID" ] && exit 0

# 현재 in_progress + review 티켓 조회
_tickets_json=$(curl -s --max-time 1 "http://localhost:${DASH_PORT}/api/${PROJECT_ID}/tickets" 2>/dev/null || echo '{"tickets":[]}')

# 컨텍스트 생성
python3 -c "
import json, sys

try:
    data = json.loads(sys.argv[1])
    tickets = data.get('tickets', [])
except:
    sys.exit(0)

# config에서 WIP 제한 읽기
try:
    config = json.load(open(sys.argv[2]))
    wip_limit = config.get('wip_limits', {}).get('global', 3)
    wf_templates = config.get('workflow_templates', {})
except:
    wip_limit = 3
    wf_templates = {}

active = [t for t in tickets if t.get('status') in ('in_progress', 'review')]
backlog = [t for t in tickets if t.get('status') in ('backlog', 'todo')]

if active:
    print(f'[시스템] 현재 진행 중인 작업 ({len(active)}/{wip_limit}):')
    for t in active[:5]:
        tid = t.get('id', '?')
        ttype = t.get('type', '?')
        title = t.get('title', '')[:40]
        status = t.get('status', '?')
        assignee = t.get('assignee', '미정')
        goal = t.get('goal', '')

        # 워크플로 단계 정보
        wf = wf_templates.get(ttype, {})
        steps = wf.get('steps', [])
        completed = set(t.get('completed_steps', []))
        step_display = ''
        if steps:
            step_display = ' → '.join(
                f'[{s}]' if s == status else ('✓' + s if s in completed else s)
                for s in steps
            )

        line = f'  {tid} [{ttype}] {title}'
        if assignee != '미정':
            line += f' (@{assignee})'
        if goal:
            line += f' → {goal}'
        print(line)
        if step_display:
            print(f'    흐름: {step_display}')
elif backlog:
    print(f'[시스템] 대기 중인 티켓 {len(backlog)}개. 진행 중인 작업이 없습니다.')
    for t in backlog[:3]:
        print(f'  {t.get(\"id\",\"?\")} [{t.get(\"priority\",\"?\")}] {t.get(\"title\",\"\")[:40]}')
else:
    print('[시스템] 등록된 티켓이 없습니다. 작업 시작 전 티켓을 생성하세요.')
    print('  → 대시보드: http://localhost:' + str(sys.argv[3]) + ' (Tickets 탭)')
    print('  → CLI: bash .claude/company/kickoff.sh')
" "$_tickets_json" "$COMPANY_DIR/config.json" "$DASH_PORT" 2>/dev/null

exit 0
