#!/usr/bin/env python3
"""
Virtual Company v2 Dashboard Server (의존성 0)
- activity.log + agent-output/*.log 기반
- SSE(Server-Sent Events)로 실시간 스트리밍
- localhost:7777
"""
import os, sys, json, time, re, threading, subprocess, shlex, secrets, signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

COMPANY_DIR = os.path.dirname(os.path.abspath(__file__)).rsplit('/dashboard', 1)[0]
# Next.js static export(out/)가 있으면 우선 서빙, 없으면 기존 vanilla 폴백
NEXT_OUT_DIR = os.path.join(COMPANY_DIR, 'dashboard-next-v2', 'out')
VANILLA_DIR = os.path.join(COMPANY_DIR, 'dashboard')
DASHBOARD_DIR = NEXT_OUT_DIR if os.path.isdir(NEXT_OUT_DIR) else VANILLA_DIR
CONFIG_PATH = os.path.join(COMPANY_DIR, 'config.json')
ACTIVITY_LOG = os.path.join(COMPANY_DIR, 'activity.log')
AGENT_OUTPUT_DIR = os.path.join(COMPANY_DIR, 'agent-output')
AGENT_MEMORY_DIR = os.path.join(COMPANY_DIR, 'agent-memory')
WORKFLOWS_DIR = os.path.join(os.path.dirname(COMPANY_DIR), 'workflows')  # .claude/workflows/
AGENTS_DIR = os.path.join(os.path.dirname(COMPANY_DIR), 'agents')  # .claude/agents/
RETRO_DIR = os.path.join(COMPANY_DIR, 'retrospectives')  # .claude/company/retrospectives/
GLOBAL_AGENTS_DIR = os.path.expanduser('~/.claude/agents')  # 글로벌 에이전트
PROJECT_DIR = os.path.dirname(os.path.dirname(COMPANY_DIR))  # project root

# 실행 중인 프로세스 추적
RUNNING_PROC = {"pid": None, "task": None, "mode": None, "started": None}
PROC_LOCK = threading.Lock()

# config.json read-modify-write 동기화
CONFIG_LOCK = threading.Lock()

# ━━━ In-memory cache (TTL-based) ━━━
_cache = {}
_cache_lock = threading.Lock()

def cached(key, ttl_sec, reader_fn):
    """TTL 기반 캐시. 만료 전이면 메모리에서 반환, 만료 시 reader_fn 호출 후 갱신."""
    now = time.monotonic()
    with _cache_lock:
        if key in _cache:
            data, expire = _cache[key]
            if now < expire:
                return data
    data = reader_fn()
    with _cache_lock:
        _cache[key] = (data, now + ttl_sec)
    return data

def invalidate_cache(key):
    """특정 캐시 키를 즉시 무효화."""
    with _cache_lock:
        _cache.pop(key, None)

# 인증 토큰 (서버 시작 시 생성)
AUTH_TOKEN = secrets.token_hex(16)

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
}

# ━━━ Data readers ━━━

def _read_config_raw():
    if not os.path.exists(CONFIG_PATH):
        return {}
    with open(CONFIG_PATH) as f:
        return json.load(f)

def read_config():
    return cached("config", 2, _read_config_raw)

def read_activity(lines=50):
    """activity.log에서 최근 N줄 + 파싱"""
    if not os.path.exists(ACTIVITY_LOG):
        return []
    with open(ACTIVITY_LOG) as f:
        all_lines = f.readlines()
    entries = []
    # 패턴: [2026-04-09 16:26:58] [agent-id] 🟢 시작 | 설명
    pattern = re.compile(r'\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*(.*)')
    for line in all_lines[-lines:]:
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            entries.append({
                "timestamp": m.group(1),
                "agent": m.group(2) or "",
                "message": m.group(3),
                "raw": line,
            })
        else:
            entries.append({"timestamp": "", "agent": "", "message": line, "raw": line})
    return entries

