#!/usr/bin/env python3
"""
Virtual Company Dashboard Server (의존성 0)
- Python 표준 라이브러리만 사용
- localhost:7777 (기본)
- CSRF: dashboard_token.txt + X-Token 헤더
- Atomic mkdir lock (Bash와 호환)
"""
import os, sys, json, time, uuid, subprocess, signal, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# 작업 큐 직렬화: 모든 config.json 쓰기는 이 락으로 직렬화
CONFIG_LOCK = threading.Lock()

COMPANY_DIR = os.path.dirname(os.path.abspath(__file__)).rsplit('/dashboard', 1)[0]
DASHBOARD_DIR = os.path.join(COMPANY_DIR, 'dashboard')
NEXT_OUT_DIR = os.path.join(COMPANY_DIR, 'dashboard-next', 'out')
USE_NEXT = os.path.isfile(os.path.join(NEXT_OUT_DIR, 'index.html'))
CONFIG_PATH = os.path.join(COMPANY_DIR, 'config.json')
STATE_DIR = os.path.join(COMPANY_DIR, 'state')
INBOX_DIR = os.path.join(COMPANY_DIR, 'inbox')
OUTBOX_DIR = os.path.join(COMPANY_DIR, 'outbox')
CHANNEL = os.path.join(COMPANY_DIR, 'channel/general.md')
TOKEN_PATH = os.path.join(STATE_DIR, 'dashboard_token.txt')

# ━━━ Atomic Lock (Bash와 호환) ━━━
def acquire_lock(path, timeout=5.0):
    lockdir = path + ".lock.d"
    waited = 0.0
    while waited < timeout:
        try:
            os.mkdir(lockdir)
            return True
        except FileExistsError:
            time.sleep(0.1)
            waited += 0.1
    return False

def release_lock(path):
    try:
        os.rmdir(path + ".lock.d")
    except OSError:
        pass

def atomic_write_json(path, data):
    """tmp → mv 패턴으로 atomic write"""
    if not acquire_lock(path):
        return False
    try:
        tmp = path + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.rename(tmp, path)
        return True
    finally:
        release_lock(path)

def get_config_etag():
    """config.json의 mtime을 ETag로 사용 (정수 초)"""
    if not os.path.exists(CONFIG_PATH):
        return "0"
    return str(int(os.path.getmtime(CONFIG_PATH)))

def signal_reload():
    """router.sh와 dag-scheduler.sh에 SIGHUP 전송 → 즉시 config 재로드"""
    try:
        # pgrep 패턴으로 프로세스 찾기
        for script in ['router.sh', 'dag-scheduler.sh']:
            r = subprocess.run(['pgrep', '-f', f'{COMPANY_DIR}/{script}'],
                               capture_output=True, text=True)
            for pid in r.stdout.strip().split('\n'):
                if pid:
                    try:
                        os.kill(int(pid), signal.SIGHUP)
                    except (ProcessLookupError, ValueError):
                        pass
    except Exception:
        pass

# ━━━ Token (CSRF) ━━━
def get_or_create_token():
    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH) as f:
            return f.read().strip()
    token = uuid.uuid4().hex
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(TOKEN_PATH, 'w') as f:
        f.write(token)
    os.chmod(TOKEN_PATH, 0o600)
    return token

DASHBOARD_TOKEN = get_or_create_token()

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json',
}

