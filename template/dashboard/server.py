#!/usr/bin/env python3
"""
Virtual Company v2 Dashboard Server (의존성 0)
- activity.log + agent-output/*.log 기반
- SSE(Server-Sent Events)로 실시간 스트리밍
- localhost:7777
"""
import os, sys, json, time, re, threading, subprocess, shlex, secrets, signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

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

# ━━━ 글로벌 멀티프로젝트 레지스트리 ━━━
PROJECTS_REGISTRY = os.path.expanduser("~/.make-company/projects.json")

def _check_tmux_session(project_id):
    """프로젝트의 tmux 세션이 살아있는지 확인."""
    try:
        result = subprocess.run(
            ['tmux', 'has-session', '-t', f'vc-{project_id}'],
            capture_output=True, timeout=2
        )
        return result.returncode == 0
    except Exception:
        return False

def _get_tmux_windows(session_name):
    """tmux 세션의 윈도우 목록 반환."""
    try:
        result = subprocess.run(
            ['tmux', 'list-windows', '-t', session_name, '-F', '#{window_index}:#{window_name}'],
            capture_output=True, text=True, timeout=2
        )
        if result.returncode != 0:
            return []
        return [line.strip() for line in result.stdout.strip().split('\n') if line.strip()]
    except Exception:
        return []

def _start_company_session(project_id):
    """프로젝트의 tmux 세션 생성 + claude 실행 + Monitor 윈도우."""
    session_name = f"vc-{project_id}"
    project_path = get_project_root(project_id)
    if not project_path:
        return {"ok": False, "error": f"프로젝트 '{project_id}'를 찾을 수 없습니다"}

    # 이미 실행 중인지 확인
    if _check_tmux_session(project_id):
        return {"ok": False, "error": "이미 실행중"}

    try:
        # tmux 세션 생성 + claude 실행
        subprocess.run(
            ['tmux', 'new-session', '-d', '-s', session_name, '-n', 'claude', '-c', project_path],
            capture_output=True, timeout=5
        )
        time.sleep(0.5)
        subprocess.run(
            ['tmux', 'send-keys', '-t', f'{session_name}:0', 'command claude', 'Enter'],
            capture_output=True, timeout=5
        )

        # Monitor 윈도우
        activity_log = os.path.join(project_path, '.claude', 'company', 'activity.log')
        subprocess.run(
            ['tmux', 'new-window', '-d', '-t', f'{session_name}:', '-n', 'Monitor', '-c', project_path],
            capture_output=True, timeout=5
        )
        time.sleep(0.3)
        subprocess.run(
            ['tmux', 'send-keys', '-t', f'{session_name}:1', f'tail -f {shlex.quote(activity_log)}', 'Enter'],
            capture_output=True, timeout=5
        )

        # 에이전트 윈도우 생성 (config.json에서 에이전트 목록 읽기)
        company_dir = os.path.join(project_path, '.claude', 'company')
        agents_dir = os.path.join(project_path, '.claude', 'agents')
        if os.path.isdir(agents_dir):
            agent_ids = [os.path.splitext(f)[0] for f in sorted(os.listdir(agents_dir)) if f.endswith('.md') and f != 'ceo.md']
            idx = 1  # 0=claude, 1=Monitor
            for agent_id in agent_ids:
                idx += 1
                label = _agent_short_label(agent_id)
                subprocess.run(
                    ['tmux', 'new-window', '-d', '-t', f'{session_name}:', '-n', label, '-c', project_path],
                    capture_output=True, timeout=5
                )
            # 쉘 초기화 대기
            time.sleep(1)
            idx = 1
            for agent_id in agent_ids:
                idx += 1
                subprocess.run(
                    ['tmux', 'send-keys', '-t', f'{session_name}:{idx}', f'command claude --agent {agent_id}', 'Enter'],
                    capture_output=True, timeout=5
                )

        return {"ok": True, "session": session_name}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "tmux 명령 타임아웃"}
    except FileNotFoundError:
        return {"ok": False, "error": "tmux를 찾을 수 없습니다"}
    except Exception as e:
        return {"ok": False, "error": f"세션 생성 실패: {str(e)}"}