def _read_agent_states_raw():
    """activity.log에서 에이전트별 최신 상태 추출 (원본)"""
    # 실제 .claude/agents/ 파일 기준으로 에이전트 목록 생성 (config.json만 보면 누락 발생)
    agents_dir = os.path.join(os.path.dirname(COMPANY_DIR), 'agents')
    if os.path.isdir(agents_dir):
        agents = [os.path.splitext(f)[0] for f in sorted(os.listdir(agents_dir)) if f.endswith('.md')]
    else:
        config = read_config()
        agents = config.get('agents', [])
    states = {}
    for aid in agents:
        states[aid] = {"id": aid, "state": "idle", "last_message": "", "timestamp": ""}

    if os.path.exists(ACTIVITY_LOG):
        with open(ACTIVITY_LOG) as f:
            for line in f:
                line = line.strip()
                for aid in states:
                    if f'[{aid}]' in line:
                        if '🟢' in line:
                            states[aid]["state"] = "working"
                        elif '✅' in line:
                            states[aid]["state"] = "done"
                        elif '❌' in line:
                            states[aid]["state"] = "error"
                        # 타임스탬프 추출
                        ts_match = re.match(r'\[([^\]]+)\]', line)
                        if ts_match:
                            states[aid]["timestamp"] = ts_match.group(1)
                        states[aid]["last_message"] = line
    return list(states.values())

def read_agent_states():
    return cached("states", 1, _read_agent_states_raw)

def read_agent_output(agent_id, lines=30):
    """agent-output/{id}.log에서 최근 내용"""
    path = os.path.join(AGENT_OUTPUT_DIR, f"{agent_id}.log")
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        all_lines = f.readlines()
    return "".join(all_lines[-lines:])

def read_agent_memory(agent_id):
    """agent-memory/{id}.md"""
    path = os.path.join(AGENT_MEMORY_DIR, f"{agent_id}.md")
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        return f.read()

# ━━━ SSE watchers ━━━

def _read_agents_full_raw():
    """프로젝트 에이전트 .md 파일 목록 (frontmatter + 본문) — 원본"""
    agents = []
    if not os.path.isdir(AGENTS_DIR):
        return agents
    for f in sorted(os.listdir(AGENTS_DIR)):
        if not f.endswith('.md'):
            continue
        aid = os.path.splitext(f)[0]
        path = os.path.join(AGENTS_DIR, f)
        try:
            with open(path) as fh:
                content = fh.read()
            # frontmatter 파싱
            meta = {}
            body = content
            if content.startswith('---'):
                end = content.find('---', 3)
                if end != -1:
                    fm = content[3:end].strip()
                    body = content[end+3:].strip()
                    for line in fm.split('\n'):
                        if ':' in line and not line.startswith(' '):
                            k, _, v = line.partition(':')
                            meta[k.strip()] = v.strip()
            agents.append({
                "id": aid,
                "name": meta.get('name', aid),
                "description": meta.get('description', ''),
                "category": meta.get('category', ''),
                "color": meta.get('color', ''),
                "content": content,
                "is_global": os.path.exists(os.path.join(GLOBAL_AGENTS_DIR, f)),
            })
        except Exception: pass
    return agents

def read_agents_full():
    return cached("agents_full", 5, _read_agents_full_raw)

def read_global_agents():
    """글로벌 에이전트 목록 (프로젝트에 없는 것만)"""
    if not os.path.isdir(GLOBAL_AGENTS_DIR):
        return []
    project_ids = set()
    if os.path.isdir(AGENTS_DIR):
        project_ids = {os.path.splitext(f)[0] for f in os.listdir(AGENTS_DIR) if f.endswith('.md')}
    agents = []
    for f in sorted(os.listdir(GLOBAL_AGENTS_DIR)):
        if not f.endswith('.md'):
            continue
        aid = os.path.splitext(f)[0]
        if aid in project_ids:
            continue
        path = os.path.join(GLOBAL_AGENTS_DIR, f)
        try:
            with open(path) as fh:
                first_lines = fh.read(500)
            meta = {}
            if first_lines.startswith('---'):
                end = first_lines.find('---', 3)
                if end != -1:
                    for line in first_lines[3:end].split('\n'):
                        if ':' in line and not line.startswith(' '):
                            k, _, v = line.partition(':')
                            meta[k.strip()] = v.strip()
            agents.append({
                "id": aid,
                "name": meta.get('name', aid),
                "description": meta.get('description', ''),
                "category": meta.get('category', ''),
            })
        except Exception: pass
    return agents