# ━━━ Data readers ━━━
def read_state():
    """모든 에이전트 상태 + heartbeat + cost"""
    if not os.path.exists(CONFIG_PATH):
        return {"error": "config.json not found"}
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    agents = []
    now = int(time.time())
    cost_data = {}
    cost_path = os.path.join(STATE_DIR, 'cost.json')
    if os.path.exists(cost_path):
        try:
            with open(cost_path) as f:
                cost_data = json.load(f)
        except: pass
    for a in config.get('agents', []):
        aid = a['id']
        state_file = os.path.join(STATE_DIR, f"{aid}.state")
        hb_file = os.path.join(STATE_DIR, f"{aid}.heartbeat")
        state, ts = "unknown", 0
        if os.path.exists(state_file):
            try:
                parts = open(state_file).read().strip().split()
                state = parts[0] if parts else "unknown"
                ts = int(parts[1]) if len(parts) > 1 else 0
            except: pass
        hb, hb_age = None, None
        if os.path.exists(hb_file):
            try:
                hb = int(open(hb_file).read().strip())
                hb_age = now - hb
                if hb_age > 30 and state not in ('stopped', 'paused', 'permanently-failed'):
                    state = "dead"
            except: pass
        # inbox 크기
        inbox_size = 0
        ibf = os.path.join(INBOX_DIR, f"{aid}.md")
        if os.path.exists(ibf):
            inbox_size = os.path.getsize(ibf)
        # 비용
        agent_cost = cost_data.get(aid, {})
        agents.append({
            "id": aid,
            "label": a.get('label', aid),
            "engine": a.get('engine', 'claude'),
            "agent_file": a.get('agent_file', aid),
            "protected": a.get('protected', False),
            "assigned_skills": a.get('assigned_skills', []),
            "state": state,
            "state_ts": ts,
            "elapsed": now - ts if ts else 0,
            "heartbeat_age": hb_age,
            "inbox_size": inbox_size,
            "tokens": agent_cost.get('tokens', 0),
            "messages": agent_cost.get('messages', 0),
        })
    return {
        "project": config.get('project', 'Company'),
        "session_name": config.get('session_name', ''),
        "now": now,
        "agents": agents,
        "cost_limit": config.get('cost_limit_tokens', 200000),
        "total_tokens": sum(a['tokens'] for a in agents),
    }

def read_channel(lines=30):
    if not os.path.exists(CHANNEL):
        return {"lines": []}
    try:
        with open(CHANNEL) as f:
            all_lines = f.readlines()
        return {"lines": [l.rstrip() for l in all_lines[-lines:]]}
    except: return {"lines": []}

def read_workflows():
    """state/workflows/ 활성 + workflows/ 템플릿"""
    active, templates = [], []
    wf_state_dir = os.path.join(STATE_DIR, 'workflows')
    wf_template_dir = os.path.join(COMPANY_DIR, 'workflows')
    if os.path.isdir(wf_state_dir):
        for f in sorted(os.listdir(wf_state_dir)):
            if f.endswith('.json'):
                try:
                    with open(os.path.join(wf_state_dir, f)) as fh:
                        active.append(json.load(fh))
                except: pass
    if os.path.isdir(wf_template_dir):
        for f in sorted(os.listdir(wf_template_dir)):
            if f.endswith('.json'):
                try:
                    with open(os.path.join(wf_template_dir, f)) as fh:
                        wf = json.load(fh)
                        templates.append({"file": f, "id": wf.get('workflow_id'), "title": wf.get('title')})
                except: pass
    return {"active": active, "templates": templates}

def read_tasks(limit=10):
    tasks_dir = os.path.join(STATE_DIR, 'tasks')
    if not os.path.isdir(tasks_dir):
        return {"tasks": []}
    files = sorted(
        [os.path.join(tasks_dir, f) for f in os.listdir(tasks_dir) if f.endswith('.json')],
        key=os.path.getmtime, reverse=True
    )[:limit]
    tasks = []
    for f in files:
        try:
            with open(f) as fh:
                tasks.append(json.load(fh))
        except: pass
    return {"tasks": tasks}

def read_knowledge():
    idx = os.path.join(COMPANY_DIR, 'knowledge/INDEX.md')
    if not os.path.exists(idx):
        return {"index": ""}
    return {"index": open(idx).read()}

