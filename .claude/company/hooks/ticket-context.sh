#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ticket-context.sh — UserPromptSubmit 훅
#
# 프롬프트 제출 시 현재 에이전트에 관련된 티켓 컨텍스트를 주입.
# 역할 기반 필터링: 본인 담당 → 팀 담당 → 나머지 요약 카운트.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT=$(cat)

# company 디렉토리 찾기
COMPANY_DIR=""
for candidate in "$HOME/.claude/company" ".claude/company"; do
  [ -d "$candidate" ] && [ -f "$candidate/config.json" ] && COMPANY_DIR="$candidate" && break
done
[ -z "$COMPANY_DIR" ] && exit 0

# 대시보드 서버가 돌고 있는지 빠르게 체크 (300ms 타임아웃)
DASH_PORT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('dashboard_port',7777))" "$COMPANY_DIR/config.json" 2>/dev/null || echo 7777)
if ! curl -s --max-time 0.3 "http://localhost:${DASH_PORT}/api/token" >/dev/null 2>&1; then
  exit 0  # 서버 안 돌면 무시
fi

PROJECT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project',''))" "$COMPANY_DIR/config.json" 2>/dev/null)
[ -z "$PROJECT_ID" ] && exit 0

# 현재 에이전트 ID 감지
CURRENT_AGENT="${CLAUDE_AGENT_ID:-${AGENT_ID:-}}"

# 현재 in_progress + review 티켓 조회 (agent 파라미터로 서버 측 visibility 필터링)
_ticket_url="http://localhost:${DASH_PORT}/api/${PROJECT_ID}/tickets"
if [ -n "$CURRENT_AGENT" ]; then
  _ticket_url="${_ticket_url}?agent=${CURRENT_AGENT}"
fi
_tickets_json=$(curl -s --max-time 1 "$_ticket_url" 2>/dev/null || echo '{"tickets":[]}')

# 역할 기반 필터링 + 컨텍스트 생성
python3 -c "
import json, sys

try:
    data = json.loads(sys.argv[1])
    tickets = data.get('tickets', [])
except:
    sys.exit(0)

# config에서 WIP 제한 + 에이전트 팀 정보 읽기
try:
    config = json.load(open(sys.argv[2]))
    wip_limit = config.get('wip_limits', {})
    wip_global = wip_limit.get('global', 3)
    wip_per_agent = wip_limit.get('per_agent', 1)
    wip_per_team = wip_limit.get('per_team', 2)
    wf_templates = config.get('workflow_templates', {})
    agents_cfg = config.get('agents', [])
except:
    wip_global = 3
    wip_per_agent = 1
    wip_per_team = 2
    wf_templates = {}
    agents_cfg = []

agent_id = sys.argv[3] if len(sys.argv) > 3 else ''

# 에이전트 팀 조회
agent_team = ''
team_members = set()
if agent_id:
    for a in agents_cfg:
        if a.get('id') == agent_id:
            agent_team = a.get('team', '') or ''
            break
    if agent_team:
        for a in agents_cfg:
            if (a.get('team', '') or '') == agent_team:
                team_members.add(a.get('id', ''))

active = [t for t in tickets if t.get('status') in ('in_progress', 'review')]
backlog = [t for t in tickets if t.get('status') in ('backlog', 'todo')]

if not active and not backlog:
    print('[시스템] 등록된 티켓이 없습니다. 작업 시작 전 티켓을 생성하세요.')
    print('  -> 대시보드: http://localhost:' + str(sys.argv[4]) + ' (Tickets 탭)')
    print('  -> CLI: bash .claude/company/kickoff.sh')
    sys.exit(0)

if not active and backlog:
    print('[시스템] 대기 중인 티켓 ' + str(len(backlog)) + '개. 진행 중인 작업이 없습니다.')
    for t in backlog[:3]:
        print('  ' + t.get('id', '?') + ' [' + t.get('priority', '?') + '] ' + t.get('title', '')[:40])
    sys.exit(0)

# 역할 기반 분류
my_tickets = []
team_tickets = []
other_tickets = []