def save_agent(agent_id, content, scope='local', color=None):
    """에이전트 .md 파일 저장 (local=프로젝트, global=글로벌)"""
    # 색상이 있으면 frontmatter에 주입
    if color and '---' in content:
        end = content.find('---', 3)
        if end != -1:
            fm = content[3:end].strip()
            # 기존 color 제거
            fm_lines = [l for l in fm.split('\n') if not l.startswith('color:')]
            fm_lines.append(f'color: {color}')
            content = '---\n' + '\n'.join(fm_lines) + '\n---' + content[end+3:]

    # 저장 경로 결정
    if scope == 'global':
        os.makedirs(GLOBAL_AGENTS_DIR, exist_ok=True)
        path = os.path.join(GLOBAL_AGENTS_DIR, f"{agent_id}.md")
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

    # 로컬에도 항상 저장 (global이면 둘 다)
    os.makedirs(AGENTS_DIR, exist_ok=True)
    path = os.path.join(AGENTS_DIR, f"{agent_id}.md")
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

    # config.json에 에이전트 추가 (race condition 방지)
    with CONFIG_LOCK:
        config = read_config()
        agents = config.get('agents', [])
        if agent_id not in agents:
            agents.append(agent_id)
            config['agents'] = agents
            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
    # 메모리 + 출력 파일 생성
    os.makedirs(AGENT_MEMORY_DIR, exist_ok=True)
    os.makedirs(AGENT_OUTPUT_DIR, exist_ok=True)
    for d, ext in [(AGENT_MEMORY_DIR, '.md'), (AGENT_OUTPUT_DIR, '.log')]:
        p = os.path.join(d, f"{agent_id}{ext}")
        if not os.path.exists(p):
            open(p, 'w').close()
    return True

def generate_agent_with_ai(role_desc, agent_id):
    """Claude CLI로 에이전트 .md 생성"""
    prompt = f"""다음 역할의 Virtual Company 에이전트 .md 파일을 생성해주세요.

역할: {role_desc}
ID: {agent_id}

반드시 아래 형식을 따르세요:

---
name: (영문 이름)
description: (한국어 한줄 설명)
category: (leadership/engineering/design/qa/marketing 중 택1)
---

# Role: (역할명)

당신은 Virtual Company의 **(역할명)** 에이전트입니다. 워크플로우 시스템을 통해 호출되며, 작업 결과를 직접 반환합니다.

## 프로젝트 컨텍스트
{{{{project_context}}}}

## 누적 기억
{{{{agent_memory}}}}

---

## 핵심 원칙
(3~5개 구체적 원칙)

## 행동 규칙
(구체적 do/don't)

## Tone & Manner
(톤 가이드)

.md 파일 내용만 출력하세요. 다른 설명 없이."""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--no-input'],
            capture_output=True, text=True, timeout=60,
            cwd=PROJECT_DIR,
        )
        output = result.stdout.strip()
        # --- 로 시작하는 부분 찾기
        idx = output.find('---')
        if idx >= 0:
            return output[idx:]
        return output
    except subprocess.TimeoutExpired:
        return {"error": "AI 생성 시간 초과 (60초)"}
    except FileNotFoundError:
        return {"error": "claude CLI를 찾을 수 없습니다"}
    except Exception as e:
        return {"error": f"AI 생성 실패: {str(e)}"}

