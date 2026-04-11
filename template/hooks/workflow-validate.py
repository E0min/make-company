#!/usr/bin/env python3
"""워크플로우 YAML 검증 스크립트 (workflow-harness.sh에서 호출)"""
import json, sys, os, re

wf_path = sys.argv[1] if len(sys.argv) > 1 else ''
config_path = sys.argv[2] if len(sys.argv) > 2 else ''

if not wf_path or not os.path.exists(wf_path):
    sys.exit(0)

# config 읽기
config = {}
if config_path and os.path.exists(config_path):
    with open(config_path) as f:
        config = json.load(f)

registered_agents = set(config.get('agents', []))
role_map = config.get('agent_role_map', {})

# 워크플로우 파일 읽기
with open(wf_path) as f:
    content = f.read()

# steps 파싱
steps = []
current_step = None
for line in content.split('\n'):
    stripped = line.strip()
    if stripped.startswith('- id:'):
        if current_step and 'agent' in current_step:
            steps.append(current_step)
        current_step = {'id': stripped.split(':', 1)[1].strip()}
    elif current_step and stripped.startswith('agent:'):
        current_step['agent'] = stripped.split(':', 1)[1].strip()
    elif current_step and stripped.startswith('depends_on:'):
        deps_str = stripped.split(':', 1)[1].strip()
        deps = [d.strip().strip('"').strip("'") for d in deps_str.strip('[]').split(',')]
        current_step['depends_on'] = [d for d in deps if d]

if current_step and 'agent' in current_step:
    steps.append(current_step)

if not steps:
    sys.exit(0)

errors = []
warnings = []
wf_name = os.path.basename(wf_path).replace('.yml', '').replace('.yaml', '')

# 검증 1: 등록되지 않은 에이전트
for step in steps:
    agent = step.get('agent', '')
    if agent and agent not in registered_agents:
        errors.append(f'스텝 "{step["id"]}"의 에이전트 "{agent}"가 config.json에 미등록')

# 검증 2: 의존성 유효성
step_ids = {s['id'] for s in steps}
for step in steps:
    for dep in step.get('depends_on', []):
        if dep not in step_ids:
            errors.append(f'스텝 "{step["id"]}"이 존재하지 않는 "{dep}"에 의존')

# 검증 3: 순환 의존성
adj = {s['id']: s.get('depends_on', []) for s in steps}
visited = set()
rec_stack = set()
has_cycle = False

def dfs(node):
    global has_cycle
    visited.add(node)
    rec_stack.add(node)
    for dep in adj.get(node, []):
        if dep not in visited:
            dfs(dep)
        elif dep in rec_stack:
            has_cycle = True
    rec_stack.discard(node)

for node in adj:
    if node not in visited:
        dfs(node)
if has_cycle:
    errors.append('순환 의존성 감지')

# 검증 4: 역할 순서
step_roles = [(s['id'], s.get('agent', ''), role_map.get(s.get('agent', ''), '_default')) for s in steps]
engineer_seen = False
for sid, agent, role in step_roles:
    if role == 'engineer':
        engineer_seen = True
    if role == 'qa' and not engineer_seen:
        warnings.append(f'QA 스텝 "{sid}"이 엔지니어 전에 실행됨')

# 검증 5: QA 누락
has_engineer = any(r == 'engineer' for _, _, r in step_roles)
has_qa = any(r == 'qa' for _, _, r in step_roles)
if has_engineer and not has_qa:
    warnings.append('엔지니어 스텝 있지만 QA 스텝 없음 — 품질 검증 누락 위험')

# 결과 출력
for e in errors:
    print(f'[하네스:워크플로우] {wf_name} 오류: {e}')
for w in warnings:
    print(f'[하네스:워크플로우] {wf_name} 경고: {w}')

if not errors and not warnings:
    parts = [f'{s["id"]}[{s.get("agent","?")}]' for s in steps]
    print(f'[하네스:워크플로우] {wf_name} 검증 통과: {" -> ".join(parts)}')

# 핸드오프 맵
handoffs = []
for step in steps:
    for dep in step.get('depends_on', []):
        dep_step = next((s for s in steps if s['id'] == dep), None)
        if dep_step:
            handoffs.append((dep_step.get('agent', ''), dep, step.get('agent', ''), step['id']))

if handoffs:
    print(f'[하네스:워크플로우] 핸드오프 맵:')
    for from_a, from_s, to_a, to_s in handoffs:
        print(f'  {from_a} ({from_s}) -> {to_a} ({to_s})')