def read_skills():
    """skill-index.json에서 사용 가능한 스킬 목록"""
    si = os.path.join(COMPANY_DIR, 'skill-index.json')
    if not os.path.exists(si):
        return {"skills": []}
    try:
        with open(si) as f:
            data = json.load(f)
        return {"skills": [{"name": s.get('name'), "desc": s.get('desc', '')[:60]} for s in data]}
    except: return {"skills": []}

def parse_md_frontmatter(text):
    """간단한 frontmatter 파서"""
    if not text.startswith('---'):
        return {}
    end = text.find('---', 3)
    if end == -1:
        return {}
    fm_text = text[3:end].strip()
    meta = {}
    for line in fm_text.split('\n'):
        if ':' in line and not line.startswith(' '):
            k, _, v = line.partition(':')
            meta[k.strip()] = v.strip()
    return meta

def read_library():
    """agents-library/ 에이전트 카탈로그"""
    lib_dir = os.path.join(COMPANY_DIR, 'agents-library')
    if not os.path.isdir(lib_dir):
        return {"library": [], "categories": []}
    items = []
    cats = set()
    for category in sorted(os.listdir(lib_dir)):
        catdir = os.path.join(lib_dir, category)
        if not os.path.isdir(catdir):
            continue
        cats.add(category)
        for fname in sorted(os.listdir(catdir)):
            if not fname.endswith('.md'):
                continue
            path = os.path.join(catdir, fname)
            try:
                with open(path) as f:
                    text = f.read()
                meta = parse_md_frontmatter(text)
                items.append({
                    "library_path": f"{category}/{fname[:-3]}",
                    "category": category,
                    "name": meta.get('name', fname[:-3]),
                    "default_label": meta.get('default_label', ''),
                    "description": meta.get('description', ''),
                    "default_skills": meta.get('default_skills', '[]'),
                })
            except: pass
    return {"library": items, "categories": sorted(cats)}

def read_presets():
    """presets/*.json 목록"""
    pdir = os.path.join(COMPANY_DIR, 'presets')
    if not os.path.isdir(pdir):
        return {"presets": []}
    items = []
    for fname in sorted(os.listdir(pdir)):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(pdir, fname)) as f:
                p = json.load(f)
            items.append({
                "id": p.get('id'),
                "name": p.get('name'),
                "icon": p.get('icon', '🏢'),
                "description": p.get('description', ''),
                "agent_count": len(p.get('agents', [])),
            })
        except: pass
    return {"presets": items}

def add_agent_from_library(library_path, custom_id=None, custom_label=None, if_match=None):
    """라이브러리에서 에이전트를 가져와 활성화"""
    lib_file = os.path.join(COMPANY_DIR, 'agents-library', f"{library_path}.md")
    if not os.path.exists(lib_file):
        return False, f"library not found: {library_path}"

    with open(lib_file) as f:
        md_text = f.read()
    meta = parse_md_frontmatter(md_text)

    aid = (custom_id or library_path.split('/')[-1]).strip().lower()
    label = custom_label or meta.get('default_label') or aid
    engine = 'gemini' if library_path == 'external/gemini' else 'claude'

    # default_skills 파싱
    import re
    skills_str = meta.get('default_skills', '[]').strip()
    skills = []
    m = re.match(r'^\[(.*)\]$', skills_str)
    if m:
        skills = [s.strip() for s in m.group(1).split(',') if s.strip()]

    # create_agent 호출 (재사용)
    body = {
        "id": aid,
        "label": label,
        "engine": engine,
        "agent_file": aid,
        "description": meta.get('description', ''),
        "role_body": "",
        "skills": skills,
    }
    # role body는 라이브러리 .md를 그대로 사용
    ok, result = create_agent(body, if_match)
    if not ok:
        return ok, result

    # 라이브러리 .md를 .claude/agents/{aid}.md로 덮어쓰기 (frontmatter 제외, 본문만)
    claude_dir = os.path.dirname(COMPANY_DIR)
    md_path = os.path.join(claude_dir, 'agents', f"{aid}.md")
    try:
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(md_text)
    except: pass

    return True, result