def generate_workflow_with_ai(description):
    """Claude CLI로 워크플로우 YAML 생성"""
    prompt = f"""다음 설명에 맞는 워크플로우 YAML을 생성하세요.

설명: {description}

사용 가능한 에이전트: ceo, product-manager, ui-ux-designer, frontend-engineer, backend-engineer, fe-qa, be-qa, marketing-strategist

반드시 아래 형식을 따르세요:
name: (한국어 이름)
description: (한국어 설명, 흐름을 → 로 표시)

steps:
  - id: (영문 kebab-case)
    agent: (위 에이전트 중 하나)
    prompt: |
      (구체적 지시, {{{{input}}}}과 {{{{steps.이전스텝.output}}}} 사용)
    depends_on: [이전 스텝 id들]
    output: (영문 변수명)

YAML만 출력하세요. 설명이나 코드블록 없이."""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--no-input'],
            capture_output=True, text=True, timeout=60, cwd=PROJECT_DIR
        )
        output = result.stdout.strip()
        # 'name:' 시작 부분 찾기
        idx = output.find('name:')
        if idx >= 0:
            return output[idx:]
        return output if output else None
    except subprocess.TimeoutExpired:
        return {"error": "AI 생성 시간 초과 (60초)"}
    except FileNotFoundError:
        return {"error": "claude CLI를 찾을 수 없습니다"}
    except Exception as e:
        return {"error": f"생성 실패: {str(e)}"}

def delete_agent(agent_id):
    """에이전트 삭제"""
    path = os.path.join(AGENTS_DIR, f"{agent_id}.md")
    if os.path.exists(path):
        os.remove(path)
    # config.json에서 제거 (race condition 방지)
    with CONFIG_LOCK:
        config = read_config()
        agents = config.get('agents', [])
        if agent_id in agents:
            agents.remove(agent_id)
            config['agents'] = agents
            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
    return True

def import_global_agent(agent_id):
    """글로벌 에이전트를 프로젝트로 복사"""
    src = os.path.join(GLOBAL_AGENTS_DIR, f"{agent_id}.md")
    if not os.path.exists(src):
        return False
    with open(src) as f:
        content = f.read()
    return save_agent(agent_id, content)

def _read_workflows_raw():
    """워크플로우 YAML 목록 (원본)"""
    if not os.path.isdir(WORKFLOWS_DIR):
        return []
    workflows = []
    for f in sorted(os.listdir(WORKFLOWS_DIR)):
        if f.endswith('.yml') or f.endswith('.yaml'):
            path = os.path.join(WORKFLOWS_DIR, f)
            name = os.path.splitext(f)[0]
            # YAML 파싱 (간단히 name/description 추출)
            title, desc = name, ''
            try:
                with open(path) as fh:
                    for line in fh:
                        if line.startswith('name:'):
                            title = line.split(':', 1)[1].strip()
                        elif line.startswith('description:'):
                            desc = line.split(':', 1)[1].strip()
                            break
            except Exception: pass
            workflows.append({"file": f, "name": name, "title": title, "description": desc})
    return workflows

def read_workflows():
    return cached("workflows", 10, _read_workflows_raw)

def read_retrospectives(limit=20):
    """회고 JSON 파일 목록 (최신순, 최대 limit개)"""
    if not os.path.isdir(RETRO_DIR):
        return []
    files = sorted(
        [f for f in os.listdir(RETRO_DIR) if f.endswith('.json')],
        reverse=True
    )[:limit]
    retros = []
    for f in files:
        try:
            with open(os.path.join(RETRO_DIR, f)) as fh:
                retros.append(json.load(fh))
        except Exception:
            pass
    return retros