for t in active:
    assignee = t.get('assignee', '')
    if agent_id and assignee == agent_id:
        my_tickets.append(t)
    elif agent_team and assignee in team_members:
        team_tickets.append(t)
    else:
        other_tickets.append(t)

# 에이전트 ID 없으면 폴백: 전체 요약만 (기존 호환)
if not agent_id:
    print('[시스템] 현재 진행 중인 작업 (' + str(len(active)) + '/' + str(wip_global) + '):')
    for t in active[:5]:
        tid = t.get('id', '?')
        ttype = t.get('type', '?')
        title = t.get('title', '')[:40]
        assignee = t.get('assignee', '미정')
        line = '  ' + tid + ' [' + ttype + '] ' + title
        if assignee != '미정' and assignee:
            line += ' (@' + assignee + ')'
        print(line)
    if len(active) > 5:
        print('  ... 외 ' + str(len(active) - 5) + '개')
    sys.exit(0)

def render_ticket(t, show_workflow=True):
    # 티켓 한 줄 렌더링
    tid = t.get('id', '?')
    ttype = t.get('type', '?')
    title = t.get('title', '')[:40]
    status = t.get('status', '?')
    assignee = t.get('assignee', '미정')
    goal = t.get('goal', '')

    line = '  ' + tid + ' [' + ttype + '] ' + title
    if assignee and assignee != '미정':
        line += ' (@' + assignee + ')'
    if goal:
        line += ' -> ' + goal
    print(line)

    if show_workflow:
        wf = wf_templates.get(ttype, {})
        steps = wf.get('steps', [])
        completed = set(t.get('completed_steps', []))
        if steps:
            parts = []
            for s in steps:
                if s == status:
                    parts.append('[' + s + ']')
                elif s in completed:
                    parts.append('v' + s)
                else:
                    parts.append(s)
            print('    흐름: ' + ' -> '.join(parts))

    # force_transition 감지: activity에서 force_transition 이벤트 확인
    for act in t.get('activity', []):
        if act.get('action') == 'force_transition':
            ft_agent = act.get('agent', '?')
            ft_reason = act.get('reason', '')
            ft_from = act.get('from', '?')
            ft_to = act.get('to', '?')
            ft_skipped = act.get('skipped_steps', [])
            msg = '    [주의] 이 티켓은 워크플로를 건너뛰었습니다 (by: ' + ft_agent + ', 사유: ' + ft_reason + ')'
            if ft_skipped:
                msg += ' [건너뛴 단계: ' + ', '.join(ft_skipped) + ']'
            print(msg)

# 내 WIP 카운트
my_wip = len(my_tickets)
team_wip = len(my_tickets) + len(team_tickets)

# 내 담당 티켓
if my_tickets:
    print('[시스템] 내 작업 (' + str(my_wip) + '/' + str(wip_per_agent) + '):')
    for t in my_tickets:
        render_ticket(t, show_workflow=True)

# 팀 티켓 (워크플로 생략)
if team_tickets:
    team_label = agent_team or '팀'
    print('[시스템] ' + team_label + ' 팀 작업 (' + str(team_wip) + '/' + str(wip_per_team) + '):')
    for t in team_tickets[:3]:
        render_ticket(t, show_workflow=False)
    if len(team_tickets) > 3:
        print('  ... 외 ' + str(len(team_tickets) - 3) + '개')

# 나머지 요약 카운트
if other_tickets:
    print('[시스템] + ' + str(len(other_tickets)) + '개 다른 팀 진행 중')

# WIP 경고 (단계별)
all_active = len(active)
if wip_global > 0 and all_active >= wip_global:
    print('[WIP] ' + chr(0x1F6AB) + ' WIP 초과: ' + str(all_active) + '/' + str(wip_global) + ' -- 새 작업을 시작할 수 없습니다')
elif wip_global > 0 and all_active >= int(wip_global * 0.8):
    print('[WIP] ' + chr(0x26A0) + chr(0xFE0F) + ' WIP 경고: ' + str(all_active) + '/' + str(wip_global) + ' -- 현재 작업 완료 후 새 작업 시작을 권장합니다')
