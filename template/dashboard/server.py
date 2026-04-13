#!/usr/bin/env python3
"""
Virtual Company v2 Dashboard Server (의존성 0)
- activity.log + agent-output/*.log 기반
- SSE(Server-Sent Events)로 실시간 스트리밍
- localhost:7777
"""
import os, sys, json, time, re, threading, subprocess, shlex, secrets, signal, shutil
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

def _is_admin_agent(agent_id, config):
    """에이전트가 관리자 권한인지 판별. orch/pm 또는 protected: true인 에이전트."""
    if not agent_id:
        return False
    if agent_id in ('orch', 'pm'):
        return True
    agents = config.get('agents', [])
    for a in agents:
        if isinstance(a, dict) and a.get('id') == agent_id:
            if a.get('protected', False):
                return True
    return False


def _is_qa_agent(agent_id, config):
    """에이전트가 QA 역할인지 판별. config의 agents 배열에서 'qa' 스킬 보유 또는 ID에 'qa' 포함."""
    if not agent_id:
        return False
    # ID 자체에 qa 포함 (fe-qa, be-qa 등)
    if 'qa' in agent_id.lower():
        return True
    # config agents에서 assigned_skills에 'qa' 또는 'qa-only' 포함 여부
    agents = config.get('agents', [])
    for a in agents:
        if isinstance(a, dict):
            if a.get('id') == agent_id:
                skills = a.get('assigned_skills', [])
                if 'qa' in skills or 'qa-only' in skills:
                    return True
        elif isinstance(a, str) and a == agent_id:
            # 문자열 에이전트는 기본 설정 — ID에 qa가 포함되는 경우 위에서 이미 처리
            break
    return False


def _validate_goal(company_dir, goal_id):
    """목표 ID의 존재 및 활성 상태를 검증. 경고 메시지 반환 (없으면 None)."""
    if not goal_id:
        return None
    goals_dir = os.path.join(company_dir, 'state', 'goals')
    goal_file = os.path.join(goals_dir, f"{goal_id}.json")
    if not os.path.exists(goal_file):
        return f"Goal not found: {goal_id}"
    try:
        with open(goal_file) as f:
            goal = json.load(f)
        if goal.get('status') != 'active':
            return f"Goal is not active: {goal_id}"
    except (json.JSONDecodeError, OSError):
        return f"Goal not found: {goal_id}"
    return None


def _log_rejected_attempt(company_dir, event_type, detail):
    """거부된 시도를 activity.jsonl에 기록."""
    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    entry = {
        "ts": now,
        "event": event_type,
        "data": detail,
    }
    try:
        with open(jsonl_path, 'a') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError:
        pass


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
    """tmux pipe-pane 시작 + 스크롤백 반환 + tmux pane 실제 크기 반환.

    웹 터미널은 tmux를 리사이즈하지 않음 — tmux 크기를 읽어서 xterm.js가 맞춤.
    이렇게 해야 실제 터미널(CLI)의 크기가 줄어들지 않음.
    """
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

    # ── tmux pane 실제 크기 읽기 (웹 터미널이 이 크기에 맞춤) ──
    pane_cols, pane_rows = 200, 50  # 기본값
    try:
        size_result = subprocess.run(
            ['tmux', 'display-message', '-t', pane_target, '-p', '#{pane_width} #{pane_height}'],
            capture_output=True, text=True, timeout=2
        )
        if size_result.returncode == 0:
            parts = size_result.stdout.strip().split()
            if len(parts) == 2:
                pane_cols, pane_rows = int(parts[0]), int(parts[1])
    except Exception:
        pass

    # ── window-size가 manual로 잠겨있으면 latest로 복원 (이전 버그 복구) ──
    try:
        ws_result = subprocess.run(
            ['tmux', 'show-window-option', '-t', pane_target, '-v', 'window-size'],
            capture_output=True, text=True, timeout=2
        )
        if ws_result.returncode == 0 and ws_result.stdout.strip() == 'manual':
            # 1) 세션 기본 크기로 리사이즈 (-A: 가장 큰 클라이언트에 맞춤)
            subprocess.run(['tmux', 'resize-window', '-t', pane_target, '-A'],
                           capture_output=True, timeout=2)
            # 2) resize-window가 manual을 다시 설정하므로, 반드시 그 후에 latest로 변경
            subprocess.run(['tmux', 'set-window-option', '-t', pane_target, 'window-size', 'latest'],
                           capture_output=True, timeout=2)
            # 복원 후 다시 읽기
            size_result = subprocess.run(
                ['tmux', 'display-message', '-t', pane_target, '-p', '#{pane_width} #{pane_height}'],
                capture_output=True, text=True, timeout=2
            )
            if size_result.returncode == 0:
                parts = size_result.stdout.strip().split()
                if len(parts) == 2:
                    pane_cols, pane_rows = int(parts[0]), int(parts[1])
    except Exception:
        pass

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

    return {"scrollback": scrollback, "offset": initial_offset, "cols": pane_cols, "rows": pane_rows}, None

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

_project_dir_cache = {}
_project_dir_cache_ts = 0

def get_project_company_dir(project_id):
    """프로젝트 ID → .claude/company 디렉토리 경로 (없으면 None). 10초 캐시."""
    global _project_dir_cache, _project_dir_cache_ts
    now = time.time()
    if now - _project_dir_cache_ts > 10:
        _project_dir_cache = {}
        for p in read_projects():
            cd = os.path.join(p["path"], ".claude", "company")
            if os.path.isdir(cd):
                _project_dir_cache[p["id"]] = cd
            # company_dir 필드 fallback
            elif p.get("company_dir") and os.path.isdir(p["company_dir"]):
                _project_dir_cache[p["id"]] = p["company_dir"]
        _project_dir_cache_ts = now
    return _project_dir_cache.get(project_id)

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

# ━━━ Document Management Helpers ━━━

def _safe_doc_id(value):
    """문서 ID 검증: 영숫자, 하이픈, 언더스코어만 허용. ../ 방지."""
    if not value or '..' in value or '/' in value or '\\' in value:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', value))

def _file_updated_at(filepath):
    """파일의 mtime을 ISO 형식으로 반환. 파일 없으면 None."""
    try:
        mtime = os.path.getmtime(filepath)
        return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(mtime))
    except OSError:
        return None

def _doc_path_for(company_dir, doc_type, doc_id):
    """type+id → 절대 파일 경로. 잘못된 type이면 None.
    company_dir = {project_root}/.claude/company
    """
    claude_dir = os.path.dirname(company_dir)          # {project_root}/.claude
    project_root = os.path.dirname(claude_dir)          # {project_root}
    if doc_type == 'project' and doc_id == 'CLAUDE':
        return os.path.normpath(os.path.join(project_root, 'CLAUDE.md'))
    elif doc_type == 'team':
        return os.path.normpath(os.path.join(company_dir, 'teams', doc_id, 'CLAUDE.md'))
    elif doc_type == 'agent':
        return os.path.normpath(os.path.join(claude_dir, 'agents', f'{doc_id}.md'))
    elif doc_type == 'rules':
        return os.path.normpath(os.path.join(claude_dir, 'rules', 'teams', f'{doc_id}.md'))
    return None

def _list_docs(company_dir):
    """관리 가능한 모든 문서 목록 반환.
    company_dir = {project_root}/.claude/company
    """
    docs = []
    config = _read_config_for_project(company_dir)
    claude_dir = os.path.dirname(company_dir)          # {project_root}/.claude
    project_root = os.path.dirname(claude_dir)          # {project_root}

    # 1) 프로젝트 CLAUDE.md
    project_claude = os.path.normpath(os.path.join(project_root, 'CLAUDE.md'))
    docs.append({
        "type": "project",
        "id": "CLAUDE",
        "path": "CLAUDE.md",
        "label": "프로젝트 CLAUDE.md",
        "updated_at": _file_updated_at(project_claude),
    })

    # 2) 팀 CLAUDE.md
    teams = config.get("teams", {})
    for team_id, team_info in teams.items():
        team_claude = os.path.normpath(os.path.join(company_dir, 'teams', team_id, 'CLAUDE.md'))
        label = team_info.get("label", team_id) if isinstance(team_info, dict) else team_id
        docs.append({
            "type": "team",
            "id": team_id,
            "path": f"teams/{team_id}/CLAUDE.md",
            "label": f"{label} CLAUDE.md",
            "updated_at": _file_updated_at(team_claude),
        })

    # 3) 에이전트 .md 파일
    agents = config.get("agents", [])
    agents_dir = os.path.normpath(os.path.join(claude_dir, 'agents'))
    for agent in agents:
        if isinstance(agent, dict):
            aid = agent.get("id", "")
            alabel = agent.get("label", aid)
        else:
            aid = str(agent)
            alabel = aid
        if not aid:
            continue
        agent_path = os.path.join(agents_dir, f'{aid}.md')
        docs.append({
            "type": "agent",
            "id": aid,
            "path": f"agents/{aid}.md",
            "label": alabel,
            "updated_at": _file_updated_at(agent_path),
        })

    # 4) 팀 규칙 파일
    rules_dir = os.path.normpath(os.path.join(claude_dir, 'rules', 'teams'))
    for team_id, team_info in teams.items():
        label = team_info.get("label", team_id) if isinstance(team_info, dict) else team_id
        rules_path = os.path.join(rules_dir, f'{team_id}.md')
        docs.append({
            "type": "rules",
            "id": team_id,
            "path": f".claude/rules/teams/{team_id}.md",
            "label": f"{label} 규칙",
            "updated_at": _file_updated_at(rules_path),
        })

    return docs

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


# ━━━ JSONL 활동 로그 (Phase 1A: 구조화된 이벤트) ━━━