def export_current_as_preset(preset_id, name, description, icon='🏢'):
    """현재 config의 에이전트를 프리셋 JSON으로 export"""
    if not os.path.exists(CONFIG_PATH):
        return False, "config not found"
    with open(CONFIG_PATH) as f:
        config = json.load(f)

    # 라이브러리에서 역매핑 (agent_file 기반)
    lib_dir = os.path.join(COMPANY_DIR, 'agents-library')
    file_to_path = {}
    if os.path.isdir(lib_dir):
        for cat in os.listdir(lib_dir):
            catdir = os.path.join(lib_dir, cat)
            if not os.path.isdir(catdir): continue
            for f in os.listdir(catdir):
                if f.endswith('.md'):
                    file_to_path[f[:-3]] = f"{cat}/{f[:-3]}"

    agents = []
    for a in config.get('agents', []):
        af = a.get('agent_file', a['id'])
        # 라이브러리에서 매칭, 없으면 leadership/ceo로 fallback
        lib_path = file_to_path.get(af, file_to_path.get(a['id'], 'leadership/ceo'))
        agents.append({
            "library_path": lib_path,
            "id": a['id'],
            "label": a.get('label', a['id']),
            "protected": a.get('protected', False),
            **({"engine": "gemini"} if a.get('engine') == 'gemini' else {}),
        })

    preset = {
        "id": preset_id,
        "name": name,
        "description": description,
        "icon": icon,
        "agents": agents,
    }

    out_path = os.path.join(COMPANY_DIR, 'presets', f"{preset_id}.json")
    if not acquire_lock(out_path):
        return False, "lock timeout"
    try:
        tmp = out_path + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(preset, f, ensure_ascii=False, indent=2)
        os.rename(tmp, out_path)
    finally:
        release_lock(out_path)

    return True, {"file": f"{preset_id}.json", "preset": preset}

# ━━━ Mutations (POST) ━━━
RESERVED_AGENT_IDS = {'human', 'system', 'router', 'monitor', 'dashboard', 'admin', 'orch'}

