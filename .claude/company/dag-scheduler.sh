#!/usr/bin/env bash
# DAG 스케줄러 데몬 — workflow 의존성 기반 노드 자동 실행
# 모든 노드의 depends_on이 done이고 자기는 pending인 노드를 활성화

COMPANY_DIR="$(cd "$(dirname "$0")" && pwd)"
WF_DIR="$COMPANY_DIR/state/workflows"
INBOX_DIR="$COMPANY_DIR/inbox"
ARTIFACTS_DIR="$COMPANY_DIR/artifacts"
LOG="$COMPANY_DIR/logs/dag-scheduler.log"

mkdir -p "$WF_DIR" "$ARTIFACTS_DIR" "$COMPANY_DIR/logs"

log() {
  local ts
  ts=$(date '+%H:%M:%S')
  echo "[$ts] $*" | tee -a "$LOG"
}

# atomic lock (router/agents와 동일 패턴)
acquire_lock() {
  local lockdir="$1.lock.d"
  local waited=0
  while ! mkdir "$lockdir" 2>/dev/null; do
    sleep 0.1
    waited=$((waited + 1))
    [ $waited -gt 50 ] && return 1
  done
  return 0
}
release_lock() { rmdir "$1.lock.d" 2>/dev/null; }

# SIGHUP 수신 시 즉시 워크플로 재스캔 (대시보드에서 새 워크플로 등록 시)
SIGHUP_RECEIVED=false
trap 'SIGHUP_RECEIVED=true; log "  SIGHUP 수신 → 즉시 재스캔"' HUP

log "DAG 스케줄러 시작 (workflows: $WF_DIR)"

while true; do
  for wf in "$WF_DIR"/*.json; do
    [ -f "$wf" ] || continue

    # 실행 가능한 노드 찾기 (depends_on 모두 done, 자기 pending)
    _ready=$(python3 -c "
import json, sys
try:
  with open(sys.argv[1]) as f:
    wf = json.load(f)
  done_ids = {n['id'] for n in wf['nodes'] if n.get('status') == 'done'}
  for n in wf['nodes']:
    if n.get('status') == 'pending':
      deps = n.get('depends_on', [])
      if all(d in done_ids for d in deps):
        # input_template 변수 치환
        tmpl = n.get('input_template', '')
        # {{user_request}} 치환
        ur = wf.get('user_request', '')
        tmpl = tmpl.replace('{{user_request}}', ur)
        # {{node_id.output_artifact}} 치환
        for dn in wf['nodes']:
          if dn.get('output_artifact'):
            tmpl = tmpl.replace('{{' + dn['id'] + '.output_artifact}}', dn['output_artifact'])
            tmpl = tmpl.replace('{{' + dn['id'] + '.output}}', dn['output_artifact'])
        # 한 줄로 출력: id|agent|input
        print(f\"{n['id']}|{n['agent']}|{tmpl}\")
except Exception as e:
  print(f'ERROR: {e}', file=sys.stderr)
" "$wf" 2>/dev/null)

    if [ -z "$_ready" ]; then continue; fi

    _wf_id=$(basename "$wf" .json)

    while IFS='|' read -r _node_id _agent _input; do
      [ -z "$_node_id" ] && continue
      [ -z "$_agent" ] && continue

      # 노드 status를 running으로 변경
      python3 -c "
import json, sys
with open(sys.argv[1]) as f:
  wf = json.load(f)
for n in wf['nodes']:
  if n['id'] == sys.argv[2]:
    n['status'] = 'running'
    n['started_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
    break
with open(sys.argv[1], 'w') as f:
  json.dump(wf, f, indent=2, ensure_ascii=False)
" "$wf" "$_node_id"

      # 에이전트 inbox에 DAG-NODE 메시지 추가
      _inbox="$INBOX_DIR/${_agent}.md"
      if acquire_lock "$_inbox"; then
        printf '\n[DAG-NODE wf:%s node:%s time:%s]\n%s\n' \
          "$_wf_id" "$_node_id" "$(date '+%H:%M:%S')" "$_input" >> "$_inbox"
        release_lock "$_inbox"
        log "  실행: wf=$_wf_id node=$_node_id agent=$_agent"
      else
        log "  실패: $_agent inbox 락 획득 타임아웃 (wf=$_wf_id node=$_node_id)"
      fi
    done <<< "$_ready"
  done
  sleep 2
done
