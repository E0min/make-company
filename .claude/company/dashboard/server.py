#!/usr/bin/env python3
"""
Virtual Company Dashboard Server (의존성 0)
- Python 표준 라이브러리만 사용
- localhost:7777 (기본)
- CSRF: dashboard_token.txt + X-Token 헤더
- Atomic mkdir lock (Bash와 호환)
"""
import os, sys, json, time, uuid, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

COMPANY_DIR = os.path.dirname(os.path.abspath(__file__)).rsplit('/dashboard', 1)[0]
DASHBOARD_DIR = os.path.join(COMPANY_DIR, 'dashboard')
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

# ━━━ Mutations (POST) ━━━
def create_agent(body):
    """body: {id, label, engine, agent_file, description, role_body, skills}"""
    aid = body.get('id', '').strip()
    if not aid or not aid.replace('-', '').replace('_', '').isalnum():
        return False, "invalid id"
    label = body.get('label', aid)
    engine = body.get('engine', 'claude')
    agent_file = body.get('agent_file', aid)
    description = body.get('description', f'{label} 에이전트')
    role_body = body.get('role_body', f'당신은 {label} 에이전트입니다.')
    skills = body.get('skills', [])

    # 1. config.json에 추가
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

    # 2. .claude/agents/{agent_file}.md 생성
    project_root = os.path.dirname(os.path.dirname(COMPANY_DIR))
    agents_md_dir = os.path.join(project_root, 'agents')
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

    return True, {"id": aid, "agent_file": agent_file}

def delete_agent(aid):
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

    return True, {"deleted": aid}

def assign_skills(aid, skills):
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
    return True, {"skills": skills}

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

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:7777')
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

    def _check_token(self):
        token = self.headers.get('X-Token', '')
        if token != DASHBOARD_TOKEN:
            self._send_json({"error": "invalid token"}, 403)
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
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
            self._send_json(read_state())
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

        if path == '/api/agents/create':
            ok, result = create_agent(body)
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/agents/') and path.endswith('/delete'):
            aid = path.split('/')[3]
            ok, result = delete_agent(aid)
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/agents/') and path.endswith('/skills'):
            aid = path.split('/')[3]
            ok, result = assign_skills(aid, body.get('skills', []))
            self._send_json({"ok": ok, "result": result}, 200 if ok else 400)
        elif path.startswith('/api/workflows/') and path.endswith('/run'):
            wf_file = path.split('/')[3]
            ok, result = run_workflow(wf_file, body.get('user_request', ''))
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