def run_company_task(task, mode='run'):
    """claude CLI로 /company run 또는 /company workflow 실행"""
    # 입력 검증
    if len(task) > 5000:
        return {"ok": False, "error": "태스크가 너무 깁니다 (최대 5000자)"}
    task = task.replace('\x00', '')  # null byte 제거

    global RUNNING_PROC
    with PROC_LOCK:
        if RUNNING_PROC["pid"]:
            return {"ok": False, "error": "이미 실행 중인 태스크가 있습니다"}

    if mode == 'run':
        prompt = f'/company run {task}'
    else:
        prompt = f'/company workflow {task}'

    # activity.log에 기록
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(ACTIVITY_LOG, 'a') as f:
        f.write(f"[{ts}] 🌐 대시보드에서 실행 | {prompt}\n")

    # claude CLI 백그라운드 실행
    cmd = ['claude', '--yes', '-p', prompt]
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=PROJECT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        with PROC_LOCK:
            RUNNING_PROC = {
                "pid": proc.pid,
                "task": task,
                "mode": mode,
                "started": ts,
            }
        # 백그라운드 스레드로 완료 대기
        def wait_and_log():
            global RUNNING_PROC
            stdout, _ = proc.communicate()
            ts2 = time.strftime('%Y-%m-%d %H:%M:%S')
            status = '✅ 완료' if proc.returncode == 0 else f'❌ 실패 (code={proc.returncode})'
            with open(ACTIVITY_LOG, 'a') as f:
                f.write(f"[{ts2}] 🌐 대시보드 태스크 {status}\n")
            # 출력을 ceo output에 기록
            ceo_log = os.path.join(AGENT_OUTPUT_DIR, 'ceo.log')
            if stdout:
                with open(ceo_log, 'a') as f:
                    f.write(f"\n━━━ {ts2} 대시보드 실행 결과 ━━━\n{stdout[:3000]}\n")
            with PROC_LOCK:
                RUNNING_PROC = {"pid": None, "task": None, "mode": None, "started": None}

        threading.Thread(target=wait_and_log, daemon=True).start()
        return {"ok": True, "pid": proc.pid, "task": task}
    except FileNotFoundError:
        return {"ok": False, "error": "claude CLI를 찾을 수 없습니다"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

class FileWatcher:
    """파일 변경을 감지하여 SSE 이벤트 생성"""
    def __init__(self, path):
        self.path = path
        self.last_size = os.path.getsize(path) if os.path.exists(path) else 0

    def get_new_content(self):
        if not os.path.exists(self.path):
            return None
        size = os.path.getsize(self.path)
        if size <= self.last_size:
            if size < self.last_size:
                self.last_size = 0  # 파일이 truncate된 경우
            else:
                return None
        with open(self.path) as f:
            f.seek(self.last_size)
            content = f.read()
        self.last_size = size
        return content if content else None

# ━━━ Handler ━━━

class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 조용히

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def check_auth(self):
        """POST 요청에 대해 X-Token 헤더 검증. 실패 시 401 응답 후 False 반환."""
        token = self.headers.get('X-Token', '')
        if token != AUTH_TOKEN:
            self.send_json({"error": "unauthorized"}, 401)
            return False
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API 라우팅
        if path == '/api/state':
            config = read_config()
            agents = read_agent_states()
            self.send_json({
                "project": config.get("project", "Company"),
                "tech_stack": config.get("tech_stack", ""),
                "agents": agents,
                "now": int(time.time()),
            })
        elif path == '/api/activity':
            self.send_json({"entries": read_activity()})
        elif path.startswith('/api/agent/') and path.endswith('/output'):
            agent_id = path.split('/')[3]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            self.send_json({"output": read_agent_output(agent_id)})
        elif path.startswith('/api/agent/') and path.endswith('/memory'):
            agent_id = path.split('/')[3]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            self.send_json({"memory": read_agent_memory(agent_id)})
        elif path == '/api/agents':
            self.send_json({"agents": read_agents_full()})
        elif path == '/api/agents/global':
            self.send_json({"agents": read_global_agents()})
        elif path.startswith('/api/agent/') and path.endswith('/content'):
            agent_id = path.split('/')[3]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            agents = read_agents_full()
            agent = next((a for a in agents if a['id'] == agent_id), None)
            self.send_json(agent or {"error": "not found"})
        elif path == '/api/workflows':
            self.send_json({"workflows": read_workflows()})
        elif path.startswith('/api/workflow/'):
            # GET /api/workflow/<name> — 개별 워크플로우 YAML 조회
            parts = path.split('/')
            name = parts[3] if len(parts) > 3 else ''
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            # .yml 또는 .yaml 확장자 탐색
            wf_path = None
            for ext in ('.yml', '.yaml'):
                candidate = os.path.join(WORKFLOWS_DIR, f"{name}{ext}")
                if os.path.isfile(candidate):
                    wf_path = candidate
                    break
            if not wf_path:
                self.send_json({"ok": False, "error": "워크플로우를 찾을 수 없습니다"}, 404)
                return
            with open(wf_path, encoding='utf-8') as f:
                raw_yaml = f.read()
            self.send_json({"ok": True, "name": name, "content": raw_yaml})
        elif path == '/api/token':
            # localhost에서만 접근 가능 (remote IP 체크)
            client_ip = self.client_address[0]
            if client_ip not in ('127.0.0.1', '::1', 'localhost'):
                self.send_json({"error": "forbidden"}, 403)
                return
            self.send_json({"token": AUTH_TOKEN})
        elif path == '/api/retrospectives':
            self.send_json({"retrospectives": read_retrospectives()})
        elif path == '/api/running':
            with PROC_LOCK:
                data = dict(RUNNING_PROC)
            self.send_json(data)
        elif path == '/api/sse':
            self.handle_sse()
        elif path == '/' or path == '/index.html':
            self.serve_file('index.html')
        else:
            self.serve_file(path.lstrip('/'))

    def handle_sse(self):
        """Server-Sent Events — activity.log 변경을 실시간 스트리밍"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()

        # 파일 워처 생성
        activity_watcher = FileWatcher(ACTIVITY_LOG)
        agent_watchers = {}
        config = read_config()
        for aid in config.get('agents', []):
            path = os.path.join(AGENT_OUTPUT_DIR, f"{aid}.log")
            agent_watchers[aid] = FileWatcher(path)

        last_config_check = time.time()
        try:
            while True:
                # 10초마다 config 재확인 → 새 에이전트 감지
                if time.time() - last_config_check > 10:
                    last_config_check = time.time()
                    config = read_config()
                    for aid in config.get('agents', []):
                        if aid not in agent_watchers:
                            p = os.path.join(AGENT_OUTPUT_DIR, f"{aid}.log")
                            agent_watchers[aid] = FileWatcher(p)

                # activity.log 변경 감지
                new_activity = activity_watcher.get_new_content()
                if new_activity:
                    for line in new_activity.strip().split('\n'):
                        if line.strip():
                            event = json.dumps({"type": "activity", "data": line.strip()}, ensure_ascii=False)
                            self.wfile.write(f"data: {event}\n\n".encode())
                            self.wfile.flush()

                # agent-output 변경 감지
                for aid, watcher in list(agent_watchers.items()):
                    new_content = watcher.get_new_content()
                    if new_content:
                        event = json.dumps({"type": "agent_output", "agent": aid, "data": new_content.strip()}, ensure_ascii=False)
                        self.wfile.write(f"data: {event}\n\n".encode())
                        self.wfile.flush()

                time.sleep(0.5)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def serve_file(self, filename):
        filepath = os.path.join(DASHBOARD_DIR, filename)

        # trailing slash 지원: /foo/ → /foo/index.html (Next.js trailingSlash: true)
        if os.path.isdir(filepath):
            filepath = os.path.join(filepath, 'index.html')
            filename = os.path.join(filename, 'index.html')

        # path traversal 방지
        real = os.path.realpath(filepath)
        if not real.startswith(os.path.realpath(DASHBOARD_DIR)):
            self.send_error(403)
            return
        if not os.path.isfile(real):
            self.send_error(404)
            return
        ext = os.path.splitext(filename)[1]
        mime = MIME_TYPES.get(ext, 'application/octet-stream')
        with open(real, 'rb') as f:
            body = f.read()
        # index.html: 인증 토큰 주입 + 프로젝트 이름 타이틀
        if filename.endswith('index.html'):
            body = body.replace(b'</head>', f'<meta name="vc-token" content="{AUTH_TOKEN}">\n</head>'.encode())
            config = read_config()
            project = config.get("project", "Company")
            body = body.replace(b'<title>Virtual Company Dashboard</title>',
                                f'<title>VC — {project}</title>'.encode())
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.check_auth():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get('Content-Length', 0))
        MAX_BODY = 1_048_576  # 1MB
        if content_len > MAX_BODY:
            self.send_json({"error": "payload too large"}, 413)
            return
        try:
            body = json.loads(self.rfile.read(content_len)) if content_len else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "invalid JSON body"}, 400)
            return

        if path == '/api/run':
            # 멀티에이전트 실행: {"task": "..."}
            task = body.get('task', '').strip()
            if not task:
                self.send_json({"ok": False, "error": "태스크를 입력하세요"}, 400)
                return
            result = run_company_task(task, mode='run')
            self.send_json(result)

        elif path == '/api/workflow':
            # 워크플로우 실행: {"name": "new-feature", "input": "..."}
            name = body.get('name', '').strip()
            input_text = body.get('input', '').strip()
            if not name:
                self.send_json({"ok": False, "error": "워크플로우를 선택하세요"}, 400)
                return
            task = f"{name} {input_text}".strip()
            result = run_company_task(task, mode='workflow')
            self.send_json(result)

        elif path == '/api/workflows/save':
            # 워크플로우 저장: {"name": "string", "content": "raw YAML string"}
            name = body.get('name', '').strip()
            content = body.get('content', '')
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            if not content:
                self.send_json({"ok": False, "error": "content가 비어있습니다"}, 400)
                return
            os.makedirs(WORKFLOWS_DIR, exist_ok=True)
            wf_path = os.path.join(WORKFLOWS_DIR, f"{name}.yml")
            with open(wf_path, 'w', encoding='utf-8') as f:
                f.write(content)
            invalidate_cache("workflows")
            self.send_json({"ok": True, "name": name})

        elif path == '/api/workflows/delete':
            # 워크플로우 삭제: {"name": "string"}
            name = body.get('name', '').strip()
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            # .yml 또는 .yaml 확장자 탐색
            deleted = False
            for ext in ('.yml', '.yaml'):
                candidate = os.path.join(WORKFLOWS_DIR, f"{name}{ext}")
                if os.path.isfile(candidate):
                    os.remove(candidate)
                    deleted = True
                    break
            if not deleted:
                self.send_json({"ok": False, "error": "워크플로우를 찾을 수 없습니다"}, 404)
                return
            invalidate_cache("workflows")
            self.send_json({"ok": True})

        elif path == '/api/agents/save':
            # 에이전트 저장: {"id", "content", "scope": "local"|"global"|"both", "color"}
            aid = body.get('id', '').strip()
            content = body.get('content', '').strip()
            scope = body.get('scope', 'local')
            color = body.get('color', '').strip() or None
            if not aid or not content:
                self.send_json({"ok": False, "error": "ID와 내용을 입력하세요"}, 400)
                return
            if not re.match(r'^[a-z][a-z0-9-]*$', aid):
                self.send_json({"ok": False, "error": "ID는 영문 소문자, 숫자, 하이픈만 허용"}, 400)
                return
            if scope == 'both':
                save_agent(aid, content, 'global', color)
            else:
                save_agent(aid, content, scope, color)
            invalidate_cache("agents_full")
            invalidate_cache("config")
            self.send_json({"ok": True, "id": aid})

        elif path == '/api/agents/generate':
            # AI로 에이전트 생성: {"role": "...", "id": "..."}
            role = body.get('role', '').strip()
            aid = body.get('id', '').strip()
            if not role:
                self.send_json({"ok": False, "error": "역할 설명을 입력하세요"}, 400)
                return
            if not aid:
                # role에서 ID 자동 생성
                aid = re.sub(r'[^a-z0-9]+', '-', role.lower().strip())[:30].strip('-')
            content = generate_agent_with_ai(role, aid)
            if content and isinstance(content, str):
                self.send_json({"ok": True, "id": aid, "content": content})
            elif content and isinstance(content, dict) and "error" in content:
                self.send_json({"ok": False, "error": content["error"]})
            else:
                self.send_json({"ok": False, "error": "AI 생성 실패"})

        elif path == '/api/agents/delete':
            # 에이전트 삭제: {"id": "..."}
            aid = body.get('id', '').strip()
            if not aid:
                self.send_json({"ok": False, "error": "ID 필요"}, 400)
                return
            if not re.match(r'^[a-z][a-z0-9-]*$', aid):
                self.send_json({"ok": False, "error": "잘못된 ID 형식"}, 400)
                return
            if aid == 'ceo':
                self.send_json({"ok": False, "error": "CEO는 삭제할 수 없습니다"}, 400)
                return
            delete_agent(aid)
            invalidate_cache("agents_full")
            invalidate_cache("config")
            self.send_json({"ok": True})

        elif path == '/api/agents/import':
            # 글로벌 에이전트 가져오기: {"id": "..."}
            aid = body.get('id', '').strip()
            if not aid:
                self.send_json({"ok": False, "error": "ID 필요"}, 400)
                return
            if not re.match(r'^[a-z][a-z0-9-]*$', aid):
                self.send_json({"ok": False, "error": "잘못된 ID 형식"}, 400)
                return
            if import_global_agent(aid):
                self.send_json({"ok": True, "id": aid})
            else:
                self.send_json({"ok": False, "error": "글로벌 에이전트를 찾을 수 없습니다"})

        elif path == '/api/workflows/generate':
            # AI로 워크플로우 YAML 생성: {"description": "..."}
            desc = body.get('description', '').strip()
            if not desc:
                self.send_json({"ok": False, "error": "설명을 입력하세요"}, 400)
                return
            content = generate_workflow_with_ai(desc)
            if content and isinstance(content, str):
                self.send_json({"ok": True, "content": content})
            elif isinstance(content, dict) and "error" in content:
                self.send_json({"ok": False, "error": content["error"]})
            else:
                self.send_json({"ok": False, "error": "워크플로우 생성 실패"})

        elif path == '/api/retrospectives/save':
            # 회고 저장: JSON 객체 전체를 파일로 저장
            if not body or not isinstance(body, dict):
                self.send_json({"ok": False, "error": "유효한 JSON 객체를 전송하세요"}, 400)
                return
            os.makedirs(RETRO_DIR, exist_ok=True)
            ts = int(time.time() * 1000)
            filename = f"retro-{ts}.json"
            filepath = os.path.join(RETRO_DIR, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(body, f, ensure_ascii=False, indent=2)
            self.send_json({"ok": True, "file": filename})

        elif path == '/api/stop':
            # 실행 중인 태스크 중지 (SIGTERM → 3초 후 SIGKILL fallback)
            with PROC_LOCK:
                pid = RUNNING_PROC["pid"]
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
                    # 3초 후에도 살아있으면 SIGKILL
                    def force_kill():
                        global RUNNING_PROC
                        time.sleep(3)
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        with PROC_LOCK:
                            RUNNING_PROC = {"pid": None, "task": None, "mode": None, "started": None}
                    threading.Thread(target=force_kill, daemon=True).start()
                    self.send_json({"ok": True, "message": "중지 요청됨"})
                except ProcessLookupError:
                    self.send_json({"ok": False, "error": "프로세스가 이미 종료됨"})
            else:
                self.send_json({"ok": False, "error": "실행 중인 태스크 없음"})
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token')
        self.end_headers()

# ━━━ Main ━━━

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7777
    config = read_config()
    project = config.get("project", "Company")
    server = ThreadingHTTPServer(('127.0.0.1', port), DashboardHandler)
    print(f"\n  🌐 {project} Dashboard")
    print(f"  http://localhost:{port}")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Dashboard stopped.")
        server.server_close()

if __name__ == '__main__':
    main()