def _stop_company_session(project_id):
    """프로젝트의 tmux 세션 종료."""
    session_name = f"vc-{project_id}"
    try:
        result = subprocess.run(
            ['tmux', 'kill-session', '-t', session_name],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            # 터미널 임시 파일 정리
            import glob
            for f in glob.glob(f"/tmp/vc-term-{project_id}-*.log"):
                try:
                    os.remove(f)
                except OSError:
                    pass
            return {"ok": True}
        else:
            return {"ok": False, "error": f"세션 종료 실패: {result.stderr.strip()}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "tmux 명령 타임아웃"}
    except FileNotFoundError:
        return {"ok": False, "error": "tmux를 찾을 수 없습니다"}
    except Exception as e:
        return {"ok": False, "error": f"세션 종료 실패: {str(e)}"}

def _agent_short_label(agent_id):
    """에이전트 ID -> tmux 윈도우 이름 매핑"""
    labels = {
        "ceo": "claude",
        "product-manager": "PM",
        "ui-ux-designer": "Designer",
        "frontend-engineer": "Frontend",
        "backend-engineer": "Backend",
        "fe-qa": "FE-QA",
        "be-qa": "BE-QA",
        "marketing-strategist": "Marketing",
    }
    return labels.get(agent_id, agent_id)

def _terminal_open(project_id, agent_id, cols=None, rows=None):
    """tmux pipe-pane 시작 + 스크롤백 반환. cols/rows가 있으면 pane 리사이즈."""
    session = f"vc-{project_id}"
    # tmux 세션 존재 확인
    if not _check_tmux_session(project_id):
        return None, "회사가 실행중이지 않습니다. Start 버튼으로 시작하세요."
    # 에이전트의 tmux 윈도우 인덱스 찾기
    windows = _get_tmux_windows(session)
    agent_label = _agent_short_label(agent_id)  # PM, Frontend 등
    win_idx = None
    for w in windows:
        # "3:PM" 형태에서 매칭
        parts = w.split(':')
        if len(parts) == 2 and parts[1].strip() == agent_label:
            win_idx = parts[0].strip()
            break
    if not win_idx:
        # claude 윈도우 (메인)
        if agent_id in ('ceo', 'claude', 'main'):
            win_idx = '0'
        else:
            return None, "에이전트 윈도우를 찾을 수 없습니다"

    pane_target = f"{session}:{win_idx}"
    pipe_file = f"/tmp/vc-term-{project_id}-{agent_id}.log"

    # 웹 터미널 크기에 맞게 tmux pane 리사이즈 (출력이 전폭으로 렌더링됨)
    if cols and cols > 0:
        subprocess.run(['tmux', 'resize-window', '-t', pane_target, '-x', str(cols)],
                       capture_output=True, timeout=2)
    if rows and rows > 0:
        subprocess.run(['tmux', 'resize-window', '-t', pane_target, '-y', str(rows)],
                       capture_output=True, timeout=2)

    # 기존 pipe 해제
    subprocess.run(['tmux', 'pipe-pane', '-t', pane_target], capture_output=True, timeout=2)

    # 새 pipe 시작 (-o: output only)
    subprocess.run(['tmux', 'pipe-pane', '-o', '-t', pane_target, f'cat >> {pipe_file}'],
                   capture_output=True, timeout=2)

    # 스크롤백 캡처 (최근 500줄, ANSI 포함)
    result = subprocess.run(
        ['tmux', 'capture-pane', '-t', pane_target, '-p', '-e', '-S', '-500'],
        capture_output=True, text=True, timeout=5
    )
    scrollback = result.stdout if result.returncode == 0 else ""
    # 후행 빈 줄 제거 (capture-pane이 커서 아래 빈 영역까지 포함)
    scrollback = scrollback.rstrip('\n') + '\n' if scrollback.strip() else ""
    # xterm.js Canvas 렌더러는 \r\n 필요 (\n만 있으면 렌더링 안 됨)
    scrollback = scrollback.replace('\n', '\r\n')

    # 세션 등록
    key = f"{project_id}:{agent_id}"
    with TERMINAL_LOCK:
        # pipe_file 초기 오프셋 = 현재 파일 크기
        initial_offset = os.path.getsize(pipe_file) if os.path.exists(pipe_file) else 0
        TERMINAL_SESSIONS[key] = {"pipe_file": pipe_file, "pane_target": pane_target}

    return {"scrollback": scrollback, "offset": initial_offset}, None

def _terminal_read(project_id, agent_id, since=0):
    """pipe-pane 출력에서 since 이후 새 내용 반환"""
    key = f"{project_id}:{agent_id}"
    with TERMINAL_LOCK:
        session = TERMINAL_SESSIONS.get(key)
    if not session:
        return None, "터미널 세션이 열려있지 않습니다"

    pipe_file = session["pipe_file"]
    if not os.path.exists(pipe_file):
        return {"data": "", "offset": since}, None

    size = os.path.getsize(pipe_file)
    if size <= since:
        return {"data": "", "offset": since}, None

    with open(pipe_file, 'rb') as f:
        f.seek(since)
        data = f.read()

    # 바이너리를 UTF-8로 디코딩 (ANSI escape 포함)
    try:
        text = data.decode('utf-8', errors='replace')
    except Exception:
        text = data.decode('latin-1')

    return {"data": text, "offset": size}, None

def _terminal_close(project_id, agent_id):
    """pipe-pane 해제 (파일은 유지 — 다시 열 때 이어서 읽기)"""
    key = f"{project_id}:{agent_id}"
    with TERMINAL_LOCK:
        session = TERMINAL_SESSIONS.pop(key, None)
    if not session:
        return

    # pipe-pane만 해제 (파일은 삭제하지 않음 — 재오픈 시 offset으로 이어서 읽기)
    subprocess.run(['tmux', 'pipe-pane', '-t', session["pane_target"]],
                   capture_output=True, timeout=2)

def read_projects():
    """등록된 프로젝트 목록 반환 (tmux 세션 상태 포함)."""
    if not os.path.exists(PROJECTS_REGISTRY):
        return []
    try:
        with open(PROJECTS_REGISTRY) as f:
            projects = json.load(f).get("projects", [])
        # 각 프로젝트에 활성 상태 추가
        for p in projects:
            p["active"] = _check_tmux_session(p["id"])
        return projects
    except Exception:
        return []

def register_project(project_id, project_path):
    """프로젝트를 글로벌 레지스트리에 등록 (기존 동일 ID는 덮어씀)."""
    os.makedirs(os.path.dirname(PROJECTS_REGISTRY), exist_ok=True)
    projects = read_projects()
    projects = [p for p in projects if p["id"] != project_id]
    projects.append({
        "id": project_id,
        "path": project_path,
        "registered_at": time.strftime('%Y-%m-%dT%H:%M:%S'),
    })
    with open(PROJECTS_REGISTRY, 'w') as f:
        json.dump({"projects": projects}, f, ensure_ascii=False, indent=2)

def get_project_company_dir(project_id):
    """프로젝트 ID → .claude/company 디렉토리 경로 (없으면 None)."""
    for p in read_projects():
        if p["id"] == project_id:
            company_dir = os.path.join(p["path"], ".claude", "company")
            if os.path.isdir(company_dir):
                return company_dir
    return None

def get_project_agents_dir(project_id):
    """프로젝트 ID → .claude/agents 디렉토리 경로 (없으면 None)."""
    for p in read_projects():
        if p["id"] == project_id:
            agents_dir = os.path.join(p["path"], ".claude", "agents")
            if os.path.isdir(agents_dir):
                return agents_dir
    return None

def get_project_workflows_dir(project_id):
    """프로젝트 ID → .claude/workflows 디렉토리 경로 (없으면 None)."""
    for p in read_projects():
        if p["id"] == project_id:
            wf_dir = os.path.join(p["path"], ".claude", "workflows")
            if os.path.isdir(wf_dir):
                return wf_dir
    return None

def get_project_root(project_id):
    """프로젝트 ID → 프로젝트 루트 경로 (없으면 None)."""
    for p in read_projects():
        if p["id"] == project_id:
            return p["path"]
    return None

# 활성 터미널 세션 관리
# key: "{project_id}:{agent_id}", value: {"pipe_file": "/tmp/vc-term-...", "pane_target": "..."}
TERMINAL_SESSIONS = {}
TERMINAL_LOCK = threading.Lock()

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

# ━━━ Data readers (프로젝트별 디렉토리 지원) ━━━

def _read_config_for_project(company_dir):
    """지정된 company_dir의 config.json 읽기."""
    config_path = os.path.join(company_dir, 'config.json')
    if not os.path.exists(config_path):
        return {}
    with open(config_path) as f:
        return json.load(f)

def _read_config_raw():
    return _read_config_for_project(COMPANY_DIR)

def read_config(company_dir=None):
    if company_dir and company_dir != COMPANY_DIR:
        return _read_config_for_project(company_dir)
    return cached("config", 2, _read_config_raw)

def _read_activity_for_project(company_dir, lines=50):
    """지정된 company_dir의 activity.log에서 최근 N줄 + 파싱."""
    activity_log = os.path.join(company_dir, 'activity.log')
    if not os.path.exists(activity_log):
        return []
    with open(activity_log) as f:
        all_lines = f.readlines()
    entries = []
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

def read_activity(lines=50, company_dir=None):
    """activity.log에서 최근 N줄 + 파싱 (호환성: company_dir=None → 기본 COMPANY_DIR)."""
    return _read_activity_for_project(company_dir or COMPANY_DIR, lines)

def _read_agent_states_for_project(company_dir, agents_dir=None):
    """지정된 디렉토리에서 에이전트별 최신 상태 추출."""
    if agents_dir is None:
        agents_dir = os.path.join(os.path.dirname(company_dir), 'agents')
    if os.path.isdir(agents_dir):
        agents = [os.path.splitext(f)[0] for f in sorted(os.listdir(agents_dir)) if f.endswith('.md')]
    else:
        config = _read_config_for_project(company_dir)
        agents = config.get('agents', [])
    states = {}
    for aid in agents:
        states[aid] = {"id": aid, "state": "idle", "last_message": "", "timestamp": ""}

    # 1. activity.log 기반 상태
    activity_log = os.path.join(company_dir, 'activity.log')
    if os.path.exists(activity_log):
        with open(activity_log) as f:
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
                        ts_match = re.match(r'\[([^\]]+)\]', line)
                        if ts_match:
                            states[aid]["timestamp"] = ts_match.group(1)
                        states[aid]["last_message"] = line

    # 2. tmux 세션 기반 상태 보강 (activity.log가 비어있어도 세션이 있으면 active)
    config = _read_config_for_project(company_dir)
    project_id = config.get("project", "")
    if project_id and _check_tmux_session(project_id):
        windows = _get_tmux_windows(f"vc-{project_id}")
        # 윈도우 이름 → agent_id 역매핑
        label_to_id = {}
        for aid in agents:
            label_to_id[_agent_short_label(aid)] = aid
        for w in windows:
            parts = w.split(':')
            if len(parts) == 2:
                win_label = parts[1].strip()
                aid = label_to_id.get(win_label)
                if aid and states[aid]["state"] == "idle":
                    states[aid]["state"] = "active"
                    states[aid]["last_message"] = f"tmux window: {w}"

    return list(states.values())

def _read_agent_states_raw():
    return _read_agent_states_for_project(COMPANY_DIR, AGENTS_DIR)

def read_agent_states(company_dir=None, agents_dir=None):
    if company_dir and company_dir != COMPANY_DIR:
        return _read_agent_states_for_project(company_dir, agents_dir)
    return cached("states", 1, _read_agent_states_raw)

def _read_agent_output_for_project(agent_id, company_dir, lines=30):
    """지정된 company_dir의 agent-output/{id}.log 읽기."""
    output_dir = os.path.join(company_dir, 'agent-output')
    path = os.path.join(output_dir, f"{agent_id}.log")
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        all_lines = f.readlines()
    return "".join(all_lines[-lines:])

def read_agent_output(agent_id, lines=30, company_dir=None):
    """agent-output/{id}.log에서 최근 내용 (호환성: company_dir=None → 기본)."""
    return _read_agent_output_for_project(agent_id, company_dir or COMPANY_DIR, lines)

def _read_agent_memory_for_project(agent_id, company_dir):
    """지정된 company_dir의 agent-memory/{id}.md 읽기."""
    memory_dir = os.path.join(company_dir, 'agent-memory')
    path = os.path.join(memory_dir, f"{agent_id}.md")
    if not os.path.exists(path):
        return ""
    with open(path) as f:
        return f.read()

def read_agent_memory(agent_id, company_dir=None):
    """agent-memory/{id}.md (호환성: company_dir=None → 기본)."""
    return _read_agent_memory_for_project(agent_id, company_dir or COMPANY_DIR)

# ━━━ SSE watchers ━━━

def _read_agents_full_for_project(agents_dir):
    """지정된 agents_dir의 에이전트 .md 파일 목록 (frontmatter + 본문)."""
    agents = []
    if not agents_dir or not os.path.isdir(agents_dir):
        return agents
    for f in sorted(os.listdir(agents_dir)):
        if not f.endswith('.md'):
            continue
        aid = os.path.splitext(f)[0]
        path = os.path.join(agents_dir, f)
        try:
            with open(path) as fh:
                content = fh.read()
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

def _read_agents_full_raw():
    return _read_agents_full_for_project(AGENTS_DIR)

def read_agents_full(agents_dir=None):
    if agents_dir and agents_dir != AGENTS_DIR:
        return _read_agents_full_for_project(agents_dir)
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

def _read_workflows_for_project(workflows_dir):
    """지정된 workflows_dir의 워크플로우 YAML 목록."""
    if not workflows_dir or not os.path.isdir(workflows_dir):
        return []
    workflows = []
    for f in sorted(os.listdir(workflows_dir)):
        if f.endswith('.yml') or f.endswith('.yaml'):
            path = os.path.join(workflows_dir, f)
            name = os.path.splitext(f)[0]
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

def _read_workflows_raw():
    return _read_workflows_for_project(WORKFLOWS_DIR)

def read_workflows(workflows_dir=None):
    if workflows_dir and workflows_dir != WORKFLOWS_DIR:
        return _read_workflows_for_project(workflows_dir)
    return cached("workflows", 10, _read_workflows_raw)

def _read_retrospectives_for_project(company_dir, limit=20):
    """지정된 company_dir의 회고 JSON 파일 목록 (최신순)."""
    retro_dir = os.path.join(company_dir, 'retrospectives')
    if not os.path.isdir(retro_dir):
        return []
    files = sorted(
        [f for f in os.listdir(retro_dir) if f.endswith('.json')],
        reverse=True
    )[:limit]
    retros = []
    for f in files:
        try:
            with open(os.path.join(retro_dir, f)) as fh:
                retros.append(json.load(fh))
        except Exception:
            pass
    return retros

def read_retrospectives(limit=20, company_dir=None):
    """회고 JSON 파일 목록 (호환성: company_dir=None → 기본)."""
    return _read_retrospectives_for_project(company_dir or COMPANY_DIR, limit)

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

        # ━━━ 글로벌 API (프로젝트 무관) ━━━
        if path == '/api/projects':
            self.send_json({"projects": read_projects()})
            return
        if path == '/api/token':
            client_ip = self.client_address[0]
            if client_ip not in ('127.0.0.1', '::1', 'localhost'):
                self.send_json({"error": "forbidden"}, 403)
                return
            self.send_json({"token": AUTH_TOKEN})
            return

        # ━━━ 프로젝트별 API: /api/{project_id}/{sub_path} ━━━
        project_match = re.match(r'^/api/([a-zA-Z0-9_-]+)/(.+)$', path)
        if project_match:
            project_id = project_match.group(1)
            sub_path = project_match.group(2)
            # 예약된 레거시 경로 제외 (agent/, workflow/ 등은 기존 라우트)
            if project_id not in ('agent', 'agents', 'workflow', 'workflows', 'retrospectives', 'state', 'activity', 'running', 'sse', 'token', 'projects', 'run', 'stop'):
                company_dir = get_project_company_dir(project_id)
                if not company_dir:
                    self.send_json({"error": f"project '{project_id}' not found"}, 404)
                    return
                self._handle_project_api(project_id, sub_path, company_dir)
                return

        # ━━━ 레거시 라우트 (기본 COMPANY_DIR, 하위 호환성) ━━━
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
            parts = path.split('/')
            name = parts[3] if len(parts) > 3 else ''
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
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
        elif path == '/api/retrospectives':
            self.send_json({"retrospectives": read_retrospectives()})
        elif path == '/api/running':
            with PROC_LOCK:
                data = dict(RUNNING_PROC)
            self.send_json(data)
        elif path == '/api/sse':
            self._handle_sse_for_dirs(COMPANY_DIR, AGENT_OUTPUT_DIR)
        elif path == '/' or path == '/index.html':
            self.serve_file('index.html')
        else:
            self.serve_file(path.lstrip('/'))

    # ━━━ 프로젝트별 GET API 핸들러 ━━━

    def _handle_project_api(self, project_id, sub_path, company_dir):
        """프로젝트 스코프 GET 요청 처리."""
        agents_dir = get_project_agents_dir(project_id)
        workflows_dir = get_project_workflows_dir(project_id)

        if sub_path == 'state':
            config = cached(f"{project_id}:config", 2,
                            lambda: _read_config_for_project(company_dir))
            agents = cached(f"{project_id}:states", 1,
                            lambda: _read_agent_states_for_project(company_dir, agents_dir))
            self.send_json({
                "project": config.get("project", "Company"),
                "tech_stack": config.get("tech_stack", ""),
                "agents": agents,
                "now": int(time.time()),
            })

        elif sub_path == 'activity':
            entries = _read_activity_for_project(company_dir)
            self.send_json({"entries": entries})

        elif sub_path == 'agents':
            agents = cached(f"{project_id}:agents_full", 5,
                            lambda: _read_agents_full_for_project(agents_dir))
            self.send_json({"agents": agents})

        elif sub_path == 'agents/global':
            self.send_json({"agents": read_global_agents()})

        elif sub_path == 'workflows':
            wfs = cached(f"{project_id}:workflows", 10,
                         lambda: _read_workflows_for_project(workflows_dir))
            self.send_json({"workflows": wfs})

        elif sub_path.startswith('workflow/'):
            name = sub_path.split('/', 1)[1] if '/' in sub_path else ''
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            if not workflows_dir:
                self.send_json({"ok": False, "error": "워크플로우 디렉토리 없음"}, 404)
                return
            wf_path = None
            for ext in ('.yml', '.yaml'):
                candidate = os.path.join(workflows_dir, f"{name}{ext}")
                if os.path.isfile(candidate):
                    wf_path = candidate
                    break
            if not wf_path:
                self.send_json({"ok": False, "error": "워크플로우를 찾을 수 없습니다"}, 404)
                return
            with open(wf_path, encoding='utf-8') as f:
                raw_yaml = f.read()
            self.send_json({"ok": True, "name": name, "content": raw_yaml})

        elif sub_path.startswith('agent/') and sub_path.endswith('/output'):
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            output = _read_agent_output_for_project(agent_id, company_dir)
            self.send_json({"output": output})

        elif sub_path.startswith('agent/') and sub_path.endswith('/memory'):
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            memory = _read_agent_memory_for_project(agent_id, company_dir)
            self.send_json({"memory": memory})

        elif sub_path.startswith('agent/') and sub_path.endswith('/content'):
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            agents = _read_agents_full_for_project(agents_dir)
            agent = next((a for a in agents if a['id'] == agent_id), None)
            self.send_json(agent or {"error": "not found"})

        elif sub_path == 'retrospectives':
            retros = _read_retrospectives_for_project(company_dir)
            self.send_json({"retrospectives": retros})

        elif sub_path == 'company/status':
            session_name = f"vc-{project_id}"
            active = _check_tmux_session(project_id)
            windows = _get_tmux_windows(session_name) if active else []
            self.send_json({
                "active": active,
                "session": session_name,
                "windows": windows,
            })

        elif sub_path == 'running':
            with PROC_LOCK:
                data = dict(RUNNING_PROC)
            self.send_json(data)

        elif sub_path == 'sse':
            agent_output_dir = os.path.join(company_dir, 'agent-output')
            self._handle_sse_for_dirs(company_dir, agent_output_dir)

        elif sub_path.startswith('terminal/'):
            # /api/{project}/terminal/{agent}/read?since=0
            parts = sub_path.split('/')  # ['terminal', agent_id, action]
            if len(parts) >= 3:
                agent_id = parts[1]
                action = parts[2]
                # agent_id 검증
                if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                    self.send_json({"error": "invalid agent id"}, 400)
                    return
                if action == 'read':
                    query = urlparse(self.path).query
                    since = int(parse_qs(query).get('since', ['0'])[0])
                    result, err = _terminal_read(project_id, agent_id, since)
                    if err:
                        self.send_json({"error": err}, 400)
                    else:
                        self.send_json(result)
                else:
                    self.send_json({"error": "unknown terminal action"}, 404)
            else:
                self.send_json({"error": "invalid terminal path"}, 400)

        else:
            self.send_json({"error": f"unknown sub-path: {sub_path}"}, 404)

    # ━━━ SSE (디렉토리 파라미터화) ━━━

    def _handle_sse_for_dirs(self, company_dir, agent_output_dir):
        """Server-Sent Events -- 지정 디렉토리의 activity.log + agent-output를 실시간 스트리밍."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()

        activity_log = os.path.join(company_dir, 'activity.log')
        activity_watcher = FileWatcher(activity_log)
        agent_watchers = {}
        config = _read_config_for_project(company_dir)
        for aid in config.get('agents', []):
            p = os.path.join(agent_output_dir, f"{aid}.log")
            agent_watchers[aid] = FileWatcher(p)

        last_config_check = time.time()
        try:
            while True:
                if time.time() - last_config_check > 10:
                    last_config_check = time.time()
                    config = _read_config_for_project(company_dir)
                    for aid in config.get('agents', []):
                        if aid not in agent_watchers:
                            p = os.path.join(agent_output_dir, f"{aid}.log")
                            agent_watchers[aid] = FileWatcher(p)

                new_activity = activity_watcher.get_new_content()
                if new_activity:
                    for line in new_activity.strip().split('\n'):
                        if line.strip():
                            event = json.dumps({"type": "activity", "data": line.strip()}, ensure_ascii=False)
                            self.wfile.write(f"data: {event}\n\n".encode())
                            self.wfile.flush()

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

        # ━━━ 글로벌 POST: 프로젝트 등록 ━━━
        if path == '/api/projects/register':
            pid = body.get('id', '').strip()
            ppath = body.get('path', '').strip()
            if not pid or not ppath:
                self.send_json({"ok": False, "error": "id와 path 필수"}, 400)
                return
            if not re.match(r'^[a-zA-Z0-9_-]+$', pid):
                self.send_json({"ok": False, "error": "ID는 영숫자, 하이픈, 언더스코어만 허용"}, 400)
                return
            if not os.path.isdir(ppath):
                self.send_json({"ok": False, "error": f"경로가 존재하지 않습니다: {ppath}"}, 400)
                return
            register_project(pid, ppath)
            self.send_json({"ok": True, "id": pid, "path": ppath})
            return

        # ━━━ 프로젝트별 POST: /api/{project_id}/{sub_path} ━━━
        project_match = re.match(r'^/api/([a-zA-Z0-9_-]+)/(.+)$', path)
        if project_match:
            project_id = project_match.group(1)
            sub_path = project_match.group(2)
            # 예약된 레거시 경로 제외
            if project_id not in ('run', 'workflow', 'workflows', 'agents', 'retrospectives', 'stop', 'projects'):
                company_dir = get_project_company_dir(project_id)
                if not company_dir:
                    self.send_json({"error": f"project '{project_id}' not found"}, 404)
                    return
                self._handle_project_post(project_id, sub_path, company_dir, body)
                return

        # ━━━ 레거시 POST 라우트 (하위 호환성) ━━━
        if path == '/api/run':
            task = body.get('task', '').strip()
            if not task:
                self.send_json({"ok": False, "error": "태스크를 입력하세요"}, 400)
                return
            result = run_company_task(task, mode='run')
            self.send_json(result)

        elif path == '/api/workflow':
            name = body.get('name', '').strip()
            input_text = body.get('input', '').strip()
            if not name:
                self.send_json({"ok": False, "error": "워크플로우를 선택하세요"}, 400)
                return
            task = f"{name} {input_text}".strip()
            result = run_company_task(task, mode='workflow')
            self.send_json(result)

        elif path == '/api/workflows/save':
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
            name = body.get('name', '').strip()
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
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
            role = body.get('role', '').strip()
            aid = body.get('id', '').strip()
            if not role:
                self.send_json({"ok": False, "error": "역할 설명을 입력하세요"}, 400)
                return
            if not aid:
                aid = re.sub(r'[^a-z0-9]+', '-', role.lower().strip())[:30].strip('-')
            content = generate_agent_with_ai(role, aid)
            if content and isinstance(content, str):
                self.send_json({"ok": True, "id": aid, "content": content})
            elif content and isinstance(content, dict) and "error" in content:
                self.send_json({"ok": False, "error": content["error"]})
            else:
                self.send_json({"ok": False, "error": "AI 생성 실패"})

        elif path == '/api/agents/delete':
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
            with PROC_LOCK:
                pid = RUNNING_PROC["pid"]
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
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

    # ━━━ 프로젝트별 POST API 핸들러 ━━━

    def _handle_project_post(self, project_id, sub_path, company_dir, body):
        """프로젝트 스코프 POST 요청 처리."""
        agents_dir = get_project_agents_dir(project_id)
        workflows_dir = get_project_workflows_dir(project_id)
        project_root = get_project_root(project_id)

        if sub_path == 'run':
            task = body.get('task', '').strip()
            if not task:
                self.send_json({"ok": False, "error": "태스크를 입력하세요"}, 400)
                return
            # 프로젝트 루트에서 실행
            result = run_company_task(task, mode='run')
            self.send_json(result)

        elif sub_path == 'workflow':
            name = body.get('name', '').strip()
            input_text = body.get('input', '').strip()
            if not name:
                self.send_json({"ok": False, "error": "워크플로우를 선택하세요"}, 400)
                return
            task = f"{name} {input_text}".strip()
            result = run_company_task(task, mode='workflow')
            self.send_json(result)

        elif sub_path == 'workflows/save':
            name = body.get('name', '').strip()
            content = body.get('content', '')
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            if not content:
                self.send_json({"ok": False, "error": "content가 비어있습니다"}, 400)
                return
            wf_dir = workflows_dir or os.path.join(os.path.dirname(company_dir), 'workflows')
            os.makedirs(wf_dir, exist_ok=True)
            wf_path = os.path.join(wf_dir, f"{name}.yml")
            with open(wf_path, 'w', encoding='utf-8') as f:
                f.write(content)
            invalidate_cache(f"{project_id}:workflows")
            self.send_json({"ok": True, "name": name})

        elif sub_path == 'workflows/delete':
            name = body.get('name', '').strip()
            if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
                self.send_json({"ok": False, "error": "잘못된 워크플로우 이름"}, 400)
                return
            if not workflows_dir:
                self.send_json({"ok": False, "error": "워크플로우 디렉토리 없음"}, 404)
                return
            deleted = False
            for ext in ('.yml', '.yaml'):
                candidate = os.path.join(workflows_dir, f"{name}{ext}")
                if os.path.isfile(candidate):
                    os.remove(candidate)
                    deleted = True
                    break
            if not deleted:
                self.send_json({"ok": False, "error": "워크플로우를 찾을 수 없습니다"}, 404)
                return
            invalidate_cache(f"{project_id}:workflows")
            self.send_json({"ok": True})

        elif sub_path == 'agents/save':
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
            # 프로젝트별 에이전트 저장
            target_agents_dir = agents_dir or os.path.join(os.path.dirname(company_dir), 'agents')
            if scope == 'both' or scope == 'global':
                save_agent(aid, content, 'global', color)
            # 로컬 저장
            os.makedirs(target_agents_dir, exist_ok=True)
            # 색상 주입
            if color and '---' in content:
                end = content.find('---', 3)
                if end != -1:
                    fm = content[3:end].strip()
                    fm_lines = [l for l in fm.split('\n') if not l.startswith('color:')]
                    fm_lines.append(f'color: {color}')
                    content = '---\n' + '\n'.join(fm_lines) + '\n---' + content[end+3:]
            path = os.path.join(target_agents_dir, f"{aid}.md")
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            # config.json 업데이트
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                agents_list = config.get('agents', [])
                if aid not in agents_list:
                    agents_list.append(aid)
                    config['agents'] = agents_list
                    with open(config_path, 'w', encoding='utf-8') as f:
                        json.dump(config, f, ensure_ascii=False, indent=2)
            invalidate_cache(f"{project_id}:agents_full")
            invalidate_cache(f"{project_id}:config")
            self.send_json({"ok": True, "id": aid})

        elif sub_path == 'agents/delete':
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
            if agents_dir:
                agent_path = os.path.join(agents_dir, f"{aid}.md")
                if os.path.exists(agent_path):
                    os.remove(agent_path)
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                agents_list = config.get('agents', [])
                if aid in agents_list:
                    agents_list.remove(aid)
                    config['agents'] = agents_list
                    with open(config_path, 'w', encoding='utf-8') as f:
                        json.dump(config, f, ensure_ascii=False, indent=2)
            invalidate_cache(f"{project_id}:agents_full")
            invalidate_cache(f"{project_id}:config")
            self.send_json({"ok": True})

        elif sub_path == 'agents/import':
            aid = body.get('id', '').strip()
            if not aid:
                self.send_json({"ok": False, "error": "ID 필요"}, 400)
                return
            if not re.match(r'^[a-z][a-z0-9-]*$', aid):
                self.send_json({"ok": False, "error": "잘못된 ID 형식"}, 400)
                return
            src = os.path.join(GLOBAL_AGENTS_DIR, f"{aid}.md")
            if not os.path.exists(src):
                self.send_json({"ok": False, "error": "글로벌 에이전트를 찾을 수 없습니다"})
                return
            with open(src) as f:
                content = f.read()
            target_agents_dir = agents_dir or os.path.join(os.path.dirname(company_dir), 'agents')
            os.makedirs(target_agents_dir, exist_ok=True)
            with open(os.path.join(target_agents_dir, f"{aid}.md"), 'w', encoding='utf-8') as f:
                f.write(content)
            invalidate_cache(f"{project_id}:agents_full")
            self.send_json({"ok": True, "id": aid})

        elif sub_path == 'agents/generate':
            role = body.get('role', '').strip()
            aid = body.get('id', '').strip()
            if not role:
                self.send_json({"ok": False, "error": "역할 설명을 입력하세요"}, 400)
                return
            if not aid:
                aid = re.sub(r'[^a-z0-9]+', '-', role.lower().strip())[:30].strip('-')
            content = generate_agent_with_ai(role, aid)
            if content and isinstance(content, str):
                self.send_json({"ok": True, "id": aid, "content": content})
            elif content and isinstance(content, dict) and "error" in content:
                self.send_json({"ok": False, "error": content["error"]})
            else:
                self.send_json({"ok": False, "error": "AI 생성 실패"})

        elif sub_path == 'workflows/generate':
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

        elif sub_path == 'retrospectives/save':
            if not body or not isinstance(body, dict):
                self.send_json({"ok": False, "error": "유효한 JSON 객체를 전송하세요"}, 400)
                return
            retro_dir = os.path.join(company_dir, 'retrospectives')
            os.makedirs(retro_dir, exist_ok=True)
            ts = int(time.time() * 1000)
            filename = f"retro-{ts}.json"
            filepath = os.path.join(retro_dir, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(body, f, ensure_ascii=False, indent=2)
            self.send_json({"ok": True, "file": filename})

        elif sub_path == 'company/start':
            result = _start_company_session(project_id)
            status_code = 200 if result.get("ok") else 409
            self.send_json(result, status_code)

        elif sub_path == 'company/stop':
            result = _stop_company_session(project_id)
            status_code = 200 if result.get("ok") else 500
            self.send_json(result, status_code)

        elif sub_path == 'stop':
            with PROC_LOCK:
                pid = RUNNING_PROC["pid"]
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
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

        elif sub_path.startswith('terminal/'):
            parts = sub_path.split('/')
            if len(parts) >= 3:
                agent_id = parts[1]
                action = parts[2]
                if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                    self.send_json({"ok": False, "error": "invalid agent id"}, 400)
                    return
                if action == 'open':
                    # POST body에서 cols/rows 읽기 (웹 터미널 크기)
                    t_cols = body.get('cols')
                    t_rows = body.get('rows')
                    result, err = _terminal_open(project_id, agent_id, cols=t_cols, rows=t_rows)
                    if err:
                        self.send_json({"ok": False, "error": err})
                    else:
                        self.send_json({"ok": True, **result})
                elif action == 'close':
                    _terminal_close(project_id, agent_id)
                    self.send_json({"ok": True})
                elif action == 'write':
                    # raw 터미널 입력 — strip 금지 (\r=Enter, \x7f=Backspace 등 제어문자 보존)
                    user_input = body.get('input', '')
                    if not user_input:
                        self.send_json({"ok": False, "error": "input required"}, 400)
                        return
                    if len(user_input) > 2000:
                        self.send_json({"ok": False, "error": "input too long"}, 400)
                        return
                    key = f"{project_id}:{agent_id}"
                    with TERMINAL_LOCK:
                        session = TERMINAL_SESSIONS.get(key)
                    if not session:
                        self.send_json({"ok": False, "error": "터미널이 열려있지 않습니다"})
                        return
                    user_input = user_input.replace('\x00', '')
                    # -l: 리터럴 텍스트 전송 (xterm onData의 raw 키 입력 그대로)
                    # Enter(\r), Backspace(\x7f), 방향키(\x1b[A) 등 모두 포함됨
                    subprocess.run(['tmux', 'send-keys', '-l', '-t', session["pane_target"], user_input],
                                  capture_output=True, timeout=2)
                    self.send_json({"ok": True})
                else:
                    self.send_json({"ok": False, "error": "unknown terminal action"}, 404)
            else:
                self.send_json({"ok": False, "error": "invalid terminal path"}, 400)

        else:
            self.send_json({"error": f"unknown POST sub-path: {sub_path}"}, 404)

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