def create_agent(body, if_match=None):
    """body: {id, label, engine, agent_file, description, role_body, skills}"""
    aid = body.get('id', '').strip().lower()
    if not aid or not aid.replace('-', '').replace('_', '').isalnum():
        return False, "invalid id (영문/숫자/-/_ 만 허용)"
    if aid in RESERVED_AGENT_IDS:
        return False, f"reserved id: {aid}"
    if len(aid) < 2 or len(aid) > 30:
        return False, "id length must be 2-30"
    label = body.get('label', aid)
    engine = body.get('engine', 'claude')
    if engine not in ('claude', 'gemini'):
        return False, "engine must be claude or gemini"
    agent_file = body.get('agent_file', aid)
    description = body.get('description', f'{label} 에이전트')
    role_body = body.get('role_body', f'당신은 {label} 에이전트입니다.')
    skills = body.get('skills', [])

    # 1. config.json에 추가 (작업 큐 직렬화 + 파일 락 + ETag 검증)
    with CONFIG_LOCK:
        # ETag 검증 (Lost Update 방지)
        if if_match is not None and if_match != get_config_etag():
            return False, "conflict_409"
        if not acquire_lock(CONFIG_PATH):
            return False, "config lock timeout"
        try:
            with open(CONFIG_PATH) as f:
                config = json.load(f)
            if any(a['id'] == aid for a in config.get('agents', [])):
                return False, "agent id already exists"
            new_agent = {
                "id": aid, "engine": engine, "agent_file": agent_file,
                "label": label, "assigned_skills": skills, "protected": False
            }
            config.setdefault('agents', []).append(new_agent)
            tmp = CONFIG_PATH + ".tmp"
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            os.rename(tmp, CONFIG_PATH)
        finally:
            release_lock(CONFIG_PATH)

    # 2. .claude/agents/{agent_file}.md 생성 (Claude Code 에이전트 정의)
    # COMPANY_DIR = .../.claude/company → 부모가 .claude
    claude_dir = os.path.dirname(COMPANY_DIR)
    agents_md_dir = os.path.join(claude_dir, 'agents')
    os.makedirs(agents_md_dir, exist_ok=True)
    md_path = os.path.join(agents_md_dir, f"{agent_file}.md")
    skills_str = ', '.join(skills) if skills else ''
    md_content = f"""---
name: {label}
description: {description}
recommended-skills: [{skills_str}]
---

당신은 지금 tmux 세션 안에서 실행 중인 {label} 에이전트입니다.
당신에게 오는 메시지는 라우터를 통해 자동 전달된 것입니다.
응답에 @에이전트ID를 쓰면 해당 팀원에게 자동 전달됩니다.

## 역할

{role_body}

## 행동 규칙

- 응답은 간결하게 작성합니다
- 다른 팀원과 협업이 필요하면 @멘션을 사용합니다
"""
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

    # 3. tmux 새 윈도우 + 에이전트 시작 (선택 — 회사가 가동 중일 때만)
    session_name = config.get('session_name', '')
    if session_name:
        try:
            # tmux 세션 존재 확인
            r = subprocess.run(['tmux', 'has-session', '-t', session_name],
                               capture_output=True)
            if r.returncode == 0:
                subprocess.run(['tmux', 'new-window', '-t', session_name, '-n', label],
                               capture_output=True)
                runner = 'run-gemini.sh' if engine == 'gemini' else 'run-agent.sh'
                cmd = f"bash '{COMPANY_DIR}/agents/{runner}' '{aid}'"
                subprocess.run(['tmux', 'send-keys', '-t', f"{session_name}:{label}",
                                cmd, 'Enter'], capture_output=True)
        except: pass

    # 4. router/scheduler에 SIGHUP → 즉시 재로드 (30초 폴링 대기 없음)
    signal_reload()

    return True, {"id": aid, "agent_file": agent_file, "etag": get_config_etag()}

def delete_agent(aid, if_match=None):
    target = None
    config = None
    with CONFIG_LOCK:
        if if_match is not None and if_match != get_config_etag():
            return False, "conflict_409"
        if not acquire_lock(CONFIG_PATH):
            return False, "config lock timeout"
        try:
            with open(CONFIG_PATH) as f:
                config = json.load(f)
            target = next((a for a in config.get('agents', []) if a['id'] == aid), None)
            if not target:
                return False, "not found"
            if target.get('protected'):
                return False, "protected agent — 삭제 불가"
            config['agents'] = [a for a in config['agents'] if a['id'] != aid]
            tmp = CONFIG_PATH + ".tmp"
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            os.rename(tmp, CONFIG_PATH)
        finally:
            release_lock(CONFIG_PATH)

    # tmux 윈도우 종료
    session_name = config.get('session_name', '')
    if session_name and target:
        try:
            subprocess.run(['tmux', 'kill-window', '-t', f"{session_name}:{target.get('label', aid)}"],
                           capture_output=True)
        except: pass

    signal_reload()
    return True, {"deleted": aid, "etag": get_config_etag()}

def assign_skills(aid, skills, if_match=None):
    if not isinstance(skills, list):
        return False, "skills must be array"
    with CONFIG_LOCK:
        if if_match is not None and if_match != get_config_etag():
            return False, "conflict_409"
        if not acquire_lock(CONFIG_PATH):
            return False, "config lock timeout"
        try:
            with open(CONFIG_PATH) as f:
                config = json.load(f)
            target = next((a for a in config.get('agents', []) if a['id'] == aid), None)
            if not target:
                return False, "not found"
            target['assigned_skills'] = skills
            tmp = CONFIG_PATH + ".tmp"
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            os.rename(tmp, CONFIG_PATH)
        finally:
            release_lock(CONFIG_PATH)
    signal_reload()
    return True, {"skills": skills, "etag": get_config_etag()}