if my_wip > wip_per_agent:
    print('[경고] 개인 WIP ' + str(my_wip) + '/' + str(wip_per_agent) + ' (한도 초과)')
elif wip_per_agent > 0 and my_wip >= max(1, int(wip_per_agent * 0.8)):
    print('[WIP] 개인 WIP ' + str(my_wip) + '/' + str(wip_per_agent) + ' -- 한도에 근접')

# 스킬 강제 모드 표시
skill_enforcement = config.get('skill_enforcement', 'advisory')
step_skills_cfg = config.get('step_skills', {})
if skill_enforcement == 'strict' and step_skills_cfg:
    print('[스킬] strict 모드: 필수 스킬을 모두 사용해야 다음 단계로 진행 가능')
    # 내 담당 티켓의 현재 단계 필수 스킬 표시
    for t in my_tickets:
        ttype = t.get('type', 'feature')
        status = t.get('status', '')
        req_skills = step_skills_cfg.get(ttype, {}).get(status, [])
        if req_skills:
            print('  ' + t.get('id', '?') + ' [' + status + '] 필수: ' + ', '.join('/' + s for s in req_skills))
" "$_tickets_json" "$COMPANY_DIR/config.json" "$CURRENT_AGENT" "$DASH_PORT" 2>/dev/null

# ━━━ L4: pending-skill 차단 메시지 주입 ━━━
for _pfile in /tmp/vc-pending-skill-*; do
  [ -f "$_pfile" ] || continue
  _pcontent=$(cat "$_pfile" 2>/dev/null)
  if [ -n "$_pcontent" ]; then
    echo "$_pcontent"
    rm -f "$_pfile" 2>/dev/null
  fi
done

# ━━━ 목표 컨텍스트 표시 ━━━
# 내 담당 티켓에서 goal ID 추출 후 목표 정보 조회
_goal_ids=$(python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    tickets = data.get('tickets', [])
except:
    sys.exit(0)
agent_id = sys.argv[2] if len(sys.argv) > 2 else ''
seen = set()
has_ticket = False
for t in tickets:
    if t.get('status') not in ('in_progress', 'review'):
        continue
    if agent_id and t.get('assignee') != agent_id:
        continue
    has_ticket = True
    g = t.get('goal', '')
    if g and g not in seen:
        seen.add(g)
        print(g)
    elif not g:
        print('__NO_GOAL__:' + t.get('id', '?'))
if not has_ticket:
    sys.exit(0)
" "$_tickets_json" "$CURRENT_AGENT" 2>/dev/null)

if [ -n "$_goal_ids" ]; then
  _printed_header=""
  echo "$_goal_ids" | while IFS= read -r _gline; do
    case "$_gline" in
      __NO_GOAL__:*)
        _tid="${_gline#__NO_GOAL__:}"
        echo "[목표] $_tid: 이 티켓은 목표에 연결되지 않았습니다"
        ;;
      GOAL-*)
        _goal_json=$(curl -s --max-time 0.5 "http://localhost:${DASH_PORT}/api/${PROJECT_ID}/goals/${_gline}" 2>/dev/null)
        if [ -n "$_goal_json" ]; then
          python3 -c "
import json, sys
try:
    g = json.loads(sys.argv[1])
    if 'error' in g:
        print('[목표] ' + sys.argv[2] + ': 목표를 찾을 수 없습니다')
    else:
        title = g.get('title', '?')
        mission = g.get('mission', '')
        status = g.get('status', '?')
        if mission:
            print('[목표] ' + sys.argv[2] + ': ' + title + ' -- ' + mission)
        else:
            print('[목표] ' + sys.argv[2] + ': ' + title)
except:
    print('[목표] ' + sys.argv[2] + ': 목표 정보 조회 실패')
" "$_goal_json" "$_gline" 2>/dev/null
        fi
        ;;
    esac
  done
fi

exit 0