def _append_activity_jsonl(company_dir, event):
    """구조화된 이벤트를 activity.jsonl에 추가."""
    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    if 'ts' not in event:
        event['ts'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with open(jsonl_path, 'a') as f:
        f.write(json.dumps(event, ensure_ascii=False) + '\n')

def _read_activity_jsonl(company_dir, limit=200, event_type=None, agent=None):
    """activity.jsonl에서 구조화된 이벤트 읽기 (필터 + 최근 N건)."""
    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    if not os.path.exists(jsonl_path):
        return []
    entries = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event_type and entry.get('event') != event_type:
                continue
            if agent and entry.get('agent') != agent:
                continue
            entries.append(entry)
    return entries[-limit:]


# ━━━ 에이전트 메모리 구조화 (Phase 1B) ━━━

def _parse_structured_memory(memory_text):
    """에이전트 메모리 .md를 섹션별로 파싱."""
    sections = {'learnings': [], 'patterns': [], 'self_assessment': {}, 'project_specific': [], 'raw': ''}
    if not memory_text or not memory_text.strip():
        return sections
    sections['raw'] = memory_text

    current_section = None
    for line in memory_text.split('\n'):
        stripped = line.strip()
        if stripped.startswith('## Learnings'):
            current_section = 'learnings'
        elif stripped.startswith('## Patterns'):
            current_section = 'patterns'
        elif stripped.startswith('## Self-Assessment'):
            current_section = 'self_assessment_lines'
        elif stripped.startswith('## Project-Specific'):
            current_section = 'project_specific'
        elif stripped.startswith('## '):
            current_section = None
        elif stripped.startswith('- ') and current_section in ('learnings', 'patterns', 'project_specific'):
            sections[current_section].append(stripped[2:])
        elif stripped.startswith('- ') and current_section == 'self_assessment_lines':
            key_val = stripped[2:].split(':', 1)
            if len(key_val) == 2:
                sections['self_assessment'][key_val[0].strip()] = key_val[1].strip()

    if 'self_assessment_lines' in sections:
        del sections['self_assessment_lines']
    return sections

def _append_agent_memory(company_dir, agent_id, section, entry):
    """에이전트 메모리 파일의 특정 섹션에 항목 추가."""
    memory_dir = os.path.join(company_dir, 'agent-memory')
    os.makedirs(memory_dir, exist_ok=True)
    memory_path = os.path.join(memory_dir, f'{agent_id}.md')

    # 기존 내용 읽기
    content = ''
    if os.path.exists(memory_path):
        with open(memory_path) as f:
            content = f.read()

    section_header = f'## {section}'
    if section_header not in content:
        # 섹션이 없으면 파일 끝에 추가
        content = content.rstrip('\n') + f'\n\n{section_header}\n- {entry}\n'
    else:
        # 섹션이 있으면 해당 섹션 끝에 추가
        lines = content.split('\n')
        result = []
        in_section = False
        inserted = False
        for i, line in enumerate(lines):
            if line.strip() == section_header:
                in_section = True
                result.append(line)
                continue
            if in_section and line.strip().startswith('## '):
                # 다음 섹션 시작 → 현재 섹션 끝에 삽입
                result.append(f'- {entry}')
                in_section = False
                inserted = True
            result.append(line)
        if in_section and not inserted:
            # 파일 끝까지 현재 섹션이면 마지막에 추가
            result.append(f'- {entry}')
        content = '\n'.join(result)

    with open(memory_path, 'w') as f:
        f.write(content)


# ━━━ 공유 지식 베이스 (Phase 1C) ━━━

def _read_shared_knowledge(company_dir, agent_id=None, limit=10):
    """공유 지식 읽기 (agent_id로 필터 시 relevant_agents에 포함된 것만)."""
    kb_path = os.path.join(company_dir, 'shared-knowledge.jsonl')
    if not os.path.exists(kb_path):
        return []
    entries = []
    with open(kb_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if agent_id and agent_id not in entry.get('relevant_agents', []):
                continue
            entries.append(entry)
    # confidence 내림차순 정렬 후 limit 적용
    entries.sort(key=lambda e: e.get('confidence', 0), reverse=True)
    return entries[:limit]

def _append_shared_knowledge(company_dir, entry):
    """공유 지식 추가."""
    kb_path = os.path.join(company_dir, 'shared-knowledge.jsonl')
    if 'ts' not in entry:
        entry['ts'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with open(kb_path, 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')


# ━━━ 성능 분석 (Phase 2) ━━━

def _compute_agent_scores(company_dir):
    """activity.jsonl에서 에이전트별 성과 스코어 계산."""
    entries = _read_activity_jsonl(company_dir, limit=1000)
    agents = {}
    for e in entries:
        aid = e.get('agent')
        if not aid:
            continue
        if aid not in agents:
            agents[aid] = {'total_tasks': 0, 'durations': [], 'errors': 0, 'quality_scores': []}

        if e.get('event') == 'agent_end':
            agents[aid]['total_tasks'] += 1
            if 'duration_sec' in e:
                agents[aid]['durations'].append(e['duration_sec'])
            if 'quality_self' in e:
                agents[aid]['quality_scores'].append(e['quality_self'])
        elif e.get('event') == 'agent_error':
            agents[aid]['errors'] += 1

    result = {}
    for aid, data in agents.items():
        total = data['total_tasks']
        result[aid] = {
            'total_tasks': total,
            'avg_duration_sec': round(sum(data['durations']) / len(data['durations']), 1) if data['durations'] else 0,
            'error_rate': round(data['errors'] / max(total, 1), 2),
            'avg_quality': round(sum(data['quality_scores']) / len(data['quality_scores']), 1) if data['quality_scores'] else 0,
            'trend': _compute_trend(data['quality_scores']),
        }
    return result

def _compute_trend(scores):
    """최근 5건 vs 이전 5건 비교로 트렌드 판단."""
    if len(scores) < 4:
        return 'insufficient_data'
    mid = len(scores) // 2
    old_avg = sum(scores[:mid]) / mid
    new_avg = sum(scores[mid:]) / (len(scores) - mid)
    if new_avg > old_avg + 0.3:
        return 'improving'
    elif new_avg < old_avg - 0.3:
        return 'declining'
    return 'stable'

def _compute_workflow_analysis(company_dir):
    """activity.jsonl에서 워크플로우별 병목 분석."""
    entries = _read_activity_jsonl(company_dir, limit=2000, event_type=None)
    workflows = {}
    # 워크플로우 실행 그룹핑
    for e in entries:
        wf = e.get('workflow')
        if not wf:
            continue
        if wf not in workflows:
            workflows[wf] = {'run_count': 0, 'steps': {}}
        if e.get('event') == 'workflow_end':
            workflows[wf]['run_count'] += 1
        if e.get('event') == 'agent_end' and e.get('step'):
            step = e['step']
            if step not in workflows[wf]['steps']:
                workflows[wf]['steps'][step] = []
            if 'duration_sec' in e:
                workflows[wf]['steps'][step].append(e['duration_sec'])

    result = {}
    for wf_name, data in workflows.items():
        avg_steps = {}
        bottleneck_step = None
        max_duration = 0
        for step, durations in data['steps'].items():
            avg = round(sum(durations) / len(durations), 1) if durations else 0
            avg_steps[step] = avg
            if avg > max_duration:
                max_duration = avg
                bottleneck_step = step
        result[wf_name] = {
            'run_count': max(data['run_count'], 1),
            'bottleneck_step': bottleneck_step,
            'avg_step_durations': avg_steps,
        }
    return result


def _compute_team_metrics(company_dir, config):
    """팀별 티켓 현황, 24시간 이벤트 수, 에이전트 수, WIP 사용률 계산."""
    teams_config = config.get('teams', {})
    wip_limits = config.get('wip_limits', {})
    per_team_limit = wip_limits.get('per_team', 999)

    # 에이전트 → 팀 매핑, 팀 → 에이전트 목록
    _, team_map = _parse_config_agents(config)
    team_agents = {}
    for aid, tid in team_map.items():
        if tid:
            team_agents.setdefault(tid, []).append(aid)

    # 모든 팀에 대해 빈 버킷 초기화 (config에 정의된 팀 포함)
    result = {}
    for tid in teams_config:
        result[tid] = {
            "tickets": {"backlog": 0, "todo": 0, "in_progress": 0, "review": 0, "done": 0},
            "events_24h": 0,
            "agents": len(team_agents.get(tid, [])),
            "wip_usage": f"0/{per_team_limit}",
        }

    # 티켓 상태 집계
    tickets_dir = os.path.join(company_dir, 'state', 'tickets')
    if os.path.isdir(tickets_dir):
        for fname in os.listdir(tickets_dir):
            if not fname.endswith('.json'):
                continue
            try:
                with open(os.path.join(tickets_dir, fname)) as fh:
                    ticket = json.load(fh)
                tid = ticket.get('team')
                if not tid or tid not in result:
                    continue
                status = ticket.get('status', 'backlog')
                if status in result[tid]["tickets"]:
                    result[tid]["tickets"][status] += 1
                else:
                    result[tid]["tickets"][status] = result[tid]["tickets"].get(status, 0) + 1
            except (json.JSONDecodeError, OSError):
                pass

    # 24시간 이벤트 수 (activity.jsonl)
    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    if os.path.exists(jsonl_path):
        from datetime import datetime, timezone, timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        cutoff_iso = cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')

        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = ev.get('ts', '')
                if ts < cutoff_iso:
                    continue
                agent = ev.get('agent', '')
                tid = team_map.get(agent)
                if tid and tid in result:
                    result[tid]["events_24h"] += 1

    # WIP 사용률 (in_progress 티켓 수 / per_team_limit)
    for tid in result:
        in_progress = result[tid]["tickets"].get("in_progress", 0)
        result[tid]["wip_usage"] = f"{in_progress}/{per_team_limit}"

    return result


# ━━━ 스킬 관리 (Phase 3) ━━━

GLOBAL_SKILLS_DIR = os.path.expanduser('~/.claude/skills')

def _load_skill_index(company_dir=None):
    """skill-index.json에서 스킬별 keywords 로드. {name: keywords[]} 맵 반환."""
    index_map = {}
    paths_to_try = []
    if company_dir:
        paths_to_try.append(os.path.join(company_dir, 'skill-index.json'))
    paths_to_try.append(os.path.join(COMPANY_DIR, 'skill-index.json'))
    for p in paths_to_try:
        if os.path.isfile(p):
            try:
                with open(p) as f:
                    entries = json.load(f)
                for entry in entries:
                    if isinstance(entry, dict) and 'name' in entry:
                        index_map[entry['name']] = entry.get('keywords', [])
                return index_map
            except Exception:
                pass
    return index_map

SKILL_CATEGORIES = {
    "개발": {"careful", "code-review-expert", "codex", "freeze", "unfreeze", "guard", "benchmark"},
    "디자인": {"design-consultation", "design-shotgun", "design-html", "design-review", "frontend-design", "algorithmic-art", "canvas-design", "theme-factory", "brand-guidelines"},
    "QA/테스트": {"browse", "canary", "connect-chrome", "investigate", "qa", "qa-only", "setup-browser-cookies", "webapp-testing"},
    "기획/관리": {"autoplan", "checkpoint", "learn", "office-hours", "plan-ceo-review", "plan-design-review", "plan-eng-review", "retro"},
    "배포/인프라": {"health", "land-and-deploy", "setup-deploy", "ship"},
    "보안/리뷰": {"review", "cso", "debate", "discussion"},
    "문서/기타": {"document-release", "make-company"},
}

def _auto_categorize(skill_name):
    """스킬 이름으로 역할 기반 카테고리 자동 분류."""
    for cat, names in SKILL_CATEGORIES.items():
        if skill_name in names:
            return cat
    return "기타"

def _scan_installed_skills(company_dir=None):
    """~/.claude/skills/ 에서 설치된 스킬 목록 스캔. skill-index.json의 keywords도 병합."""
    skills = []
    if not os.path.isdir(GLOBAL_SKILLS_DIR):
        return skills
    # skill-index.json에서 keywords 로드
    keyword_map = _load_skill_index(company_dir)
    for name in sorted(os.listdir(GLOBAL_SKILLS_DIR)):
        skill_dir = os.path.join(GLOBAL_SKILLS_DIR, name)
        # SKILL.md 찾기 (직접 또는 서브디렉토리)
        skill_md = None
        if os.path.isfile(skill_dir):
            # symlink to SKILL.md
            if name.endswith('.md') or os.path.islink(skill_dir):
                skill_md = skill_dir
                name = name.replace('.md', '').replace('SKILL', '')
        elif os.path.isdir(skill_dir):
            candidate = os.path.join(skill_dir, 'SKILL.md')
            if os.path.exists(candidate):
                skill_md = candidate

        if not skill_md or not os.path.exists(skill_md):
            continue

        # 프론트매터 파싱
        meta = {'name': name, 'description': '', 'category': 'general'}
        try:
            with open(skill_md) as f:
                content = f.read(2000)  # 프론트매터만 읽기
            if content.startswith('---'):
                end = content.find('---', 3)
                if end > 0:
                    fm = content[3:end]
                    for line in fm.split('\n'):
                        if ':' in line:
                            k, v = line.split(':', 1)
                            k, v = k.strip(), v.strip().strip('"').strip("'")
                            if k == 'name':
                                meta['name'] = v
                            elif k == 'description':
                                meta['description'] = v[:200]
                            elif k == 'category':
                                meta['category'] = v
        except Exception:
            pass

        # 카테고리가 비어있거나 기본값이면 자동 분류
        if not meta['category'] or meta['category'] in ('', 'general'):
            meta['category'] = _auto_categorize(name)

        meta['path'] = skill_md
        meta['is_symlink'] = os.path.islink(skill_dir) or os.path.islink(skill_md)
        # skill-index.json에서 keywords 병합
        meta['keywords'] = keyword_map.get(name, [])
        skills.append(meta)
    return skills

def _read_skill_usage(company_dir, limit=500):
    """skill-usage.jsonl 읽기."""
    path = os.path.join(company_dir, 'analytics', 'skill-usage.jsonl')
    if not os.path.exists(path):
        return []
    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries[-limit:]

def _append_skill_usage(company_dir, entry):
    """스킬 사용 기록 추가."""
    analytics_dir = os.path.join(company_dir, 'analytics')
    os.makedirs(analytics_dir, exist_ok=True)
    path = os.path.join(analytics_dir, 'skill-usage.jsonl')
    if 'ts' not in entry:
        entry['ts'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with open(path, 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')


def _check_skill_compliance(company_dir, ticket_id, ticket_type, current_status, config):
    """strict 모드에서 현재 단계의 필수 스킬 완료 여부 확인.

    Returns:
        (compliant: bool, missing_skills: list[str])
    """
    enforcement = config.get('skill_enforcement', 'advisory')
    if enforcement != 'strict':
        return True, []

    step_skills = config.get('step_skills', {})
    required = step_skills.get(ticket_type, {}).get(current_status, [])
    if not required:
        return True, []

    # skill-usage.jsonl에서 해당 티켓의 SKILL_DONE 수집
    usage_entries = _read_skill_usage(company_dir, limit=1000)
    done_skills = set()
    for entry in usage_entries:
        if entry.get('ticket') == ticket_id:
            for sk in entry.get('done', []):
                done_skills.add(sk)

    missing = [s for s in required if s not in done_skills]
    return len(missing) == 0, missing


# ━━━ 도구 프로필 (Phase 4) ━━━

def _read_tool_profiles(company_dir):
    """에이전트별 도구 프로필 읽기."""
    path = os.path.join(company_dir, 'tool-profiles.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def _write_tool_profiles(company_dir, profiles):
    """에이전트별 도구 프로필 저장."""
    path = os.path.join(company_dir, 'tool-profiles.json')
    with open(path, 'w') as f:
        json.dump(profiles, f, indent=2, ensure_ascii=False)


# ━━━ 스킬 개인화 (Phase 5C-4) ━━━

def _read_skill_overrides(company_dir):
    """프로젝트별 스킬 오버라이드 설정 읽기."""
    path = os.path.join(company_dir, 'skill-overrides.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def _write_skill_overrides(company_dir, overrides):
    """프로젝트별 스킬 오버라이드 저장."""
    path = os.path.join(company_dir, 'skill-overrides.json')
    with open(path, 'w') as f:
        json.dump(overrides, f, indent=2, ensure_ascii=False)


# ━━━ 회고 (Phase 1B) ━━━

def _read_retrospectives(company_dir, limit=20):
    """회고 JSON 파일 목록 읽기."""
    retro_dir = os.path.join(company_dir, 'retrospectives')
    if not os.path.isdir(retro_dir):
        return []
    retros = []
    for fname in sorted(os.listdir(retro_dir), reverse=True):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(retro_dir, fname)) as f:
                retros.append(json.load(f))
        except (json.JSONDecodeError, OSError):
            continue
        if len(retros) >= limit:
            break
    return retros


# ━━━ 자기개선 (Phase 6) ━━━

def _read_improvements(company_dir, limit=10):
    """개선 권고 JSON 파일 목록 읽기."""
    imp_dir = os.path.join(company_dir, 'improvements')
    if not os.path.isdir(imp_dir):
        return []
    improvements = []
    for fname in sorted(os.listdir(imp_dir), reverse=True):
        if not fname.endswith('.json'):
            continue
        try:
            with open(os.path.join(imp_dir, fname)) as f:
                improvements.append(json.load(f))
        except (json.JSONDecodeError, OSError):
            continue
        if len(improvements) >= limit:
            break
    return improvements


# ━━━ 코드 레벨 하네스 (Anthropic 패턴) ━━━

def _harness_health_check(company_dir, project_id):
    """프로젝트 건강 체크 — 에이전트가 작업 전 환경 상태를 확인.
    Anthropic 패턴: init.sh → 기본 테스트 → 작업 시작"""
    checks = {}

    # 1. tmux 세션 상태
    checks['tmux_active'] = _check_tmux_session(project_id)
    if checks['tmux_active']:
        session_name = f"vc-{project_id}"
        windows = _get_tmux_windows(session_name)
        checks['tmux_windows'] = len(windows)
    else:
        checks['tmux_windows'] = 0

    # 2. config.json 존재 + 파싱 가능
    config_path = os.path.join(company_dir, 'config.json')
    checks['config_valid'] = os.path.exists(config_path)
    if checks['config_valid']:
        try:
            with open(config_path) as f:
                config = json.load(f)
            checks['project_name'] = config.get('project', '')
            checks['agent_count'] = len(config.get('agents', []))
        except (json.JSONDecodeError, OSError):
            checks['config_valid'] = False

    # 3. 에이전트 .md 파일 존재
    agents_dir = os.path.join(os.path.dirname(company_dir), 'agents')
    if os.path.isdir(agents_dir):
        agent_files = [f for f in os.listdir(agents_dir) if f.endswith('.md')]
        checks['agent_files'] = len(agent_files)
    else:
        checks['agent_files'] = 0

    # 4. 디렉토리 구조 완전성
    required_dirs = ['agent-memory', 'agent-output', 'retrospectives', 'analytics', 'improvements']
    missing = [d for d in required_dirs if not os.path.isdir(os.path.join(company_dir, d))]
    checks['missing_dirs'] = missing

    # 5. 최근 활동 (마지막 이벤트 시간)
    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    if os.path.exists(jsonl_path):
        try:
            with open(jsonl_path) as f:
                lines = f.readlines()
            if lines:
                last = json.loads(lines[-1].strip())
                checks['last_event'] = last.get('event', '')
                checks['last_event_ts'] = last.get('ts', '')
                checks['total_events'] = len(lines)
            else:
                checks['total_events'] = 0
        except Exception:
            checks['total_events'] = 0
    else:
        checks['total_events'] = 0

    # 6. 메모리 상태 (비어있지 않은 에이전트 수)
    mem_dir = os.path.join(company_dir, 'agent-memory')
    active_memories = 0
    if os.path.isdir(mem_dir):
        for f in os.listdir(mem_dir):
            fp = os.path.join(mem_dir, f)
            if f.endswith('.md') and os.path.getsize(fp) > 0:
                active_memories += 1
    checks['agents_with_memory'] = active_memories

    # 7. 회고 수
    retro_dir = os.path.join(company_dir, 'retrospectives')
    retro_count = 0
    if os.path.isdir(retro_dir):
        retro_count = len([f for f in os.listdir(retro_dir) if f.endswith('.json')])
    checks['retrospective_count'] = retro_count

    # 종합 점수 (0~100)
    score = 0
    if checks['config_valid']: score += 20
    if checks['agent_files'] > 0: score += 20
    if checks['tmux_active']: score += 20
    if not checks['missing_dirs']: score += 15
    if checks['agents_with_memory'] > 0: score += 15
    if checks['retrospective_count'] > 0: score += 10
    checks['health_score'] = score

    return checks


def _harness_generate_progress(company_dir):
    """진행 파일 자동 생성 — Anthropic의 claude-progress.txt 패턴.
    activity.jsonl에서 자동으로 현재 상태 요약을 생성."""
    entries = _read_activity_jsonl(company_dir, limit=500)
    if not entries:
        return {"summary": "아직 활동 기록 없음", "tasks": [], "agents": {}}

    # 태스크별 그룹핑
    tasks = {}
    for e in entries:
        tid = e.get('task_id')
        if not tid:
            continue
        if tid not in tasks:
            tasks[tid] = {'id': tid, 'events': [], 'status': 'unknown', 'agents': set()}
        tasks[tid]['events'].append(e)
        if e.get('agent'):
            tasks[tid]['agents'].add(e['agent'])
        if e.get('event') == 'task_end':
            tasks[tid]['status'] = 'completed'
        elif e.get('event') == 'task_start':
            tasks[tid]['status'] = 'in_progress'

    # 에이전트별 통계
    agent_stats = {}
    for e in entries:
        aid = e.get('agent')
        if not aid:
            continue
        if aid not in agent_stats:
            agent_stats[aid] = {'calls': 0, 'last_ts': '', 'last_event': ''}
        agent_stats[aid]['calls'] += 1
        agent_stats[aid]['last_ts'] = e.get('ts', '')
        agent_stats[aid]['last_event'] = e.get('event', '')

    # 최근 태스크 요약
    task_list = []
    for tid, data in sorted(tasks.items(), key=lambda x: x[1]['events'][-1].get('ts', ''), reverse=True)[:10]:
        task_list.append({
            'id': tid,
            'status': data['status'],
            'agents': list(data['agents']),
            'event_count': len(data['events']),
        })

    # 마지막 활동
    last = entries[-1] if entries else {}

    return {
        "summary": f"총 {len(entries)}개 이벤트, {len(tasks)}개 태스크, {len(agent_stats)}개 에이전트 활동",
        "last_activity": {"event": last.get('event', ''), "ts": last.get('ts', ''), "agent": last.get('agent', '')},
        "tasks": task_list,
        "agents": {k: v for k, v in agent_stats.items()},
    }


def _harness_task_checklist(company_dir):
    """미완료 태스크 체크리스트 — Anthropic의 feature_list.json 패턴.
    activity.jsonl에서 시작됐지만 완료 안 된 태스크 감지."""
    entries = _read_activity_jsonl(company_dir, limit=1000)

    started = {}   # task_id → start event
    ended = set()  # task_id set

    for e in entries:
        tid = e.get('task_id')
        if not tid:
            continue
        if e.get('event') == 'task_start':
            started[tid] = e
        elif e.get('event') == 'task_end':
            ended.add(tid)

    # 시작됐지만 끝나지 않은 태스크
    incomplete = []
    for tid, start_event in started.items():
        if tid not in ended:
            incomplete.append({
                'task_id': tid,
                'started_at': start_event.get('ts', ''),
                'task': start_event.get('task', tid),
                'status': 'incomplete',
            })

    # retro가 누락된 완료 태스크
    retro_saved = set()
    for e in entries:
        if e.get('event') == 'retro_saved':
            retro_saved.add(e.get('task_id', ''))

    missing_retro = []
    for tid in ended:
        if tid not in retro_saved:
            missing_retro.append(tid)

    return {
        "incomplete_tasks": incomplete,
        "completed_without_retro": missing_retro,
        "total_started": len(started),
        "total_completed": len(ended),
        "total_retros": len(retro_saved),
    }


def _harness_validate_output(company_dir, agent_id, output_text):
    """에이전트 출력 자동 검증 — 기본 품질 게이트.
    출력이 너무 짧거나 에러 패턴을 포함하면 경고."""
    issues = []

    if not output_text or len(output_text.strip()) < 20:
        issues.append({"type": "too_short", "severity": "high",
                       "message": f"{agent_id} 출력이 너무 짧음 ({len(output_text.strip())} chars)"})

    # 에러 패턴 감지
    error_patterns = ['Error:', 'Traceback', 'FAILED', 'undefined', 'null reference']
    for pattern in error_patterns:
        if pattern.lower() in output_text.lower():
            issues.append({"type": "error_pattern", "severity": "medium",
                           "message": f"{agent_id} 출력에 에러 패턴 '{pattern}' 감지"})
            break

    # TODO/FIXME 미해결 감지
    todo_count = output_text.lower().count('todo') + output_text.lower().count('fixme')
    if todo_count > 3:
        issues.append({"type": "unresolved_todos", "severity": "low",
                       "message": f"{agent_id} 출력에 TODO/FIXME {todo_count}건 — 미해결 작업 있음"})

    return {
        "valid": len([i for i in issues if i['severity'] == 'high']) == 0,
        "issues": issues,
        "char_count": len(output_text.strip()),
    }


def _harness_drift_check(company_dir):
    """모델 드리프트 감지 — Phil Schmid 패턴.
    50+ 이벤트 후 에이전트 행동 패턴 변화를 감지."""
    entries = _read_activity_jsonl(company_dir, limit=2000)
    if len(entries) < 20:
        return {"status": "insufficient_data", "events": len(entries)}

    # 에이전트별 시간대별 품질 분석
    agent_quality = {}
    for e in entries:
        if e.get('event') != 'agent_end' and e.get('event') != 'agent_end_harness':
            continue
        aid = e.get('agent', '')
        if not aid:
            continue
        if aid not in agent_quality:
            agent_quality[aid] = []
        agent_quality[aid].append({
            'ts': e.get('ts', ''),
            'duration': e.get('duration_sec', 0),
            'quality': e.get('quality_self', 0),
        })

    drifts = []
    for aid, records in agent_quality.items():
        if len(records) < 6:
            continue
        mid = len(records) // 2
        first_half = records[:mid]
        second_half = records[mid:]

        # 평균 duration 비교 (50% 이상 증가 = 드리프트)
        avg_dur_1 = sum(r['duration'] for r in first_half if r['duration']) / max(len([r for r in first_half if r['duration']]), 1)
        avg_dur_2 = sum(r['duration'] for r in second_half if r['duration']) / max(len([r for r in second_half if r['duration']]), 1)

        if avg_dur_1 > 0 and avg_dur_2 > avg_dur_1 * 1.5:
            drifts.append({
                "agent": aid,
                "type": "duration_increase",
                "message": f"{aid} 평균 소요시간 {avg_dur_1:.0f}s → {avg_dur_2:.0f}s ({((avg_dur_2/avg_dur_1)-1)*100:.0f}% 증가)",
                "severity": "medium",
            })

        # 품질 하락 감지
        quals_1 = [r['quality'] for r in first_half if r['quality']]
        quals_2 = [r['quality'] for r in second_half if r['quality']]
        if quals_1 and quals_2:
            avg_q1 = sum(quals_1) / len(quals_1)
            avg_q2 = sum(quals_2) / len(quals_2)
            if avg_q1 > 0 and avg_q2 < avg_q1 * 0.8:
                drifts.append({
                    "agent": aid,
                    "type": "quality_decline",
                    "message": f"{aid} 품질 점수 {avg_q1:.1f} → {avg_q2:.1f} (하락)",
                    "severity": "high",
                })

    return {
        "status": "drift_detected" if drifts else "stable",
        "drifts": drifts,
        "total_events": len(entries),
        "agents_analyzed": len(agent_quality),
    }


def _parse_csv(value):
    """Comma-separated string → list of stripped non-empty tokens."""
    if not value or not isinstance(value, str):
        return []
    return [s.strip() for s in value.split(',') if s.strip()]


def _harness_summary(company_dir):
    """activity.jsonl + config.json + skill-usage.jsonl 기반 하네스 요약.
    단일 패스로 이벤트를 집계하여 hooks/gates/skills/workflow 정보를 반환."""

    # --- 1. activity.jsonl 단일 패스 ---
    hooks = {
        "agent_harness": {"executions": 0, "last_run": None, "warnings": 0, "blocks": 0},
        "post_tool_use": {"executions": 0, "commits_tagged": 0, "auto_verifies": 0,
                          "auto_verify_pass": 0, "auto_verify_fail": 0},
        "ticket_context": {"executions": 0, "wip_warnings": 0, "goal_warnings": 0},
    }
    gates = {"total_checks": 0, "passed": 0, "rejected": 0, "recent": []}
    skills_agg = {
        "total_checks": 0, "compliant": 0, "missing": 0,
        "enforcement": "advisory", "by_agent": {},
    }

    jsonl_path = os.path.join(company_dir, 'activity.jsonl')
    if os.path.exists(jsonl_path):
        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue

                evt = ev.get('event', '')
                data = ev.get('data', {}) if isinstance(ev.get('data'), dict) else {}
                agent = ev.get('agent', '')
                ts = ev.get('ts')

                if evt == 'agent_start_harness':
                    hooks['agent_harness']['executions'] += 1
                    hooks['agent_harness']['last_run'] = ts

                elif evt == 'checkpoint_missing':
                    hooks['agent_harness']['warnings'] += 1

                elif evt == 'quality_gate_fail':
                    hooks['agent_harness']['warnings'] += 1
                    gates['total_checks'] += 1
                    gates['rejected'] += 1
                    _gate_recent_append(gates, ev, 'rejected')

                elif evt == 'skill_missing':
                    skills_agg['missing'] += 1
                    skills_agg['total_checks'] += 1
                    if agent:
                        by = skills_agg['by_agent'].setdefault(agent, {"missing": 0, "compliant": 0})
                        by['missing'] += 1
                        # Collect individual skill names from event data
                        for sk in _parse_csv(data.get('missing', '')):
                            by.setdefault('missing_skills', set()).add(sk)
                        for sk in _parse_csv(data.get('done', '')):
                            by.setdefault('compliant_skills', set()).add(sk)

                elif evt == 'skill_blocked':
                    hooks['agent_harness']['blocks'] += 1
                    skills_agg['missing'] += 1
                    skills_agg['total_checks'] += 1
                    if agent:
                        by = skills_agg['by_agent'].setdefault(agent, {"missing": 0, "compliant": 0})
                        by['missing'] += 1
                        # Collect blocked skill names from event data
                        for sk in _parse_csv(data.get('missing', '')):
                            by.setdefault('missing_skills', set()).add(sk)

                elif evt == 'file_modified':
                    hooks['post_tool_use']['executions'] += 1

                elif evt == 'auto_verify':
                    hooks['post_tool_use']['auto_verifies'] += 1
                    result = data.get('result', '')
                    if result == 'pass':
                        hooks['post_tool_use']['auto_verify_pass'] += 1
                    elif result == 'fail':
                        hooks['post_tool_use']['auto_verify_fail'] += 1

                elif evt == 'verify_passed_bypass_rejected':
                    gates['total_checks'] += 1
                    gates['rejected'] += 1
                    _gate_recent_append(gates, ev, 'rejected')

                elif evt == 'parent_done_blocked':
                    gates['total_checks'] += 1
                    gates['rejected'] += 1
                    _gate_recent_append(gates, ev, 'rejected')

                elif evt == 'ticket_context_injected':
                    hooks['ticket_context']['executions'] += 1

                elif evt == 'wip_limit_warning':
                    hooks['ticket_context']['wip_warnings'] += 1

                elif evt == 'goal_missing_warning':
                    hooks['ticket_context']['goal_warnings'] += 1

                elif evt == 'gate_passed':
                    gates['total_checks'] += 1
                    gates['passed'] += 1
                    _gate_recent_append(gates, ev, 'passed')

                elif evt == 'skill_compliant':
                    skills_agg['total_checks'] += 1
                    skills_agg['compliant'] += 1
                    if agent:
                        by = skills_agg['by_agent'].setdefault(agent, {"missing": 0, "compliant": 0})
                        by['compliant'] += 1
                        # Collect compliant skill names from event data
                        for sk in _parse_csv(data.get('done', '')):
                            by.setdefault('compliant_skills', set()).add(sk)

                elif evt == 'commit_tagged':
                    hooks['post_tool_use']['commits_tagged'] += 1

    # recent: 최근 10건만 유지 (역순 = 최신 먼저)
    gates['recent'] = gates['recent'][-10:][::-1]

    # --- 2. config.json → workflow 섹션 ---
    config = _read_config_for_project(company_dir)
    workflow_raw = config
    _wip_raw = workflow_raw.get('wip_limits', {})
    workflow = {
        "templates": workflow_raw.get('workflow_templates', {}),
        "gates": workflow_raw.get('quality_gates', {}),
        "wip_limits": {
            "global": _wip_raw.get('global', 999),
            "per_agent": _wip_raw.get('per_agent', 999),
            "per_team": _wip_raw.get('per_team', 999),
        },
        "step_skills": workflow_raw.get('step_skills', {}),
        "skill_enforcement": workflow_raw.get('skill_enforcement', 'advisory'),
        "critic_loop": workflow_raw.get('critic_loop', {}),
        "reporting": workflow_raw.get('reporting', {}),
    }
    skills_agg['enforcement'] = workflow.get('skill_enforcement', 'advisory')

    # --- 3. skill-usage.jsonl → compliant 보정 ---
    usage_entries = _read_skill_usage(company_dir, limit=5000)
    for entry in usage_entries:
        done_list = entry.get('done', [])
        if done_list:
            agent = entry.get('agent', '')
            skills_agg['compliant'] += len(done_list)
            skills_agg['total_checks'] += len(done_list)
            if agent:
                by = skills_agg['by_agent'].setdefault(agent, {"missing": 0, "compliant": 0})
                by['compliant'] += len(done_list)
                for sk in done_list:
                    if isinstance(sk, str) and sk.strip():
                        by.setdefault('compliant_skills', set()).add(sk.strip())

    # Convert skill name sets to sorted lists for JSON serialization
    for agent_data in skills_agg['by_agent'].values():
        agent_data['compliant_skills'] = sorted(agent_data.get('compliant_skills', set()))
        agent_data['missing_skills'] = sorted(agent_data.get('missing_skills', set()))

    return {
        "hooks": hooks,
        "gates": gates,
        "skills": skills_agg,
        "workflow": workflow,
    }


def _gate_recent_append(gates, ev, result):
    """gates['recent'] 리스트에 최근 게이트 이벤트 추가 (최대 10건 유지)."""
    data = ev.get('data', {}) if isinstance(ev.get('data'), dict) else {}
    gates['recent'].append({
        "ticket": ev.get('ticket') or data.get('ticket', ''),
        "gate": ev.get('event', ''),
        "result": result,
        "reason": data.get('reason', ''),
        "ts": ev.get('ts', ''),
    })


def _parse_config_agents(config):
    """config.json의 agents[]에서 ID 목록과 team 매핑을 추출. string/dict 배열 모두 처리."""
    agents_raw = config.get('agents', [])
    ids = []
    team_map = {}
    for a in agents_raw:
        if isinstance(a, dict):
            aid = a.get('id', '')
            if aid:
                ids.append(aid)
                team_map[aid] = a.get('team')
        else:
            aid = str(a)
            if aid:
                ids.append(aid)
    return ids, team_map

def _config_agents_contains(agents_raw, agent_id):
    """config.json agents[]에 해당 ID가 있는지 확인 (string/dict 모두 처리)."""
    for a in agents_raw:
        if isinstance(a, dict) and a.get('id') == agent_id:
            return True
        elif not isinstance(a, dict) and str(a) == agent_id:
            return True
    return False

def _config_agents_add(agents_raw, agent_id, team=None):
    """config.json agents[]에 structured object로 추가/업데이트. string 항목은 dict로 승격."""
    if _config_agents_contains(agents_raw, agent_id):
        for i, a in enumerate(agents_raw):
            if isinstance(a, dict) and a.get('id') == agent_id:
                if team is not None:
                    agents_raw[i]['team'] = team
                return agents_raw
            elif not isinstance(a, dict) and str(a) == agent_id:
                # string → dict 승격
                agents_raw[i] = {
                    "id": agent_id,
                    "engine": "claude",
                    "agent_file": agent_id,
                    "label": agent_id.replace('-', ' ').title(),
                    "team": team,
                    "protected": agent_id in ('ceo', 'orch'),
                    "assigned_skills": []
                }
                return agents_raw
        return agents_raw
    agents_raw.append({
        "id": agent_id,
        "engine": "claude",
        "agent_file": agent_id,
        "label": agent_id.replace('-', ' ').title(),
        "team": team,
        "protected": False,
        "assigned_skills": []
    })
    return agents_raw

def _config_agents_remove(agents_raw, agent_id):
    """config.json agents[]에서 제거 (string/dict 모두 처리)."""
    return [a for a in agents_raw
            if not (isinstance(a, dict) and a.get('id') == agent_id)
            and not (not isinstance(a, dict) and str(a) == agent_id)]

def _read_agent_states_for_project(company_dir, agents_dir=None):
    """지정된 디렉토리에서 에이전트별 최신 상태 추출. config.json agents[] 기준."""
    if agents_dir is None:
        agents_dir = os.path.join(os.path.dirname(company_dir), 'agents')
    config = _read_config_for_project(company_dir)
    agent_ids, team_map = _parse_config_agents(config)
    # config에 에이전트가 없으면 디렉토리 폴백
    if not agent_ids and os.path.isdir(agents_dir):
        agent_ids = [os.path.splitext(f)[0] for f in sorted(os.listdir(agents_dir)) if f.endswith('.md')]
    states = {}
    for aid in agent_ids:
        states[aid] = {"id": aid, "state": "idle", "last_message": "", "timestamp": "", "team": team_map.get(aid)}

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
    project_id = config.get("project", "")
    if project_id and _check_tmux_session(project_id):
        windows = _get_tmux_windows(f"vc-{project_id}")
        # 윈도우 이름 → agent_id 역매핑
        label_to_id = {}
        for aid in agent_ids:
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

def _parse_agent_md(path):
    """에이전트 .md 파일에서 frontmatter + 본문 파싱."""
    try:
        with open(path) as fh:
            content = fh.read()
        meta = {}
        if content.startswith('---'):
            end = content.find('---', 3)
            if end != -1:
                fm = content[3:end].strip()
                for line in fm.split('\n'):
                    if ':' in line and not line.startswith(' '):
                        k, _, v = line.partition(':')
                        meta[k.strip()] = v.strip()
        return content, meta
    except Exception:
        return None, {}

def _read_agents_full_for_project(agents_dir, company_dir=None):
    """config.json에 등록된 에이전트만 반환 (활성 에이전트). .md 파일에서 상세 정보 로드."""
    agents = []
    if not agents_dir:
        return agents
    # config 기준: 등록된 에이전트 ID + team 매핑
    config_ids = []
    team_map = {}
    if company_dir:
        config = _read_config_for_project(company_dir)
        config_ids, team_map = _parse_config_agents(config)
    # config에 에이전트가 없으면 디렉토리 폴백 (하위 호환)
    if not config_ids and os.path.isdir(agents_dir):
        config_ids = [os.path.splitext(f)[0] for f in sorted(os.listdir(agents_dir)) if f.endswith('.md')]
    for aid in config_ids:
        md_path = os.path.join(agents_dir, f"{aid}.md") if os.path.isdir(agents_dir) else None
        content, meta = (None, {})
        if md_path and os.path.exists(md_path):
            content, meta = _parse_agent_md(md_path)
        agents.append({
            "id": aid,
            "name": meta.get('name', aid),
            "description": meta.get('description', ''),
            "category": meta.get('category', ''),
            "color": meta.get('color', ''),
            "content": content or '',
            "is_global": os.path.exists(os.path.join(GLOBAL_AGENTS_DIR, f"{aid}.md")) if GLOBAL_AGENTS_DIR else False,
            "team": team_map.get(aid),
        })
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

def save_agent(agent_id, content, scope='local', color=None, team=None):
    """에이전트 .md 파일 저장 (local=프로젝트, global=글로벌)"""
    # 색상이 있으면 frontmatter에 주입
    if color and '---' in content:
        end = content.find('---', 3)
        if end != -1:
            fm = content[3:end].strip()
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

    # config.json에 structured object로 추가 (race condition 방지)
    with CONFIG_LOCK:
        config = read_config()
        agents = config.get('agents', [])
        agents = _config_agents_add(agents, agent_id, team)
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
    # claude CLI 존재 여부 확인
    if not shutil.which('claude'):
        return {"error": "claude CLI가 설치되지 않았습니다"}

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
        if result.returncode != 0:
            stderr = (result.stderr or '').strip()
            return {"error": f"생성 실패: {stderr[:300]}" if stderr else "claude CLI 실행에 실패했습니다"}
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
    # config.json에서 제거 (structured array 처리)
    with CONFIG_LOCK:
        config = read_config()
        agents = config.get('agents', [])
        config['agents'] = _config_agents_remove(agents, agent_id)
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

    # claude CLI 존재 여부 확인
    if not shutil.which('claude'):
        return {"ok": False, "error": "claude CLI가 설치되지 않았습니다"}

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
            stderr=subprocess.PIPE,
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
            stdout, stderr = proc.communicate()
            ts2 = time.strftime('%Y-%m-%d %H:%M:%S')
            status = '✅ 완료' if proc.returncode == 0 else f'❌ 실패 (code={proc.returncode})'
            with open(ACTIVITY_LOG, 'a') as f:
                f.write(f"[{ts2}] 🌐 대시보드 태스크 {status}\n")
                if proc.returncode != 0 and stderr:
                    f.write(f"[{ts2}] 🌐 stderr: {stderr.strip()[:300]}\n")
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
        return {"ok": False, "error": "claude CLI가 설치되지 않았습니다"}
    except Exception as e:
        return {"ok": False, "error": f"실행 실패: {str(e)}"}

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
        self.send_header('Access-Control-Allow-Origin', '*')
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
            if project_id not in ('agent', 'agents', 'workflow', 'workflows', 'retrospectives', 'state', 'activity', 'running', 'sse', 'token', 'projects', 'run', 'stop', 'analytics', 'improvements', 'skills', 'shared-knowledge', 'tools', 'terminal', 'company', 'tickets', 'goals', 'events', 'git', 'heartbeats', 'heartbeat', 'insights', 'orgchart'):
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
                "teams": config.get("teams", {}),
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
                "teams": config.get("teams", {}),
                "now": int(time.time()),
            })

        elif sub_path == 'teams':
            config = cached(f"{project_id}:config", 2,
                            lambda: _read_config_for_project(company_dir))
            self.send_json({"teams": config.get("teams", {})})

        elif sub_path == 'goals' or sub_path.startswith('goals/'):
            goals_dir = os.path.join(company_dir, 'state', 'goals')
            os.makedirs(goals_dir, exist_ok=True)
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')

            if sub_path == 'goals':
                # GET /api/{project}/goals — 목록 + 진행률 자동 계산
                goals = []
                for f in sorted(os.listdir(goals_dir)):
                    if not f.endswith('.json'): continue
                    try:
                        with open(os.path.join(goals_dir, f)) as fh:
                            g = json.load(fh)
                        # 진행률 계산: 하위 티켓 중 done 비율
                        ticket_ids = g.get('tickets', [])
                        if ticket_ids:
                            done_count = 0
                            for tid in ticket_ids:
                                tf = os.path.join(tickets_dir, f"{tid}.json")
                                if os.path.exists(tf):
                                    with open(tf) as th:
                                        t = json.load(th)
                                    if t.get('status') == 'done':
                                        done_count += 1
                            g['progress'] = done_count / len(ticket_ids)
                        else:
                            g['progress'] = 0
                        goals.append(g)
                    except: pass
                self.send_json({"goals": goals})
            else:
                goal_id = sub_path.split('/', 1)[1] if '/' in sub_path else ''
                goal_file = os.path.join(goals_dir, f"{goal_id}.json")
                if os.path.exists(goal_file):
                    with open(goal_file) as fh:
                        self.send_json(json.load(fh))
                else:
                    self.send_json({"error": "goal not found"}, 404)

        elif sub_path == 'tickets' or sub_path.startswith('tickets/'):
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            os.makedirs(tickets_dir, exist_ok=True)

            if sub_path == 'tickets':
                # GET /api/{project}/tickets — 전체 목록 (필터 지원)
                qs = dict(parse_qs(parsed.query)) if hasattr(self, '_parsed_qs') else {}
                # URL 쿼리 파싱
                from urllib.parse import parse_qs as _pqs
                _q = _pqs(urlparse(self.path).query)
                filter_status = _q.get('status', [None])[0]
                filter_team = _q.get('team', [None])[0]
                filter_assignee = _q.get('assignee', [None])[0]
                filter_agent = _q.get('agent', [None])[0]

                # agent 파라미터가 있으면 해당 에이전트의 팀도 조회 (visibility 필터용)
                _agent_team_for_vis = None
                if filter_agent:
                    _vis_config = _read_config_for_project(company_dir)
                    for _a in _vis_config.get('agents', []):
                        if isinstance(_a, dict) and _a.get('id') == filter_agent:
                            _agent_team_for_vis = _a.get('team') or None
                            break

                tickets = []
                for f in sorted(os.listdir(tickets_dir)):
                    if not f.endswith('.json'): continue
                    try:
                        with open(os.path.join(tickets_dir, f)) as fh:
                            t = json.load(fh)
                        if filter_status and t.get('status') != filter_status: continue
                        if filter_team and t.get('team') != filter_team: continue
                        if filter_assignee and t.get('assignee') != filter_assignee: continue
                        # visibility 필터: agent 파라미터가 있고 visibility가 설정된 경우
                        vis = t.get('visibility')
                        if filter_agent and vis is not None:
                            if filter_agent not in vis and (not _agent_team_for_vis or _agent_team_for_vis not in vis):
                                continue
                        tickets.append(t)
                    except: pass
                # 최신순 정렬
                tickets.sort(key=lambda t: t.get('updated_at', ''), reverse=True)
                self.send_json({"tickets": tickets})

            elif sub_path.endswith('/transitions'):
                # GET /api/{project}/tickets/{id}/transitions — 허용 전환 목록
                parts = sub_path.split('/')
                ticket_id = parts[1] if len(parts) >= 3 else ''
                ticket_file = os.path.join(tickets_dir, f"{ticket_id}.json")
                if not os.path.exists(ticket_file):
                    self.send_json({"error": "ticket not found"}, 404)
                    return
                with open(ticket_file) as fh:
                    ticket = json.load(fh)

                config = _read_config_for_project(company_dir)
                current_status = ticket.get('status', 'backlog')
                ticket_type = ticket.get('type', 'feature')
                completed = set(ticket.get('completed_steps', []))
                completed.add(current_status)

                # 워크플로 템플릿
                wf_templates = config.get('workflow_templates', {})
                wf = wf_templates.get(ticket_type, {})
                required_before = wf.get('required_before', {})

                # WIP 제한 사전 계산
                wip_limits = config.get('wip_limits', {})
                wip_global_limit = wip_limits.get('global', 999)
                wip_agent_limit = wip_limits.get('per_agent', 999)
                wip_team_limit = wip_limits.get('per_team', 999)
                wip_count = 0
                wip_agent_count = 0
                wip_team_count = 0
                assignee = ticket.get('assignee', '')
                team_id = ticket.get('team', '')
                for _f in os.listdir(tickets_dir):
                    if not _f.endswith('.json'):
                        continue
                    try:
                        with open(os.path.join(tickets_dir, _f)) as _fh:
                            _t = json.load(_fh)
                        if _t.get('status') == 'in_progress':
                            wip_count += 1
                            if assignee and _t.get('assignee') == assignee:
                                wip_agent_count += 1
                            if team_id and _t.get('team') == team_id:
                                wip_team_count += 1
                    except:
                        pass

                # 품질 게이트
                gates = config.get('quality_gates', {})

                # 미완료 자식 티켓
                blocked_children = []
                for child_id in ticket.get('children', []):
                    child_file = os.path.join(tickets_dir, f"{child_id}.json")
                    if os.path.exists(child_file):
                        try:
                            with open(child_file) as cfh:
                                child = json.load(cfh)
                            if child.get('status') != 'done':
                                blocked_children.append(f"{child_id} ({child.get('status', '?')})")
                        except:
                            pass

                # WIP 경고 문자열
                wip_warning = None
                if wip_limits and wip_global_limit < 999:
                    remaining = wip_global_limit - wip_count
                    if remaining <= 0:
                        wip_warning = f"WIP {wip_count}/{wip_global_limit} -- 한도 도달"
                    elif remaining <= 1:
                        wip_warning = f"WIP {wip_count}/{wip_global_limit} -- {remaining}개 여유"

                # 가능한 상태 목록 (전체 STATUSES)
                all_statuses = ['backlog', 'todo', 'in_progress', 'review', 'done']
                transitions = []
                for target in all_statuses:
                    if target == current_status:
                        continue
                    allowed = True
                    reason = None

                    # 1) 워크플로 required_before 체크
                    if target in required_before:
                        missing = [s for s in required_before[target] if s not in completed]
                        if missing:
                            allowed = False
                            reason = f"{', '.join(missing)} 단계를 먼저 완료해야 합니다"

                    # 2) WIP 제한 체크 (in_progress 전환 시, 현재 상태가 in_progress가 아닐 때)
                    if allowed and target == 'in_progress' and current_status != 'in_progress':
                        if wip_count >= wip_global_limit:
                            allowed = False
                            reason = f"전체 WIP 한도 초과 ({wip_count}/{wip_global_limit})"
                        elif assignee and wip_agent_count >= wip_agent_limit:
                            allowed = False
                            reason = f"에이전트 WIP 한도 초과 ({wip_agent_count}/{wip_agent_limit})"
                        elif team_id and wip_team_count >= wip_team_limit:
                            allowed = False
                            reason = f"팀 WIP 한도 초과 ({wip_team_count}/{wip_team_limit})"

                    # 3) 품질 게이트 체크
                    if allowed:
                        transition_key = f"{current_status} → {target}"
                        gate = gates.get(transition_key)
                        if gate:
                            criteria = gate.get('criteria', [])
                            auto_verify_cfg = config.get('auto_verify', {})
                            for c in criteria:
                                c_lower = c.lower()
                                gate_type = gate.get('gate_type', {}).get(c) if isinstance(gate.get('gate_type'), dict) else None
                                if gate_type == 'auto_verify' or (gate_type is None and ('자동 검증' in c_lower or 'auto' in c_lower or 'test' in c_lower)):
                                    if auto_verify_cfg.get('gate_integration') and ticket.get('verify_passed') is not True:
                                        allowed = False
                                        reason = f"품질 게이트: {c}"
                                        break
                                elif gate_type == 'acceptance_criteria' or (gate_type is None and ('ac' in c_lower or '완료 기준' in c_lower or 'acceptance' in c_lower)):
                                    if not ticket.get('acceptance_criteria'):
                                        allowed = False
                                        reason = f"품질 게이트: {c}"
                                        break
                                elif gate_type == 'reviewer_approval' or (gate_type is None and ('리뷰어' in c_lower or 'reviewer' in c_lower or 'approval' in c_lower)):
                                    qa_approved = False
                                    for act in ticket.get('activity', []):
                                        if _is_qa_agent(act.get('agent', ''), config):
                                            if act.get('action') in ('comment', 'approve', 'gate_approved', 'review_approved'):
                                                qa_approved = True
                                                break
                                    if not qa_approved:
                                        allowed = False
                                        reason = f"품질 게이트: {c}"
                                        break

                    # 4) done 전환 시 미완료 자식 체크
                    if allowed and target == 'done' and blocked_children:
                        allowed = False
                        reason = f"미완료 서브태스크: {', '.join(blocked_children[:3])}"

                    # 5) strict 모드: 현재 단계 필수 스킬 미완료 시 차단
                    if allowed and target != current_status:
                        _sk_ok, _sk_missing = _check_skill_compliance(
                            company_dir, ticket_id, ticket_type, current_status, config)
                        if not _sk_ok:
                            allowed = False
                            reason = f"필수 스킬 미완료: {', '.join(_sk_missing)}"

                    entry = {"status": target, "allowed": allowed}
                    if reason:
                        entry["reason"] = reason
                    transitions.append(entry)

                # strict 모드 skill compliance 요약 정보
                _enforcement_mode = config.get('skill_enforcement', 'advisory')
                _sk_compliant, _sk_missing_current = _check_skill_compliance(
                    company_dir, ticket_id, ticket_type, current_status, config)

                resp = {
                    "current": current_status,
                    "transitions": transitions,
                    "skill_enforcement": _enforcement_mode,
                }
                if not _sk_compliant:
                    resp["skill_compliance"] = {
                        "compliant": False,
                        "missing": _sk_missing_current,
                        "message": f"필수 스킬 미완료: {', '.join(_sk_missing_current)}"
                    }
                if wip_warning:
                    resp["wip_warning"] = wip_warning
                if blocked_children:
                    resp["blocked_children"] = blocked_children
                self.send_json(resp)

            else:
                # GET /api/{project}/tickets/{id} — 상세
                ticket_id = sub_path.split('/', 1)[1] if '/' in sub_path else ''
                ticket_file = os.path.join(tickets_dir, f"{ticket_id}.json")
                if os.path.exists(ticket_file):
                    with open(ticket_file) as fh:
                        self.send_json(json.load(fh))
                else:
                    self.send_json({"error": "ticket not found"}, 404)

        elif sub_path == 'flow':
            # 실시간 작업 흐름 DAG: channel/general.md에서 에이전트 간 메시지 흐름 추출
            channel_path = os.path.join(company_dir, 'channel', 'general.md')
            config = cached(f"{project_id}:config", 2,
                            lambda: _read_config_for_project(company_dir))
            config_ids, team_map = _parse_config_agents(config)
            agent_set = set(config_ids)
            teams_config = config.get('teams', {})

            nodes = {}  # agent_id → {id, team, state, label}
            edges = []  # [{source, target, timestamp, label}]
            agent_states = {}

            # activity.log에서 상태 추출
            activity_log = os.path.join(company_dir, 'activity.log')
            if os.path.exists(activity_log):
                with open(activity_log) as f:
                    for line in f:
                        for aid in agent_set:
                            if f'[{aid}]' in line:
                                if '🟢' in line: agent_states[aid] = 'working'
                                elif '✅' in line: agent_states[aid] = 'done'
                                elif '❌' in line: agent_states[aid] = 'error'

            # channel/general.md에서 sender→@mention 흐름 추출
            if os.path.exists(channel_path):
                with open(channel_path) as f:
                    content = f.read()
                current_sender = None
                current_ts = None
                for line in content.split('\n'):
                    # 헤더: --- [HH:MM:SS] SENDER ---
                    header = re.match(r'^---\s*\[(\d{2}:\d{2}:\d{2})\]\s+(\S+)\s*---', line)
                    if header:
                        current_ts = header.group(1)
                        current_sender = header.group(2).lower()
                        if current_sender in agent_set:
                            nodes[current_sender] = True
                        continue
                    # @mention 추출
                    if current_sender:
                        mentions = re.findall(r'@([a-z][a-z0-9_-]*)', line.lower())
                        for m in mentions:
                            if m in agent_set and m != current_sender:
                                nodes[current_sender] = True
                                nodes[m] = True
                                edges.append({
                                    "source": current_sender,
                                    "target": m,
                                    "timestamp": current_ts or "",
                                })

            # 노드 데이터 구성
            node_list = []
            for aid in nodes:
                team = team_map.get(aid)
                team_label = teams_config.get(team, {}).get('label', '') if team else ''
                # config에서 label 찾기
                label = aid
                for a in config.get('agents', []):
                    if isinstance(a, dict) and a.get('id') == aid:
                        label = a.get('label', aid)
                        break
                node_list.append({
                    "id": aid,
                    "label": label,
                    "team": team,
                    "teamLabel": team_label,
                    "state": agent_states.get(aid, "idle"),
                })

            # 중복 엣지 제거 (같은 source→target은 마지막 timestamp만)
            seen = {}
            for e in edges:
                key = f"{e['source']}→{e['target']}"
                seen[key] = e
            unique_edges = list(seen.values())

            self.send_json({
                "nodes": node_list,
                "edges": unique_edges,
            })

        elif sub_path == 'activity':
            entries = _read_activity_for_project(company_dir)
            self.send_json({"entries": entries})

        elif sub_path == 'events' or sub_path.startswith('events?'):
            # GET /api/{project}/events — 구조화된 JSONL 이벤트 조회
            from urllib.parse import parse_qs as _ev_pqs
            _ev_q = _ev_pqs(urlparse(self.path).query)
            limit = int(_ev_q.get('limit', ['100'])[0])
            event_type = _ev_q.get('event', [None])[0]
            agent_filter = _ev_q.get('agent', [None])[0]
            ticket_filter = _ev_q.get('ticket', [None])[0]

            jsonl_path = os.path.join(company_dir, 'activity.jsonl')
            events = []
            if os.path.exists(jsonl_path):
                with open(jsonl_path) as f:
                    for line in f:
                        line = line.strip()
                        if not line: continue
                        try:
                            ev = json.loads(line)
                            if event_type and ev.get('event') != event_type: continue
                            if agent_filter and ev.get('agent') != agent_filter: continue
                            if ticket_filter and ev.get('ticket') != ticket_filter: continue
                            events.append(ev)
                        except: pass
            # 최신순, limit 적용
            events = events[-limit:]
            events.reverse()
            self.send_json({"events": events, "total": len(events)})

        elif sub_path == 'git/log' or sub_path.startswith('git/log?'):
            # GET /api/{project}/git/log — 에이전트/티켓별 커밋 추적
            from urllib.parse import parse_qs as _git_pqs
            _git_q = _git_pqs(urlparse(self.path).query)
            limit = int(_git_q.get('limit', ['50'])[0])
            agent_filter = _git_q.get('agent', [None])[0]
            ticket_filter = _git_q.get('ticket', [None])[0]

            project_root = os.path.dirname(os.path.dirname(company_dir))
            commits = []
            try:
                import subprocess
                result = subprocess.run(
                    ['git', 'log', f'--max-count={limit * 2}', '--format=%H|%h|%an|%ai|%s'],
                    cwd=project_root, capture_output=True, text=True, timeout=10
                )
                for line in result.stdout.strip().split('\n'):
                    if not line: continue
                    parts = line.split('|', 4)
                    if len(parts) < 5: continue
                    full_hash, short_hash, author, date, message = parts

                    # [agent:xxx] [ticket:TASK-xxx] 태그 파싱
                    import re as _re
                    agent_match = _re.search(r'\[agent:([^\]]+)\]', message)
                    ticket_match = _re.search(r'\[ticket:([^\]]+)\]', message)
                    agent_tag = agent_match.group(1) if agent_match else None
                    ticket_tag = ticket_match.group(1) if ticket_match else None

                    if agent_filter and agent_tag != agent_filter: continue
                    if ticket_filter and ticket_tag != ticket_filter: continue

                    commits.append({
                        "hash": full_hash,
                        "short_hash": short_hash,
                        "author": author,
                        "date": date,
                        "message": message,
                        "agent": agent_tag,
                        "ticket": ticket_tag,
                    })
                    if len(commits) >= limit: break
            except Exception: pass
            self.send_json({"commits": commits})

        elif sub_path == 'orgchart':
            # GET /api/{project}/orgchart — 보고 구조 + 에이전트 상태 통합
            config = cached(f"{project_id}:config", 2,
                            lambda: _read_config_for_project(company_dir))
            reporting = config.get('reporting', {})
            config_ids, team_map = _parse_config_agents(config)
            teams_config = config.get('teams', {})

            # 에이전트 상태 가져오기
            states = cached(f"{project_id}:states", 1,
                            lambda: _read_agent_states_for_project(company_dir, agents_dir))
            state_map = {s['id']: s.get('state', 'idle') for s in states}

            # heartbeat 가져오기
            hb_dir = os.path.join(company_dir, 'state', 'heartbeats')
            heartbeats = {}
            if os.path.isdir(hb_dir):
                for f in os.listdir(hb_dir):
                    if f.endswith('.json'):
                        try:
                            with open(os.path.join(hb_dir, f)) as fh:
                                heartbeats[f[:-5]] = json.load(fh)
                        except: pass

            # 노드 생성
            nodes = []
            for aid in config_ids:
                rep = reporting.get(aid, {})
                team = team_map.get(aid)
                # config에서 label 찾기
                label = aid
                for a in config.get('agents', []):
                    if isinstance(a, dict) and a.get('id') == aid:
                        label = a.get('label', aid)
                        break
                nodes.append({
                    "id": aid,
                    "label": label,
                    "team": team,
                    "teamLabel": teams_config.get(team, {}).get('label', '') if team else '',
                    "state": state_map.get(aid, 'idle'),
                    "reports_to": rep.get('reports_to'),
                    "approves": rep.get('approves', []),
                    "heartbeat": heartbeats.get(aid),
                })

            # 엣지 (reports_to 관계)
            edges = []
            for n in nodes:
                if n['reports_to']:
                    edges.append({"source": n['reports_to'], "target": n['id'], "type": "reports_to"})

            self.send_json({"nodes": nodes, "edges": edges})

        elif sub_path == 'insights':
            # GET /api/{project}/insights — activity.jsonl 기반 병목 분석
            from datetime import datetime, timezone, timedelta
            jsonl_path = os.path.join(company_dir, 'activity.jsonl')
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            hb_dir = os.path.join(company_dir, 'state', 'heartbeats')

            events = []
            if os.path.exists(jsonl_path):
                with open(jsonl_path) as f:
                    for line in f:
                        try: events.append(json.loads(line.strip()))
                        except: pass

            now = datetime.now(timezone.utc)

            # 에이전트별 이벤트 수
            agent_activity = {}
            for ev in events:
                a = ev.get('agent')
                if a:
                    agent_activity[a] = agent_activity.get(a, 0) + 1

            # 게이트 거부 — 전체 + 에이전트별
            gate_rejections = [ev for ev in events if ev.get('event') == 'gate_rejected' or 'gate' in str(ev.get('data', {}))]
            gate_by_agent = {}
            for ev in gate_rejections:
                a = ev.get('agent')
                if a:
                    gate_by_agent[a] = gate_by_agent.get(a, 0) + 1

            # 티켓 전체 로드 (사이클 타임, 상태, 타입 등에 공용)
            all_tickets = []
            if os.path.isdir(tickets_dir):
                for f in os.listdir(tickets_dir):
                    if not f.endswith('.json'): continue
                    try:
                        with open(os.path.join(tickets_dir, f)) as fh:
                            all_tickets.append(json.load(fh))
                    except: pass

            # 티켓 사이클 타임 (created -> done)
            cycle_times = []
            for t in all_tickets:
                try:
                    if t.get('status') == 'done' and t.get('created_at') and t.get('updated_at'):
                        created = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00'))
                        updated = datetime.fromisoformat(t['updated_at'].replace('Z', '+00:00'))
                        cycle_sec = (updated - created).total_seconds()
                        cycle_times.append({"ticket": t['id'], "title": t['title'], "seconds": cycle_sec})
                except: pass

            # 상태별 티켓 수
            status_counts = {"backlog": 0, "todo": 0, "in_progress": 0, "review": 0, "done": 0}
            for t in all_tickets:
                s = t.get('status', 'backlog')
                status_counts[s] = status_counts.get(s, 0) + 1

            # 가장 활발한 에이전트 / 가장 비활성 에이전트
            sorted_agents = sorted(agent_activity.items(), key=lambda x: x[1], reverse=True)

            # 에이전트별 마지막 이벤트 시각
            agent_last_event = {}
            for ev in events:
                a = ev.get('agent')
                ts = ev.get('timestamp') or ev.get('ts') or ev.get('time')
                if a and ts:
                    try:
                        t_parsed = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
                        if a not in agent_last_event or t_parsed > agent_last_event[a]:
                            agent_last_event[a] = t_parsed
                    except: pass

            # heartbeat 데이터 로드
            heartbeats = {}
            if os.path.isdir(hb_dir):
                for f in os.listdir(hb_dir):
                    if f.endswith('.json'):
                        try:
                            with open(os.path.join(hb_dir, f)) as fh:
                                heartbeats[f[:-5]] = json.load(fh)
                        except: pass

            # 워크플로우 단계별 소요시간 집계
            step_durations = {}
            for ev in events:
                step = ev.get('step') or (ev.get('data', {}) if isinstance(ev.get('data'), dict) else {}).get('step')
                duration = ev.get('duration') or (ev.get('data', {}) if isinstance(ev.get('data'), dict) else {}).get('duration')
                if step and duration:
                    try:
                        dur = float(duration)
                        if step not in step_durations:
                            step_durations[step] = []
                        step_durations[step].append(dur)
                    except: pass

            # 활성 에이전트 목록 (state 파일 기반)
            active_agents = set()
            state_dir = os.path.join(company_dir, 'state')
            if os.path.isdir(state_dir):
                for f in os.listdir(state_dir):
                    if f.endswith('.state'):
                        try:
                            with open(os.path.join(state_dir, f)) as fh:
                                st = fh.read().strip()
                            if st in ('working', 'idle'):
                                active_agents.add(f[:-6])
                        except: pass

            # ━━━ Suggestions 생성 (11 types) ━━━
            suggestions = []

            # 1. stuck — 사이클 타임 48시간 초과
            for ct in cycle_times:
                if ct['seconds'] > 48 * 3600:
                    suggestions.append({
                        "type": "stuck",
                        "message": f"{ct['ticket']} ({ct['title'][:30]})이 {ct['seconds']/3600:.0f}시간+ 진행 중 — stuck 가능성",
                        "severity": "high",
                        "ticket": ct['ticket'],
                    })

            # 2. gate_issue — 게이트 거부 3회 초과
            if len(gate_rejections) > 2:
                suggestions.append({
                    "type": "gate_issue",
                    "message": f"게이트 거부 {len(gate_rejections)}회 — 리뷰 프로세스 점검 필요",
                    "severity": "medium",
                })

            # 3. wip_high — in_progress 4개 초과
            if status_counts.get('in_progress', 0) > 3:
                suggestions.append({
                    "type": "wip_high",
                    "message": f"in_progress 티켓 {status_counts.get('in_progress', 0)}개 — WIP 과다",
                    "severity": "high",
                })

            # 4. idle — 이벤트 0개
            if len(events) == 0:
                suggestions.append({
                    "type": "idle",
                    "message": "활동 이벤트 없음 — 시스템이 유휴 상태",
                    "severity": "low",
                })

            # 5. repeat_reject — 에이전트별 게이트 거부 3회+
            for agent, count in gate_by_agent.items():
                if count >= 3:
                    suggestions.append({
                        "type": "repeat_reject",
                        "message": f"{agent} 에이전트가 {count}회 게이트 거부 — 품질 개선 필요",
                        "severity": "high",
                        "agent": agent,
                    })

            # 6. type_ratio — bugfix 비율 50% 초과
            type_counts = {}
            for t in all_tickets:
                tt = t.get('type', 'unknown')
                type_counts[tt] = type_counts.get(tt, 0) + 1
            total_tickets = sum(type_counts.values())
            bugfix_count = type_counts.get('bugfix', 0) + type_counts.get('bug', 0)
            if total_tickets > 0 and bugfix_count > 0:
                pct = round(bugfix_count / total_tickets * 100)
                if pct > 50:
                    suggestions.append({
                        "type": "type_ratio",
                        "message": f"bugfix 비율 {pct}% — 기술 부채 주의",
                        "severity": "medium",
                    })

            # 7. slow_step — 워크플로우 단계 평균 시간이 전체 평균의 2배 초과
            if step_durations:
                step_avgs = {s: sum(ds) / len(ds) for s, ds in step_durations.items()}
                all_avgs = list(step_avgs.values())
                overall_avg = sum(all_avgs) / len(all_avgs) if all_avgs else 0
                if overall_avg > 0:
                    for step, avg in step_avgs.items():
                        if avg > overall_avg * 2:
                            suggestions.append({
                                "type": "slow_step",
                                "message": f"{step} 단계 평균 {avg/3600:.1f}시간 — 병목 가능",
                                "severity": "medium",
                            })

            # 8. idle_agent — 24시간+ 활동 없는 에이전트
            all_known_agents = set(agent_activity.keys()) | active_agents
            for agent in all_known_agents:
                last = agent_last_event.get(agent)
                if last:
                    if (now - last).total_seconds() > 24 * 3600:
                        suggestions.append({
                            "type": "idle_agent",
                            "message": f"{agent} 에이전트 24시간+ 활동 없음",
                            "severity": "low",
                            "agent": agent,
                        })
                elif agent in active_agents:
                    # 이벤트가 아예 없지만 활성 상태인 에이전트
                    suggestions.append({
                        "type": "idle_agent",
                        "message": f"{agent} 에이전트 24시간+ 활동 없음",
                        "severity": "low",
                        "agent": agent,
                    })

            # 9. no_heartbeat — 활성 에이전트 heartbeat 미수신 1시간+
            for agent in active_agents:
                hb = heartbeats.get(agent, {})
                hb_ts = hb.get('timestamp') or hb.get('ts') or hb.get('time')
                if hb_ts:
                    try:
                        hb_time = datetime.fromisoformat(str(hb_ts).replace('Z', '+00:00'))
                        if (now - hb_time).total_seconds() > 3600:
                            suggestions.append({
                                "type": "no_heartbeat",
                                "message": f"{agent} heartbeat 미수신 (1시간+)",
                                "severity": "medium",
                                "agent": agent,
                            })
                    except: pass
                elif agent not in heartbeats:
                    # heartbeat 파일 자체가 없는 활성 에이전트
                    suggestions.append({
                        "type": "no_heartbeat",
                        "message": f"{agent} heartbeat 미수신 (1시간+)",
                        "severity": "medium",
                        "agent": agent,
                    })

            # 10. unassigned — backlog 7일+ 배정 없는 티켓
            for t in all_tickets:
                if t.get('status') == 'backlog' and not t.get('assignee'):
                    created_at = t.get('created_at')
                    if created_at:
                        try:
                            created = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                            if (now - created).total_seconds() > 7 * 24 * 3600:
                                suggestions.append({
                                    "type": "unassigned",
                                    "message": f"{t['id']} 배정 없이 7일+ 대기",
                                    "severity": "low",
                                    "ticket": t['id'],
                                })
                        except: pass

            # 11. cycle_anomaly — 사이클 타임 평균의 3배 초과
            avg_cycle = sum(c['seconds'] for c in cycle_times) / len(cycle_times) if cycle_times else 0
            if avg_cycle > 0:
                for ct in cycle_times:
                    if ct['seconds'] > avg_cycle * 3:
                        multiplier = round(ct['seconds'] / avg_cycle, 1)
                        suggestions.append({
                            "type": "cycle_anomaly",
                            "message": f"{ct['ticket']} 소요시간 이상치 ({ct['seconds']/3600:.1f}시간, 평균의 {multiplier}배)",
                            "severity": "high",
                            "ticket": ct['ticket'],
                        })

            self.send_json({
                "total_events": len(events),
                "agent_activity": agent_activity,
                "top_agents": sorted_agents[:5],
                "gate_rejections": len(gate_rejections),
                "cycle_times": sorted(cycle_times, key=lambda x: x['seconds']),
                "avg_cycle_seconds": avg_cycle,
                "status_counts": status_counts,
                "suggestions": suggestions,
            })

        elif sub_path == 'team-metrics':
            # GET /api/{project}/team-metrics — 팀별 티켓·이벤트·WIP 메트릭
            config = _read_config_for_project(company_dir)
            metrics = _compute_team_metrics(company_dir, config)
            self.send_json({"teams": metrics})

        elif sub_path == 'heartbeats':
            # GET /api/{project}/heartbeats — 에이전트별 최신 heartbeat
            hb_dir = os.path.join(company_dir, 'state', 'heartbeats')
            heartbeats = {}
            if os.path.isdir(hb_dir):
                for f in os.listdir(hb_dir):
                    if f.endswith('.json'):
                        try:
                            with open(os.path.join(hb_dir, f)) as fh:
                                heartbeats[f[:-5]] = json.load(fh)
                        except: pass
            self.send_json({"heartbeats": heartbeats})

        elif sub_path == 'agents':
            agents = cached(f"{project_id}:agents_full", 5,
                            lambda: _read_agents_full_for_project(agents_dir, company_dir))
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
            agents = _read_agents_full_for_project(agents_dir, company_dir)
            agent = next((a for a in agents if a['id'] == agent_id), None)
            self.send_json(agent or {"error": "not found"})

        elif sub_path.startswith('agents/') and sub_path.endswith('/skills'):
            # GET /api/{project}/agents/{id}/skills — 에이전트 할당 스킬 조회
            parts = sub_path.split('/')
            if len(parts) != 3:
                self.send_json({"error": "invalid path"}, 400)
                return
            agent_id = parts[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            config = _read_config_for_project(company_dir)
            agent_skills = []
            for a in config.get('agents', []):
                if isinstance(a, dict) and a.get('id') == agent_id:
                    agent_skills = a.get('assigned_skills', [])
                    break
            self.send_json({"agent": agent_id, "skills": agent_skills})

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

        # ━━━ Analytics API (Phase 1-6) ━━━

        elif sub_path == 'analytics/activity':
            query = urlparse(self.path).query
            params = parse_qs(query)
            limit = int(params.get('limit', ['200'])[0])
            event_type = params.get('event', [None])[0]
            agent = params.get('agent', [None])[0]
            entries = _read_activity_jsonl(company_dir, limit=limit, event_type=event_type, agent=agent)
            self.send_json({"entries": entries})

        elif sub_path == 'analytics/scores':
            scores = cached(f"{project_id}:agent_scores", 10,
                            lambda: _compute_agent_scores(company_dir))
            self.send_json({"agents": scores})

        elif sub_path == 'analytics/workflows':
            analysis = cached(f"{project_id}:workflow_analysis", 10,
                              lambda: _compute_workflow_analysis(company_dir))
            self.send_json({"workflows": analysis})

        elif sub_path == 'shared-knowledge':
            query = urlparse(self.path).query
            params = parse_qs(query)
            agent = params.get('agent', [None])[0]
            limit = int(params.get('limit', ['10'])[0])
            entries = _read_shared_knowledge(company_dir, agent_id=agent, limit=limit)
            self.send_json({"entries": entries})

        elif sub_path.startswith('agent/') and '/memory/structured' in sub_path:
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            raw = _read_agent_memory_for_project(agent_id, company_dir)
            structured = _parse_structured_memory(raw)
            self.send_json({"agent": agent_id, "memory": structured})

        elif sub_path.startswith('agent/') and '/profile' in sub_path:
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            # 에이전트 프로필 통합: 메모리 + 스코어 + 스킬 + 도구
            raw_mem = _read_agent_memory_for_project(agent_id, company_dir)
            memory = _parse_structured_memory(raw_mem)
            scores = _compute_agent_scores(company_dir).get(agent_id, {})
            tool_profiles = _read_tool_profiles(company_dir).get(agent_id, {})
            # 에이전트 정보
            agents_list = _read_agents_full_for_project(agents_dir, company_dir)
            agent_info = next((a for a in agents_list if a['id'] == agent_id), {'id': agent_id})
            self.send_json({
                "agent": agent_info,
                "memory": memory,
                "scores": scores,
                "tools": tool_profiles,
            })

        elif sub_path == 'skills/installed':
            skills = cached(f"{project_id}:skills_installed", 30, lambda: _scan_installed_skills(company_dir))
            self.send_json({"skills": skills})

        elif sub_path == 'skills/usage':
            usage = _read_skill_usage(company_dir)
            # 집계
            agg = {}
            for entry in usage:
                sk = entry.get('skill', '')
                if sk not in agg:
                    agg[sk] = {'count': 0, 'success': 0, 'agents': set()}
                agg[sk]['count'] += 1
                if entry.get('outcome') == 'success':
                    agg[sk]['success'] += 1
                agg[sk]['agents'].add(entry.get('agent', ''))
            for sk in agg:
                total = agg[sk]['count']
                agg[sk]['success_rate'] = round(agg[sk]['success'] / max(total, 1), 2)
                agg[sk]['agents'] = list(agg[sk]['agents'])
            self.send_json({"usage": agg})

        elif sub_path == 'skills/candidates':
            path = os.path.join(company_dir, 'skill-candidates.jsonl')
            candidates = []
            if os.path.exists(path):
                with open(path) as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                candidates.append(json.loads(line))
                            except json.JSONDecodeError:
                                pass
            self.send_json({"candidates": candidates})

        elif sub_path.startswith('skills/') and '/config' in sub_path:
            skill_name = sub_path.split('/')[1]
            overrides = _read_skill_overrides(company_dir)
            self.send_json({
                "skill": skill_name,
                "overrides": overrides.get(skill_name, {}),
            })

        elif sub_path == 'tools/profiles':
            profiles = _read_tool_profiles(company_dir)
            self.send_json({"profiles": profiles})

        elif sub_path == 'improvements':
            improvements = _read_improvements(company_dir)
            self.send_json({"improvements": improvements})

        # ━━━ 코드 레벨 하네스 API ━━━

        elif sub_path == 'harness/health':
            checks = _harness_health_check(company_dir, project_id)
            self.send_json(checks)

        elif sub_path == 'harness/progress':
            progress = _harness_generate_progress(company_dir)
            self.send_json(progress)

        elif sub_path == 'harness/checklist':
            checklist = _harness_task_checklist(company_dir)
            self.send_json(checklist)

        elif sub_path == 'harness/drift':
            drift = _harness_drift_check(company_dir)
            self.send_json(drift)

        elif sub_path == 'harness/summary':
            summary = _harness_summary(company_dir)
            self.send_json(summary)

        # ━━━ Document Management GET ━━━

        elif sub_path == 'docs':
            # GET /api/{project}/docs — 관리 가능 문서 목록
            docs = _list_docs(company_dir)
            self.send_json({"docs": docs})

        elif sub_path.startswith('docs/'):
            # GET /api/{project}/docs/{type}/{id}
            parts = sub_path.split('/')  # ['docs', type, id]
            if len(parts) != 3:
                self.send_json({"error": "invalid docs path, expected docs/{type}/{id}"}, 400)
                return
            doc_type = parts[1]
            doc_id = parts[2]
            if doc_type not in ('project', 'team', 'agent', 'rules'):
                self.send_json({"error": f"invalid doc type: {doc_type}"}, 400)
                return
            if not _safe_doc_id(doc_id):
                self.send_json({"error": "invalid doc id"}, 400)
                return
            filepath = _doc_path_for(company_dir, doc_type, doc_id)
            if not filepath:
                self.send_json({"error": "unknown doc type"}, 400)
                return
            content = ''
            if os.path.isfile(filepath):
                with open(filepath, encoding='utf-8') as f:
                    content = f.read()
            # 상대 경로 반환 (절대 경로 노출 방지)
            project_root = os.path.dirname(os.path.dirname(company_dir))
            rel_path = os.path.relpath(filepath, project_root) if filepath.startswith(project_root) else os.path.basename(filepath)
            self.send_json({
                "type": doc_type,
                "id": doc_id,
                "path": rel_path,
                "content": content,
                "updated_at": _file_updated_at(filepath),
            })

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
        for _a in config.get('agents', []):
            aid = _a['id'] if isinstance(_a, dict) else _a
            p = os.path.join(agent_output_dir, f"{aid}.log")
            agent_watchers[aid] = FileWatcher(p)

        last_config_check = time.time()
        try:
            while True:
                if time.time() - last_config_check > 10:
                    last_config_check = time.time()
                    config = _read_config_for_project(company_dir)
                    for _a in config.get('agents', []):
                        aid = _a['id'] if isinstance(_a, dict) else _a
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
            if project_id not in ('run', 'workflow', 'workflows', 'agents', 'retrospectives', 'stop', 'projects', 'analytics', 'improvements', 'skills', 'shared-knowledge', 'tools', 'terminal', 'company', 'tickets'):
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

        elif sub_path == 'heartbeats' or sub_path == 'heartbeat':
            # POST /api/{project}/heartbeats — 에이전트 heartbeat 기록
            agent_id = body.get('agent', '').strip()
            if not agent_id:
                self.send_json({"ok": False, "error": "agent ID 필요"}, 400)
                return
            hb_dir = os.path.join(company_dir, 'state', 'heartbeats')
            os.makedirs(hb_dir, exist_ok=True)
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            hb = {
                "agent": agent_id,
                "ts": now,
                "ticket": body.get('ticket'),
                "status": body.get('status', ''),
                "next_action": body.get('next_action', ''),
                "goal": body.get('goal'),
                "quality": body.get('quality'),
                "blockers": body.get('blockers'),
            }
            hb = {k: v for k, v in hb.items() if v is not None}
            with open(os.path.join(hb_dir, f"{agent_id}.json"), 'w') as f:
                json.dump(hb, f, ensure_ascii=False, indent=2)
            # activity.jsonl에도 기록
            _jsonl = os.path.join(company_dir, 'activity.jsonl')
            with open(_jsonl, 'a') as _jf:
                _jf.write(json.dumps({"ts": now, "event": "heartbeat", "agent": agent_id, "data": hb}, ensure_ascii=False) + '\n')
            self.send_json({"ok": True})

        elif sub_path == 'events' or sub_path == 'events/log':
            # POST /api/{project}/events — 구조화된 이벤트 기록
            jsonl_path = os.path.join(company_dir, 'activity.jsonl')
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            event = {
                "ts": body.get('ts', now),
                "event": body.get('event', 'unknown'),
                "agent": body.get('agent'),
                "ticket": body.get('ticket'),
                "team": body.get('team'),
                "data": body.get('data', {}),
            }
            # None 값 제거
            event = {k: v for k, v in event.items() if v is not None}
            with open(jsonl_path, 'a') as f:
                f.write(json.dumps(event, ensure_ascii=False) + '\n')
            self.send_json({"ok": True})

        elif sub_path == 'goals' or sub_path == 'goals/create':
            # POST /api/{project}/goals — 목표 생성
            goals_dir = os.path.join(company_dir, 'state', 'goals')
            os.makedirs(goals_dir, exist_ok=True)
            existing = [f for f in os.listdir(goals_dir) if f.startswith('GOAL-') and f.endswith('.json')]
            next_num = max([int(f[5:-5]) for f in existing] + [0]) + 1
            goal_id = f"GOAL-{next_num:03d}"
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            goal = {
                "id": goal_id,
                "title": body.get('title', '').strip(),
                "mission": body.get('mission', '').strip(),
                "status": body.get('status', 'active'),
                "tickets": body.get('tickets', []),
                "progress": 0,
                "created_at": now,
                "updated_at": now,
            }
            if not goal['title']:
                self.send_json({"ok": False, "error": "제목을 입력하세요"}, 400)
                return
            with open(os.path.join(goals_dir, f"{goal_id}.json"), 'w') as f:
                json.dump(goal, f, ensure_ascii=False, indent=2)
            self.send_json({"ok": True, "id": goal_id, "goal": goal})

        elif sub_path.startswith('goals/') and sub_path.endswith('/update'):
            # POST /api/{project}/goals/{id}/update
            goal_id = sub_path.split('/')[1]
            goals_dir = os.path.join(company_dir, 'state', 'goals')
            goal_file = os.path.join(goals_dir, f"{goal_id}.json")
            if not os.path.exists(goal_file):
                self.send_json({"ok": False, "error": "goal not found"}, 404)
                return
            with open(goal_file) as f: goal = json.load(f)
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            for field in ('title', 'mission', 'status', 'tickets'):
                if field in body:
                    goal[field] = body[field]
            goal['updated_at'] = now
            with open(goal_file, 'w') as f:
                json.dump(goal, f, ensure_ascii=False, indent=2)
            self.send_json({"ok": True, "goal": goal})

        elif sub_path.startswith('goals/') and sub_path.endswith('/delete'):
            goal_id = sub_path.split('/')[1]
            goals_dir = os.path.join(company_dir, 'state', 'goals')
            goal_file = os.path.join(goals_dir, f"{goal_id}.json")
            if os.path.exists(goal_file):
                os.remove(goal_file)
            self.send_json({"ok": True})

        elif sub_path == 'tickets' or sub_path == 'tickets/create':
            # POST /api/{project}/tickets — 티켓 생성
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            os.makedirs(tickets_dir, exist_ok=True)
            # ID 자동 생성 (TASK-001, TASK-002, ...)
            existing = [f for f in os.listdir(tickets_dir) if f.startswith('TASK-') and f.endswith('.json')]
            next_num = max([int(f[5:-5]) for f in existing] + [0]) + 1
            ticket_id = f"TASK-{next_num:03d}"
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            # visibility: string[] | null — 이 티켓을 볼 수 있는 에이전트/팀 ID 목록 (null=전체 공개)
            _vis_raw = body.get('visibility')
            _visibility = None
            if isinstance(_vis_raw, list) and len(_vis_raw) > 0:
                _visibility = [str(v).strip() for v in _vis_raw if str(v).strip()]
                if not _visibility:
                    _visibility = None

            ticket = {
                "id": ticket_id,
                "title": body.get('title', '').strip(),
                "type": body.get('type', 'feature'),
                "status": body.get('status', 'backlog'),
                "priority": body.get('priority', 'medium'),
                "assignee": body.get('assignee') or None,
                "team": body.get('team') or None,
                "parent": body.get('parent') or None,
                "children": [],
                "completed_steps": [],
                "created_at": now,
                "updated_at": now,
                "created_by": body.get('created_by', 'user'),
                "goal": body.get('goal') or None,
                "labels": body.get('labels', []),
                "description": body.get('description', ''),
                "acceptance_criteria": body.get('acceptance_criteria', []),
                "activity": [{"ts": now, "agent": body.get('created_by', 'user'), "action": "created"}],
                "verify_passed": None,
                "visibility": _visibility,
            }
            if not ticket['title']:
                self.send_json({"ok": False, "error": "제목을 입력하세요"}, 400)
                return
            with open(os.path.join(tickets_dir, f"{ticket_id}.json"), 'w') as f:
                json.dump(ticket, f, ensure_ascii=False, indent=2)
            # 부모 티켓에 children 추가
            if ticket['parent']:
                parent_file = os.path.join(tickets_dir, f"{ticket['parent']}.json")
                if os.path.exists(parent_file):
                    with open(parent_file) as f: pt = json.load(f)
                    if ticket_id not in pt.get('children', []):
                        pt.setdefault('children', []).append(ticket_id)
                        pt['updated_at'] = now
                        with open(parent_file, 'w') as f: json.dump(pt, f, ensure_ascii=False, indent=2)
            # activity.jsonl에 이벤트 기록
            _jsonl = os.path.join(company_dir, 'activity.jsonl')
            with open(_jsonl, 'a') as _jf:
                _jf.write(json.dumps({"ts": now, "event": "ticket_created", "ticket": ticket_id, "agent": ticket['created_by'], "data": {"title": ticket['title'], "priority": ticket['priority']}}, ensure_ascii=False) + '\n')
            # ━━━ 목표 검증 (경고만, 차단 안 함) ━━━
            goal_warning = _validate_goal(company_dir, ticket.get('goal'))
            resp = {"ok": True, "id": ticket_id, "ticket": ticket}
            if goal_warning:
                resp["warning"] = goal_warning
            self.send_json(resp)

        elif sub_path.startswith('tickets/') and sub_path.endswith('/update'):
            # POST /api/{project}/tickets/{id}/update — 상태/담당자 변경
            ticket_id = sub_path.split('/')[1]
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            ticket_file = os.path.join(tickets_dir, f"{ticket_id}.json")
            if not os.path.exists(ticket_file):
                self.send_json({"ok": False, "error": "ticket not found"}, 404)
                return
            with open(ticket_file) as f: ticket = json.load(f)
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

            # ━━━ visibility 기반 권한 체크 ━━━
            _ticket_vis = ticket.get('visibility')
            if _ticket_vis is not None:
                _req_agent = body.get('agent', '')
                if _req_agent:
                    # 에이전트의 팀도 확인
                    _upd_config = _read_config_for_project(company_dir)
                    _req_agent_team = None
                    for _a in _upd_config.get('agents', []):
                        if isinstance(_a, dict) and _a.get('id') == _req_agent:
                            _req_agent_team = _a.get('team') or None
                            break
                    if _req_agent not in _ticket_vis and (not _req_agent_team or _req_agent_team not in _ticket_vis):
                        _log_rejected_attempt(company_dir, 'ticket_visibility_rejected', {
                            'ticket': ticket_id,
                            'agent': _req_agent,
                            'visibility': _ticket_vis,
                        })
                        self.send_json({
                            "ok": False,
                            "error": f"이 티켓에 대한 접근 권한이 없습니다 (visibility: {_ticket_vis})",
                        }, 403)
                        return

            # ━━━ 워크플로 강제 (status 변경 시) ━━━
            if 'status' in body and body['status'] != ticket.get('status'):
                config = _read_config_for_project(company_dir)
                wf_templates = config.get('workflow_templates', {})
                ticket_type = ticket.get('type', 'feature')
                wf = wf_templates.get(ticket_type, {})
                required_before = wf.get('required_before', {})
                new_status = body['status']
                completed = set(ticket.get('completed_steps', []))
                # 현재 상태도 완료로 추가
                completed.add(ticket.get('status'))

                if new_status in required_before:
                    missing = [s for s in required_before[new_status] if s not in completed]
                    if missing:
                        self.send_json({
                            "ok": False,
                            "error": f"워크플로 위반: {', '.join(missing)} 단계를 먼저 완료하세요",
                            "missing_steps": missing,
                            "ticket_type": ticket_type,
                        })
                        return

            # ━━━ WIP 제한 체크 (in_progress 전환 시) ━━━
            if 'status' in body and body['status'] == 'in_progress' and ticket.get('status') != 'in_progress':
                config = _read_config_for_project(company_dir)
                wip_limits = config.get('wip_limits', {})
                if wip_limits:
                    # 현재 in_progress 티켓 조회
                    all_tickets = []
                    for _f in os.listdir(tickets_dir):
                        if _f.endswith('.json'):
                            try:
                                with open(os.path.join(tickets_dir, _f)) as _fh:
                                    _t = json.load(_fh)
                                if _t.get('status') == 'in_progress':
                                    all_tickets.append(_t)
                            except: pass
                    # 글로벌 WIP
                    global_limit = wip_limits.get('global', 999)
                    if len(all_tickets) >= global_limit:
                        wip_ids = [t['id'] for t in all_tickets[:5]]
                        self.send_json({
                            "ok": False,
                            "error": f"WIP 제한 초과: 진행 중 {len(all_tickets)}/{global_limit}. 현재 작업을 먼저 완료하세요",
                            "wip_tickets": wip_ids,
                        })
                        return
                    # 에이전트별 WIP
                    agent_limit = wip_limits.get('per_agent', 999)
                    agent_id = body.get('agent') or ticket.get('assignee')
                    if agent_id:
                        agent_wip = [t for t in all_tickets if t.get('assignee') == agent_id]
                        if len(agent_wip) >= agent_limit:
                            self.send_json({
                                "ok": False,
                                "error": f"에이전트 WIP 제한: {agent_id}가 이미 {len(agent_wip)}개 진행 중",
                                "wip_tickets": [t['id'] for t in agent_wip],
                            })
                            return
                    # 팀별 WIP
                    team_limit = wip_limits.get('per_team', 999)
                    team_id = body.get('team') or ticket.get('team')
                    if team_id:
                        team_wip = [t for t in all_tickets if t.get('team') == team_id]
                        if len(team_wip) >= team_limit:
                            self.send_json({
                                "ok": False,
                                "error": f"팀 WIP 제한: {team_id}팀이 이미 {len(team_wip)}개 진행 중 (한도: {team_limit})",
                                "wip_tickets": [t['id'] for t in team_wip],
                            })
                            return

            # ━━━ 품질 게이트 체크 (status 변경 시) ━━━
            if 'status' in body and body['status'] != ticket.get('status'):
                config = _read_config_for_project(company_dir)
                gates = config.get('quality_gates', {})
                transition = f"{ticket['status']} → {body['status']}"
                gate = gates.get(transition)
                if gate:
                    criteria = gate.get('criteria', [])
                    failures = []
                    auto_verify = config.get('auto_verify', {})
                    for c in criteria:
                        c_lower = c.lower()
                        # gate_type 명시 체크 (있으면 우선, 없으면 텍스트 폴백)
                        gate_type = gate.get('gate_type', {}).get(c) if isinstance(gate.get('gate_type'), dict) else None

                        if gate_type == 'auto_verify' or (gate_type is None and ('자동 검증' in c_lower or 'auto' in c_lower or 'test' in c_lower)):
                            # 자동 검증 게이트: verify_passed 체크
                            if auto_verify.get('gate_integration') and ticket.get('verify_passed') is not True:
                                failures.append(c)

                        elif gate_type == 'acceptance_criteria' or (gate_type is None and ('ac' in c_lower or '완료 기준' in c_lower or 'acceptance' in c_lower)):
                            # AC 게이트: acceptance_criteria 비어있으면 거부
                            if not ticket.get('acceptance_criteria'):
                                failures.append(c)

                        elif gate_type == 'reviewer_approval' or (gate_type is None and ('리뷰어 승인' in c_lower or '리뷰어' in c_lower or 'reviewer' in c_lower or 'approval' in c_lower)):
                            # 리뷰어 승인 게이트: QA 에이전트가 코멘트 또는 승인 활동을 남겼는지 확인
                            qa_approved = False
                            for act in ticket.get('activity', []):
                                act_agent = act.get('agent', '')
                                act_action = act.get('action', '')
                                if _is_qa_agent(act_agent, config):
                                    # QA 에이전트의 comment, approve, gate_approved 중 하나가 있으면 승인
                                    if act_action in ('comment', 'approve', 'gate_approved', 'review_approved'):
                                        qa_approved = True
                                        break
                            if not qa_approved:
                                failures.append(c)

                    if failures:
                        ticket['activity'].append({
                            "ts": now,
                            "agent": "system",
                            "action": "gate_rejected",
                            "gate": transition,
                            "failures": failures,
                        })
                        ticket['updated_at'] = now
                        with open(ticket_file, 'w') as f:
                            json.dump(ticket, f, ensure_ascii=False, indent=2)
                        self.send_json({
                            "ok": False,
                            "error": f"품질 게이트 거부: {transition}",
                            "gate": transition,
                            "failures": failures,
                            "reviewer": gate.get('reviewer'),
                        })
                        return

            changed = []
            # visibility 필드 업데이트 (별도 처리: null 또는 string[] 검증)
            if 'visibility' in body:
                _new_vis = body['visibility']
                _old_vis = ticket.get('visibility')
                if _new_vis is None:
                    if _old_vis is not None:
                        ticket['visibility'] = None
                        changed.append('visibility')
                        ticket['activity'].append({
                            "ts": now,
                            "agent": body.get('agent', 'user'),
                            "action": "visibility_change",
                            "from": _old_vis,
                            "to": None,
                        })
                elif isinstance(_new_vis, list):
                    _cleaned = [str(v).strip() for v in _new_vis if str(v).strip()]
                    _final_vis = _cleaned if _cleaned else None
                    if _final_vis != _old_vis:
                        ticket['visibility'] = _final_vis
                        changed.append('visibility')
                        ticket['activity'].append({
                            "ts": now,
                            "agent": body.get('agent', 'user'),
                            "action": "visibility_change",
                            "from": _old_vis,
                            "to": _final_vis,
                        })

            for field in ('status', 'priority', 'assignee', 'team', 'title', 'description', 'labels', 'acceptance_criteria', 'goal'):
                if field in body and body[field] != ticket.get(field):
                    old_val = ticket.get(field)
                    ticket[field] = body[field]
                    changed.append(field)
                    ticket['activity'].append({
                        "ts": now,
                        "agent": body.get('agent', 'user'),
                        "action": f"{field}_change",
                        "from": old_val,
                        "to": body[field],
                    })
            # completed_steps 기록
            if 'status' in changed:
                steps = ticket.setdefault('completed_steps', [])
                if ticket['status'] not in steps:
                    steps.append(ticket['status'])
            # type 필드 업데이트 (body에 있으면)
            if 'type' in body and body['type'] != ticket.get('type'):
                ticket['type'] = body['type']
                changed.append('type')
            # ━━━ verify_passed 보호: 직접 설정 차단 ━━━
            if 'verify_passed' in body:
                x_source = self.headers.get('X-Source', '')
                request_agent = body.get('agent', '')
                force_flag = body.get('force', False)
                config_for_vp = _read_config_for_project(company_dir)
                allowed = False
                reject_reason = ''

                if x_source == 'auto-verify':
                    # auto_verify 훅에서 온 요청 — 허용
                    allowed = True
                elif force_flag is True and _is_qa_agent(request_agent, config_for_vp):
                    # QA 에이전트가 force: true로 명시 — 허용
                    allowed = True
                else:
                    reject_reason = (
                        f"verify_passed 직접 설정 거부: "
                        f"agent={request_agent}, X-Source={x_source}, force={force_flag}"
                    )

                if allowed:
                    ticket['verify_passed'] = body['verify_passed']
                else:
                    _log_rejected_attempt(company_dir, 'verify_passed_bypass_rejected', {
                        'ticket': ticket_id,
                        'agent': request_agent,
                        'x_source': x_source,
                        'force': force_flag,
                        'attempted_value': body['verify_passed'],
                        'reason': reject_reason,
                    })
                    self.send_json({
                        "ok": False,
                        "error": "verify_passed는 자동 검증 훅 또는 QA 에이전트(force:true)만 설정할 수 있습니다",
                        "rejected_field": "verify_passed",
                    }, 403)
                    return

            # ━━━ 부모 티켓 → done 전환 시 자식 완료 검증 ━━━
            if 'status' in changed and ticket.get('status') == 'done':
                children_ids = ticket.get('children', [])
                if children_ids:
                    incomplete_children = []
                    for child_id in children_ids:
                        child_file = os.path.join(tickets_dir, f"{child_id}.json")
                        if os.path.exists(child_file):
                            try:
                                with open(child_file) as cf:
                                    child = json.load(cf)
                                if child.get('status') != 'done':
                                    incomplete_children.append({
                                        'id': child_id,
                                        'status': child.get('status', 'unknown'),
                                        'title': child.get('title', ''),
                                    })
                            except (json.JSONDecodeError, OSError):
                                incomplete_children.append({
                                    'id': child_id,
                                    'status': 'unknown',
                                    'title': '(읽기 실패)',
                                })
                        else:
                            incomplete_children.append({
                                'id': child_id,
                                'status': 'missing',
                                'title': '(파일 없음)',
                            })
                    if incomplete_children:
                        _log_rejected_attempt(company_dir, 'parent_done_blocked', {
                            'ticket': ticket_id,
                            'incomplete_children': [c['id'] for c in incomplete_children],
                            'agent': body.get('agent', 'user'),
                        })
                        # 상태 변경 되돌리기: ticket dict에서 status를 원래로 복원
                        old_status = None
                        for act in reversed(ticket.get('activity', [])):
                            if act.get('action') == 'status_change':
                                old_status = act.get('from')
                                break
                        if old_status:
                            ticket['status'] = old_status
                            # completed_steps에서 done 제거
                            steps = ticket.get('completed_steps', [])
                            if 'done' in steps:
                                steps.remove('done')
                        self.send_json({
                            "ok": False,
                            "error": f"부모 티켓을 done으로 전환할 수 없습니다: 미완료 하위 티켓 {len(incomplete_children)}개",
                            "incomplete_children": incomplete_children,
                        })
                        return

            # 상태가 done으로 변경되면 연결된 goal의 티켓 목록에 추가
            if 'status' in changed and ticket.get('status') == 'done' and ticket.get('goal'):
                goals_dir = os.path.join(company_dir, 'state', 'goals')
                goal_file = os.path.join(goals_dir, f"{ticket['goal']}.json")
                if os.path.exists(goal_file):
                    with open(goal_file) as gf: goal = json.load(gf)
                    if ticket_id not in goal.get('tickets', []):
                        goal.setdefault('tickets', []).append(ticket_id)
                        goal['updated_at'] = now
                        with open(goal_file, 'w') as gf: json.dump(goal, gf, ensure_ascii=False, indent=2)
            ticket['updated_at'] = now
            with open(ticket_file, 'w') as f:
                json.dump(ticket, f, ensure_ascii=False, indent=2)
            # activity.jsonl에 변경 이벤트
            if changed:
                _jsonl = os.path.join(company_dir, 'activity.jsonl')
                for _cf in changed:
                    with open(_jsonl, 'a') as _jf:
                        _jf.write(json.dumps({"ts": now, "event": f"ticket_{_cf}_change", "ticket": ticket_id, "agent": body.get('agent', 'user'), "data": {"field": _cf, "to": ticket.get(_cf)}}, ensure_ascii=False) + '\n')
            # ━━━ 목표 검증 (goal 필드 변경 시, 경고만) ━━━
            resp = {"ok": True, "changed": changed, "ticket": ticket}
            if 'goal' in changed:
                goal_warning = _validate_goal(company_dir, ticket.get('goal'))
                if goal_warning:
                    resp["warning"] = goal_warning
            self.send_json(resp)

        elif sub_path.startswith('tickets/') and sub_path.endswith('/force-transition'):
            # POST /api/{project}/tickets/{id}/force-transition — 긴급 워크플로 건너뛰기
            # 워크플로 required_before를 우회하되, 품질 게이트는 여전히 적용.
            # 관리자 에이전트(orch, pm, protected:true)만 허용. 전체 감사 로그 기록.
            ticket_id = sub_path.split('/')[1]
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            ticket_file = os.path.join(tickets_dir, f"{ticket_id}.json")
            if not os.path.exists(ticket_file):
                self.send_json({"ok": False, "error": "ticket not found"}, 404)
                return
            with open(ticket_file) as f: ticket = json.load(f)
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

            # ━━━ 헤더 검증: X-Source: force-override 필수 ━━━
            x_source = self.headers.get('X-Source', '')
            if x_source != 'force-override':
                self.send_json({
                    "ok": False,
                    "error": "force-transition은 X-Source: force-override 헤더가 필요합니다",
                }, 403)
                return

            # ━━━ 필수 필드 검증 ━━━
            new_status = body.get('status', '').strip()
            agent = body.get('agent', '').strip()
            reason = body.get('reason', '').strip()
            if not new_status:
                self.send_json({"ok": False, "error": "status 필드 필수"}, 400)
                return
            if not agent:
                self.send_json({"ok": False, "error": "agent 필드 필수"}, 400)
                return
            if not reason:
                self.send_json({"ok": False, "error": "reason 필드 필수 (감사 로그용)"}, 400)
                return

            # ━━━ 관리자 에이전트 검증 ━━━
            config = _read_config_for_project(company_dir)
            if not _is_admin_agent(agent, config):
                _log_rejected_attempt(company_dir, 'force_transition_denied', {
                    'ticket': ticket_id,
                    'agent': agent,
                    'reason': reason,
                    'attempted_status': new_status,
                })
                self.send_json({
                    "ok": False,
                    "error": f"권한 부족: {agent}은(는) 관리자 에이전트가 아닙니다 (orch, pm 또는 protected 에이전트만 가능)",
                }, 403)
                return

            # ━━━ 동일 상태 전환 방지 ━━━
            if new_status == ticket.get('status'):
                self.send_json({
                    "ok": False,
                    "error": f"이미 {new_status} 상태입니다",
                }, 400)
                return

            # ━━━ 품질 게이트 체크 (워크플로는 건너뛰되 품질은 유지) ━━━
            gates = config.get('quality_gates', {})
            transition = f"{ticket['status']} -> {new_status}"
            gate = gates.get(transition)
            if gate:
                criteria = gate.get('criteria', [])
                failures = []
                auto_verify = config.get('auto_verify', {})
                for c in criteria:
                    c_lower = c.lower()
                    gate_type = gate.get('gate_type', {}).get(c) if isinstance(gate.get('gate_type'), dict) else None

                    if gate_type == 'auto_verify' or (gate_type is None and ('자동 검증' in c_lower or 'auto' in c_lower or 'test' in c_lower)):
                        if auto_verify.get('gate_integration') and ticket.get('verify_passed') is not True:
                            failures.append(c)
                    elif gate_type == 'acceptance_criteria' or (gate_type is None and ('ac' in c_lower or '완료 기준' in c_lower or 'acceptance' in c_lower)):
                        if not ticket.get('acceptance_criteria'):
                            failures.append(c)
                    elif gate_type == 'reviewer_approval' or (gate_type is None and ('리뷰어 승인' in c_lower or '리뷰어' in c_lower or 'reviewer' in c_lower or 'approval' in c_lower)):
                        qa_approved = False
                        for act in ticket.get('activity', []):
                            act_agent = act.get('agent', '')
                            act_action = act.get('action', '')
                            if _is_qa_agent(act_agent, config):
                                if act_action in ('comment', 'approve', 'gate_approved', 'review_approved'):
                                    qa_approved = True
                                    break
                        if not qa_approved:
                            failures.append(c)

                if failures:
                    ticket['activity'].append({
                        "ts": now,
                        "agent": agent,
                        "action": "force_transition_gate_rejected",
                        "gate": transition,
                        "failures": failures,
                        "reason": reason,
                    })
                    ticket['updated_at'] = now
                    with open(ticket_file, 'w') as f:
                        json.dump(ticket, f, ensure_ascii=False, indent=2)
                    self.send_json({
                        "ok": False,
                        "error": f"품질 게이트 거부 (force-transition도 품질 게이트는 우회 불가): {transition}",
                        "gate": transition,
                        "failures": failures,
                        "reviewer": gate.get('reviewer'),
                    })
                    return

            # ━━━ 워크플로 건너뛰기 + 상태 전환 실행 ━━━
            old_status = ticket.get('status')
            # 건너뛴 워크플로 단계 계산
            wf_templates = config.get('workflow_templates', {})
            ticket_type = ticket.get('type', 'feature')
            wf = wf_templates.get(ticket_type, {})
            steps = wf.get('steps', [])
            completed = set(ticket.get('completed_steps', []))
            completed.add(old_status)
            skipped_steps = []
            if steps:
                try:
                    old_idx = steps.index(old_status) if old_status in steps else -1
                    new_idx = steps.index(new_status) if new_status in steps else len(steps)
                    if old_idx >= 0 and new_idx > old_idx:
                        for i in range(old_idx + 1, new_idx):
                            if steps[i] not in completed:
                                skipped_steps.append(steps[i])
                except ValueError:
                    pass

            ticket['status'] = new_status
            # completed_steps에 현재 상태 추가
            steps_list = ticket.setdefault('completed_steps', [])
            if new_status not in steps_list:
                steps_list.append(new_status)

            # 감사 로그를 ticket.activity에 기록
            ticket['activity'].append({
                "ts": now,
                "agent": agent,
                "action": "force_transition",
                "from": old_status,
                "to": new_status,
                "reason": reason,
                "skipped_steps": skipped_steps,
            })
            ticket['updated_at'] = now
            with open(ticket_file, 'w') as f:
                json.dump(ticket, f, ensure_ascii=False, indent=2)

            # activity.jsonl 감사 로그
            _jsonl = os.path.join(company_dir, 'activity.jsonl')
            with open(_jsonl, 'a') as _jf:
                _jf.write(json.dumps({
                    "ts": now,
                    "event": "force_transition",
                    "ticket": ticket_id,
                    "agent": agent,
                    "data": {
                        "from": old_status,
                        "to": new_status,
                        "reason": reason,
                        "skipped_steps": skipped_steps,
                    },
                }, ensure_ascii=False) + '\n')

            self.send_json({
                "ok": True,
                "ticket": ticket,
                "force_transition": {
                    "from": old_status,
                    "to": new_status,
                    "skipped_steps": skipped_steps,
                    "reason": reason,
                    "agent": agent,
                },
            })

        elif sub_path.startswith('tickets/') and sub_path.endswith('/comment'):
            # POST /api/{project}/tickets/{id}/comment — 코멘트 추가
            ticket_id = sub_path.split('/')[1]
            tickets_dir = os.path.join(company_dir, 'state', 'tickets')
            ticket_file = os.path.join(tickets_dir, f"{ticket_id}.json")
            if not os.path.exists(ticket_file):
                self.send_json({"ok": False, "error": "ticket not found"}, 404)
                return
            with open(ticket_file) as f: ticket = json.load(f)
            now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            ticket['activity'].append({
                "ts": now,
                "agent": body.get('agent', 'user'),
                "action": "comment",
                "message": body.get('message', ''),
            })
            ticket['updated_at'] = now
            with open(ticket_file, 'w') as f:
                json.dump(ticket, f, ensure_ascii=False, indent=2)
            self.send_json({"ok": True})

        elif sub_path == 'teams/save':
            team_id = body.get('id', '').strip()
            label = body.get('label', '').strip()
            description = body.get('description', '').strip()
            if not team_id:
                self.send_json({"ok": False, "error": "팀 ID 필요"}, 400)
                return
            if not re.match(r'^[a-z][a-z0-9-]*$', team_id):
                self.send_json({"ok": False, "error": "ID는 영문 소문자, 숫자, 하이픈만 허용"}, 400)
                return
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                teams = config.get('teams', {})
                teams[team_id] = {"label": label or team_id, "description": description}
                config['teams'] = teams
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
            # 팀 디렉토리 + CLAUDE.md 자동 생성
            project_root = os.path.dirname(os.path.dirname(company_dir))
            team_dir = os.path.join(project_root, 'teams', team_id)
            os.makedirs(os.path.join(team_dir, 'docs'), exist_ok=True)
            team_claude = os.path.join(team_dir, 'CLAUDE.md')
            if not os.path.exists(team_claude):
                with open(team_claude, 'w') as f:
                    f.write(f'# {label or team_id}\n\n{description}\n\n## 팀 컨텍스트\n\n')
            # .claude/rules/teams/{team}.md 자동 생성
            rules_dir = os.path.join(project_root, '.claude', 'rules', 'teams')
            os.makedirs(rules_dir, exist_ok=True)
            rule_file = os.path.join(rules_dir, f'{team_id}.md')
            if not os.path.exists(rule_file):
                with open(rule_file, 'w') as f:
                    f.write(f'---\npaths:\n  - "teams/{team_id}/**"\n---\n\n# {label or team_id} 규칙\n\n')
            invalidate_cache(f"{project_id}:config")
            invalidate_cache(f"{project_id}:states")
            self.send_json({"ok": True, "id": team_id})

        elif sub_path == 'teams/delete':
            team_id = body.get('id', '').strip()
            if not team_id:
                self.send_json({"ok": False, "error": "팀 ID 필요"}, 400)
                return
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                teams = config.get('teams', {})
                if team_id in teams:
                    del teams[team_id]
                    config['teams'] = teams
                    # 소속 에이전트의 team을 null로
                    for a in config.get('agents', []):
                        if isinstance(a, dict) and a.get('team') == team_id:
                            a['team'] = None
                    with open(config_path, 'w', encoding='utf-8') as f:
                        json.dump(config, f, ensure_ascii=False, indent=2)
            invalidate_cache(f"{project_id}:config")
            invalidate_cache(f"{project_id}:states")
            invalidate_cache(f"{project_id}:agents_full")
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
            # config.json 업데이트 (structured object + team)
            team = body.get('team')
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                agents_list = config.get('agents', [])
                agents_list = _config_agents_add(agents_list, aid, team)
                config['agents'] = agents_list
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
            # 팀 디렉토리 자동 생성
            if team:
                project_root = os.path.dirname(os.path.dirname(company_dir))
                team_dir = os.path.join(project_root, 'teams', team)
                os.makedirs(os.path.join(team_dir, 'docs'), exist_ok=True)
                team_claude = os.path.join(team_dir, 'CLAUDE.md')
                if not os.path.exists(team_claude):
                    teams_config = config.get('teams', {})
                    label = teams_config.get(team, {}).get('label', team)
                    with open(team_claude, 'w') as f:
                        f.write(f'# {label}\n\n## 팀 컨텍스트\n\n')
            invalidate_cache(f"{project_id}:agents_full")
            invalidate_cache(f"{project_id}:config")
            invalidate_cache(f"{project_id}:states")
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
                config['agents'] = _config_agents_remove(agents_list, aid)
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
            invalidate_cache(f"{project_id}:agents_full")
            invalidate_cache(f"{project_id}:config")
            invalidate_cache(f"{project_id}:states")
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

        # ━━━ Analytics POST API (Phase 1-6) ━━━

        elif sub_path == 'analytics/event':
            # JSONL 이벤트 기록
            event = body.get('event')
            if not event or not isinstance(event, dict):
                self.send_json({"ok": False, "error": "event 필드 필요"}, 400)
                return
            _append_activity_jsonl(company_dir, event)
            self.send_json({"ok": True})

        elif sub_path.startswith('agent/') and sub_path.endswith('/memory/append'):
            agent_id = sub_path.split('/')[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"error": "invalid agent id"}, 400)
                return
            section = body.get('section', 'Learnings')
            entry = body.get('entry', '').strip()
            if not entry:
                self.send_json({"ok": False, "error": "entry 필드 필요"}, 400)
                return
            _append_agent_memory(company_dir, agent_id, section, entry)
            self.send_json({"ok": True})

        elif sub_path == 'shared-knowledge/append':
            entry = body.get('entry')
            if not entry or not isinstance(entry, dict):
                self.send_json({"ok": False, "error": "entry 필드 필요"}, 400)
                return
            _append_shared_knowledge(company_dir, entry)
            self.send_json({"ok": True})

        elif sub_path == 'skills/usage/append':
            entry = body.get('entry')
            if not entry or not isinstance(entry, dict):
                self.send_json({"ok": False, "error": "entry 필드 필요"}, 400)
                return
            _append_skill_usage(company_dir, entry)
            self.send_json({"ok": True})

        elif sub_path.startswith('skills/') and sub_path.endswith('/config'):
            skill_name = sub_path.split('/')[1]
            overrides = _read_skill_overrides(company_dir)
            overrides[skill_name] = body.get('config', {})
            _write_skill_overrides(company_dir, overrides)
            self.send_json({"ok": True})

        elif sub_path.startswith('agents/') and sub_path.endswith('/skills'):
            # POST /api/{project}/agents/{id}/skills — 에이전트 스킬 할당 업데이트
            parts = sub_path.split('/')
            if len(parts) != 3:
                self.send_json({"error": "invalid path"}, 400)
                return
            agent_id = parts[1]
            if not re.match(r'^[a-z][a-z0-9-]*$', agent_id):
                self.send_json({"ok": False, "error": "잘못된 에이전트 ID"}, 400)
                return
            new_skills = body.get('skills', [])
            if not isinstance(new_skills, list):
                self.send_json({"ok": False, "error": "skills 필드는 배열이어야 합니다"}, 400)
                return
            # config.json의 agents[].assigned_skills 업데이트
            config_path = os.path.join(company_dir, 'config.json')
            with CONFIG_LOCK:
                config = _read_config_for_project(company_dir)
                agents_list = config.get('agents', [])
                found = False
                for i, a in enumerate(agents_list):
                    if isinstance(a, dict) and a.get('id') == agent_id:
                        agents_list[i]['assigned_skills'] = new_skills
                        found = True
                        break
                    elif not isinstance(a, dict) and str(a) == agent_id:
                        # string → dict 승격
                        agents_list[i] = {
                            "id": agent_id,
                            "engine": "claude",
                            "agent_file": agent_id,
                            "label": agent_id.replace('-', ' ').title(),
                            "team": None,
                            "protected": agent_id in ('ceo', 'orch'),
                            "assigned_skills": new_skills,
                        }
                        found = True
                        break
                if not found:
                    self.send_json({"ok": False, "error": f"에이전트 '{agent_id}'를 찾을 수 없습니다"}, 404)
                    return
                config['agents'] = agents_list
                with open(config_path, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=2)
            invalidate_cache(f"{project_id}:config")
            invalidate_cache(f"{project_id}:states")
            self.send_json({"ok": True, "skills": new_skills})

        elif sub_path == 'tools/profiles':
            profiles = body.get('profiles', {})
            _write_tool_profiles(company_dir, profiles)
            self.send_json({"ok": True})

        # ━━━ 코드 레벨 하네스 POST API ━━━

        elif sub_path == 'harness/validate':
            agent_id = body.get('agent', '')
            output_text = body.get('output', '')
            if not agent_id or not output_text:
                self.send_json({"ok": False, "error": "agent + output 필요"}, 400)
                return
            result = _harness_validate_output(company_dir, agent_id, output_text)
            self.send_json({"ok": True, **result})

        elif sub_path == 'harness/ensure-dirs':
            # 코드 강제: 필요한 디렉토리 전부 생성
            for d in ['agent-memory', 'agent-output', 'retrospectives', 'analytics', 'improvements']:
                os.makedirs(os.path.join(company_dir, d), exist_ok=True)
            self.send_json({"ok": True, "created": True})

        # ━━━ Document Management POST ━━━

        elif sub_path.startswith('docs/') and sub_path.endswith('/save'):
            # POST /api/{project}/docs/{type}/{id}/save
            parts = sub_path.split('/')  # ['docs', type, id, 'save']
            if len(parts) != 4:
                self.send_json({"ok": False, "error": "invalid docs path, expected docs/{type}/{id}/save"}, 400)
                return
            doc_type = parts[1]
            doc_id = parts[2]
            if doc_type not in ('project', 'team', 'agent', 'rules'):
                self.send_json({"ok": False, "error": f"invalid doc type: {doc_type}"}, 400)
                return
            if not _safe_doc_id(doc_id):
                self.send_json({"ok": False, "error": "invalid doc id"}, 400)
                return
            content = body.get('content')
            if content is None:
                self.send_json({"ok": False, "error": "content 필드 필수"}, 400)
                return
            filepath = _doc_path_for(company_dir, doc_type, doc_id)
            if not filepath:
                self.send_json({"ok": False, "error": "unknown doc type"}, 400)
                return
            # 부모 디렉토리 생성
            parent_dir = os.path.dirname(filepath)
            os.makedirs(parent_dir, exist_ok=True)
            # 파일 쓰기
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            # activity.jsonl에 이벤트 기록
            _append_activity_jsonl(company_dir, {
                "event": "doc_updated",
                "type": doc_type,
                "id": doc_id,
                "agent": "user",
                "path": filepath,
            })
            self.send_json({
                "ok": True,
                "updated_at": _file_updated_at(filepath),
            })

        else:
            self.send_json({"error": f"unknown POST sub-path: {sub_path}"}, 404)

    def do_HEAD(self):
        """HEAD는 GET과 동일 헤더, 본문 없이 응답."""
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token, X-Source')
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