def run_workflow(wf_file, user_request):
    """workflows/{wf_file} → kickoff.sh --dag 호출"""
    wf_path = os.path.join(COMPANY_DIR, 'workflows', wf_file)
    if not os.path.exists(wf_path):
        return False, "workflow not found"
    try:
        subprocess.Popen(['bash', os.path.join(COMPANY_DIR, 'kickoff.sh'),
                          '--dag', wf_path, user_request])
        return True, {"started": wf_file}
    except Exception as e:
        return False, str(e)

def create_workflow(body):
    """워크플로 빌더가 생성한 JSON을 workflows/에 저장
    body: {workflow_id, title, nodes: [{id, agent, input_template, depends_on, on_failure}]}"""
    import re
    wf_id = body.get('workflow_id', '').strip()
    if not wf_id or not all(c.isalnum() or c in '-_' for c in wf_id):
        return False, "invalid workflow_id (영문/숫자/-/_ 만)"
    if len(wf_id) < 2 or len(wf_id) > 50:
        return False, "workflow_id 길이는 2-50자"
    title = body.get('title', wf_id)
    nodes = body.get('nodes', [])
    if not nodes:
        return False, "노드 1개 이상 필요"
    if len(nodes) > 50:
        return False, "노드는 최대 50개"

    # config에서 유효한 에이전트 ID 목록 로드
    valid_agents = set()
    try:
        with open(CONFIG_PATH) as f:
            valid_agents = {a['id'] for a in json.load(f).get('agents', [])}
    except: pass

    # 노드 검증
    node_ids = set()
    for n in nodes:
        nid = (n.get('id') or '').strip()
        if not nid:
            return False, "노드 id 필수"
        if nid in node_ids:
            return False, f"중복된 노드 id: {nid}"
        if not all(c.isalnum() or c in '-_' for c in nid):
            return False, f"노드 id에 잘못된 문자: {nid}"
        node_ids.add(nid)
        agent = n.get('agent', '')
        if not agent:
            return False, f"노드 {nid}: agent 필수"
        if valid_agents and agent not in valid_agents:
            return False, f"노드 {nid}: 알 수 없는 에이전트 '{agent}'"

    # depends_on 검증 (존재하는 노드만 참조 가능 + 자기 참조 차단 + 순환 차단)
    for n in nodes:
        for dep in n.get('depends_on', []):
            if dep not in node_ids:
                return False, f"노드 {n['id']}: 잘못된 depends_on '{dep}'"
            if dep == n['id']:
                return False, f"노드 {n['id']}: 자기 자신 참조 불가"

    # 순환 의존성 감지 (단순 BFS)
    def has_cycle():
        graph = {n['id']: set(n.get('depends_on', [])) for n in nodes}
        for start in graph:
            visited, stack = set(), [start]
            while stack:
                cur = stack.pop()
                if cur in visited:
                    continue
                visited.add(cur)
                for dep in graph.get(cur, []):
                    if dep == start:
                        return True
                    stack.append(dep)
        return False
    if has_cycle():
        return False, "순환 의존성 감지됨"

    # input_template의 {{node_id.output_artifact}} 변수가 실제 노드 참조인지 검증
    var_pattern = re.compile(r'\{\{(\w+)\.output_artifact\}\}')
    for n in nodes:
        tmpl = n.get('input_template', '')
        for ref in var_pattern.findall(tmpl):
            if ref not in node_ids:
                return False, f"노드 {n['id']}: input_template이 존재하지 않는 노드 '{ref}' 참조"
            if ref == n['id']:
                return False, f"노드 {n['id']}: input_template에서 자기 참조 불가"

    # 기본값 채우기
    for n in nodes:
        n.setdefault('status', 'pending')
        n.setdefault('output_artifact', None)
        n.setdefault('retry_count', 0)
        n.setdefault('on_failure', 'manual')
        n.setdefault('depends_on', [])
        n.setdefault('input_template', '{{user_request}}')

    wf = {
        "workflow_id": f"wf_{wf_id}",
        "title": title,
        "status": "pending",
        "nodes": nodes,
    }

    out_path = os.path.join(COMPANY_DIR, 'workflows', f"{wf_id}.json")
    if not acquire_lock(out_path):
        return False, "lock timeout"
    try:
        tmp = out_path + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
        os.rename(tmp, out_path)
    finally:
        release_lock(out_path)

    return True, {"file": f"{wf_id}.json", "id": wf['workflow_id']}

def delete_workflow(wf_file):
    """workflows/{wf_file} 삭제"""
    if '..' in wf_file or '/' in wf_file:
        return False, "invalid filename"
    path = os.path.join(COMPANY_DIR, 'workflows', wf_file)
    if not os.path.exists(path):
        return False, "not found"
    try:
        os.remove(path)
        return True, {"deleted": wf_file}
    except Exception as e:
        return False, str(e)

def get_workflow_template(wf_file):
    """워크플로 템플릿 단일 조회 (편집용)"""
    path = os.path.join(COMPANY_DIR, 'workflows', wf_file)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except: return None

def control_action(action, body=None):
    """pause/resume/inject"""
    if action in ('pause', 'resume'):
        script = os.path.join(COMPANY_DIR, f'{action}.sh')
        if not os.path.exists(script):
            return False, "script not found"
        try:
            subprocess.run(['bash', script], capture_output=True)
            return True, {"action": action}
        except Exception as e:
            return False, str(e)
    elif action == 'inject':
        agent = body.get('agent', '')
        msg = body.get('message', '')
        if not agent or not msg:
            return False, "agent + message required"
        script = os.path.join(COMPANY_DIR, 'inject.sh')
        try:
            subprocess.run(['bash', script, agent, msg], capture_output=True)
            return True, {"injected": agent}
        except Exception as e:
            return False, str(e)
    return False, "unknown action"

# ━━━ HTTP Handler ━━━
class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 조용하게

    def _send_json(self, data, status=200, etag=None):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:7777')
        if etag:
            self.send_header('ETag', etag)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, ctype):
        try:
            with open(path, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    def _serve_next_static(self, url_path):
        """Serve files from dashboard-next/out/. Returns True if handled."""
        # Normalize and prevent path traversal.
        clean = url_path.lstrip('/')
        if clean.startswith('..') or '/..' in clean:
            self.send_error(403)
            return True
        # Map URL → filesystem path. trailingSlash export uses /foo/ → foo/index.html.
        candidates = []
        if clean == '' or clean.endswith('/'):
            candidates.append(os.path.join(NEXT_OUT_DIR, clean, 'index.html'))
        else:
            candidates.append(os.path.join(NEXT_OUT_DIR, clean))
            # Also try foo → foo/index.html and foo.html
            candidates.append(os.path.join(NEXT_OUT_DIR, clean, 'index.html'))
            candidates.append(os.path.join(NEXT_OUT_DIR, clean + '.html'))
        for fp in candidates:
            if os.path.isfile(fp):
                ctype = MIME_TYPES.get(os.path.splitext(fp)[1].lower(), 'application/octet-stream')
                self._send_file(fp, ctype)
                return True
        return False

    def _check_token(self):
        token = self.headers.get('X-Token', '')
        if token != DASHBOARD_TOKEN:
            self._send_json({"error": "invalid token"}, 403)
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        # Next.js static export takes precedence when present.
        if USE_NEXT and not path.startswith('/api/'):
            if self._serve_next_static(path):
                return
            # Fall through to legacy / 404
        if path == '/':
            self._send_file(os.path.join(DASHBOARD_DIR, 'index.html'), 'text/html; charset=utf-8')
        elif path == '/style.css':
            self._send_file(os.path.join(DASHBOARD_DIR, 'style.css'), 'text/css')
        elif path == '/app.js':
            self._send_file(os.path.join(DASHBOARD_DIR, 'app.js'), 'application/javascript')
        elif path == '/dag-render.js':
            self._send_file(os.path.join(DASHBOARD_DIR, 'dag-render.js'), 'application/javascript')
        elif path == '/api/token':
            self._send_json({"token": DASHBOARD_TOKEN})
        elif path == '/api/state':
            self._send_json(read_state(), etag=get_config_etag())
        elif path == '/api/channel':
            self._send_json(read_channel())
        elif path == '/api/workflows':
            self._send_json(read_workflows())
        elif path == '/api/tasks':
            self._send_json(read_tasks())
        elif path == '/api/knowledge':
            self._send_json(read_knowledge())
        elif path == '/api/skills':
            self._send_json(read_skills())
        elif path == '/api/library':
            self._send_json(read_library())
        elif path == '/api/presets':
            self._send_json(read_presets())
        elif path.startswith('/api/workflows/template/'):
            wf_file = path.split('/')[-1]
            wf = get_workflow_template(wf_file)
            if wf:
                self._send_json(wf)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self):
        if not self._check_token():
            return
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = {}
        if length > 0:
            try:
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            except: body = {}
        if_match = self.headers.get('X-If-Match')

        # Lost Update 응답 헬퍼
        def conflict_response(result):
            if result == "conflict_409":
                self._send_json({"ok": False, "result": "다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해주세요.", "code": 409}, 409)
                return True
            return False

        if path == '/api/agents/create':
            ok, result = create_agent(body, if_match)
            if not ok and conflict_response(result): return
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path == '/api/agents/from-library':
            ok, result = add_agent_from_library(
                body.get('library_path', ''),
                body.get('id'),
                body.get('label'),
                if_match
            )
            if not ok and conflict_response(result): return
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path == '/api/presets/export':
            ok, result = export_current_as_preset(
                body.get('id', 'my-preset'),
                body.get('name', 'My Preset'),
                body.get('description', ''),
                body.get('icon', '🏢'),
            )
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/agents/') and path.endswith('/delete'):
            aid = path.split('/')[3]
            ok, result = delete_agent(aid, if_match)
            if not ok and conflict_response(result): return
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/agents/') and path.endswith('/skills'):
            aid = path.split('/')[3]
            ok, result = assign_skills(aid, body.get('skills', []), if_match)
            if not ok and conflict_response(result): return
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/workflows/') and path.endswith('/run'):
            wf_file = path.split('/')[3]
            ok, result = run_workflow(wf_file, body.get('user_request', ''))
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path == '/api/workflows/create':
            ok, result = create_workflow(body)
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/workflows/') and path.endswith('/delete'):
            wf_file = path.split('/')[3]
            ok, result = delete_workflow(wf_file)
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path == '/api/pause':
            ok, result = control_action('pause')
            self._send_json({"ok": ok, "result": result})
        elif path == '/api/resume':
            ok, result = control_action('resume')
            self._send_json({"ok": ok, "result": result})
        elif path == '/api/inject':
            ok, result = control_action('inject', body)
            self._send_json({"ok": ok, "result": result})
        else:
            self.send_error(404)

# ━━━ Main ━━━
def get_port():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                return int(json.load(f).get('dashboard_port', 7777))
        except: pass
    return 7777

if __name__ == '__main__':
    port = get_port()
    bind = '127.0.0.1'
    print(f"  Dashboard: http://{bind}:{port}")
    print(f"  Token: {DASHBOARD_TOKEN}")
    print(f"  COMPANY_DIR: {COMPANY_DIR}")
    server = ThreadingHTTPServer((bind, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
