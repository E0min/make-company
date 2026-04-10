// API client for Virtual Company v2 Python server (server.py).
// Dev: set NEXT_PUBLIC_VC_API_BASE=http://localhost:7777
// Prod (served by Python): leave empty → same-origin.

import type {
  StateResponse,
  ActivityResponse,
  AgentsResponse,
  GlobalAgentsResponse,
  AgentFull,
  AgentOutputResponse,
  AgentMemoryResponse,
  WorkflowsResponse,
  WorkflowContentResponse,
  RunningResponse,
  ApiResult,
  SSEEvent,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_VC_API_BASE ?? "";

// ━━━ 프로젝트 선택 상태 ━━━

/** 현재 선택된 프로젝트 ID (null이면 prefix 없이 /api 직접 호출) */
let _currentProject: string | null = null;

export function setCurrentProject(id: string | null) {
  _currentProject = id;
}

export function getCurrentProject(): string | null {
  return _currentProject;
}

/** 현재 프로젝트에 따라 API base path 결정 */
function apiBase(): string {
  return _currentProject ? `/api/${_currentProject}` : "/api";
}

// ━━━ Token (한 번만 fetch, 이후 캐시) ━━━

let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  // 1순위: HTML meta 태그에서 토큰 읽기 (static export에서 서버가 주입)
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="vc-token"]');
    if (meta) {
      cachedToken = meta.getAttribute("content") ?? "";
      if (cachedToken) return cachedToken;
    }
  }
  // 2순위: /api/token fetch
  try {
    const res = await fetch(`${BASE}/api/token`, { cache: "no-store" });
    if (!res.ok) return "";
    const data = (await res.json()) as { token?: string };
    cachedToken = data.token ?? "";
    return cachedToken;
  } catch {
    return "";
  }
}

/** 캐시된 토큰 초기화 (재인증 필요 시) */
export function resetToken(): void {
  cachedToken = null;
}

// ━━━ Fetch helpers ━━━

async function getJSON<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function postJSON<T = unknown>(
  path: string,
  body: unknown
): Promise<ApiResult<T>> {
  const token = await getToken();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token": token,
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult<T>;
    return { ...data, ok: res.ok && data.ok !== false };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ━━━ SSE 연결 ━━━

/**
 * /api/sse EventSource 래퍼.
 * 반환된 EventSource를 .close()로 정리할 것.
 * @param onEvent - SSE 이벤트 콜백
 * @param onError - 에러 콜백
 * @param project - 프로젝트 ID (지정 시 /api/{project}/sse 연결)
 */
export function connectSSE(
  onEvent: (event: SSEEvent) => void,
  onError?: (err: Event) => void,
  project?: string | null
): EventSource {
  const prefix = project ? `/api/${project}` : "/api";
  const es = new EventSource(`${BASE}${prefix}/sse`);

  es.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as SSEEvent;
      onEvent(parsed);
    } catch {
      // 파싱 불가 이벤트 무시
    }
  };

  es.onerror = (e) => {
    onError?.(e);
  };

  return es;
}

// ━━━ Public API ━━━

export const api = {
  // ── GET (프로젝트 독립) ──

  /** 등록된 프로젝트 목록 (프로젝트 prefix 없이 항상 /api/projects) */
  projects: () =>
    getJSON<{ projects: Array<{ id: string; path: string; registered_at: string }> }>("/api/projects"),

  // ── GET (프로젝트 스코프) ──

  /** 프로젝트 상태 + 에이전트 상태 목록 */
  state: () => getJSON<StateResponse>(`${apiBase()}/state`),

  /** 활동 로그 (최근 50줄) */
  activity: () => getJSON<ActivityResponse>(`${apiBase()}/activity`),

  /** 프로젝트 에이전트 전체 (.md frontmatter + 본문) */
  agents: () => getJSON<AgentsResponse>(`${apiBase()}/agents`),

  /** 글로벌 에이전트 목록 (프로젝트에 없는 것만) */
  agentsGlobal: () => getJSON<GlobalAgentsResponse>(`${apiBase()}/agents/global`),

  /** 특정 에이전트의 최근 출력 로그 */
  agentOutput: (id: string) =>
    getJSON<AgentOutputResponse>(`${apiBase()}/agent/${id}/output`),

  /** 특정 에이전트의 메모리 (.md) */
  agentMemory: (id: string) =>
    getJSON<AgentMemoryResponse>(`${apiBase()}/agent/${id}/memory`),

  /** 특정 에이전트 전체 정보 (frontmatter + content) */
  agentContent: (id: string) => getJSON<AgentFull>(`${apiBase()}/agent/${id}/content`),

  /** 워크플로우 YAML 목록 */
  workflows: () => getJSON<WorkflowsResponse>(`${apiBase()}/workflows`),

  /** 현재 실행 중인 프로세스 정보 */
  running: () => getJSON<RunningResponse>(`${apiBase()}/running`),

  /** 인증 토큰 */
  token: () => getJSON<{ token: string }>(`${apiBase()}/token`),

  // ── POST (프로젝트 스코프) ──

  /** 멀티에이전트 태스크 실행 */
  run: (task: string) => postJSON(`${apiBase()}/run`, { task }),

  /** 워크플로우 실행 */
  workflow: (name: string, input: string) =>
    postJSON(`${apiBase()}/workflow`, { name, input }),

  /** 실행 중인 태스크 중지 */
  stop: () => postJSON(`${apiBase()}/stop`, {}),

  /** 에이전트 저장 (신규/수정) */
  agentsSave: (body: {
    id: string;
    content: string;
    scope?: "local" | "global" | "both";
    color?: string;
  }) => postJSON(`${apiBase()}/agents/save`, body),

  /** AI로 에이전트 .md 생성 */
  agentsGenerate: (role: string, id?: string) =>
    postJSON(`${apiBase()}/agents/generate`, { role, id: id ?? "" }),

  /** 에이전트 삭제 */
  agentsDelete: (id: string) => postJSON(`${apiBase()}/agents/delete`, { id }),

  /** 글로벌 에이전트를 프로젝트로 가져오기 */
  agentsImport: (id: string) => postJSON(`${apiBase()}/agents/import`, { id }),

  // ── Workflow CRUD (프로젝트 스코프) ──

  /** 워크플로우 YAML 원본 조회 */
  workflowContent: (name: string) =>
    getJSON<WorkflowContentResponse>(`${apiBase()}/workflow/${encodeURIComponent(name)}`),

  /** 워크플로우 저장 (신규/수정) */
  workflowsSave: (name: string, content: string) =>
    postJSON<ApiResult>(`${apiBase()}/workflows/save`, { name, content }),

  /** 워크플로우 삭제 */
  workflowsDelete: (name: string) =>
    postJSON<ApiResult>(`${apiBase()}/workflows/delete`, { name }),

  /** AI로 워크플로우 YAML 자연어 생성 */
  workflowsGenerate: (description: string) =>
    postJSON<{ ok: boolean; content?: string; error?: string }>(`${apiBase()}/workflows/generate`, { description }),

  // ── 프로젝트 회사 시작/종료 (프로젝트 ID 직접 지정) ──

  /** 프로젝트 회사 tmux 세션 시작 */
  companyStart: (projectId: string) =>
    postJSON<{ ok: boolean; session?: string; error?: string }>(`/api/${projectId}/company/start`, {}),

  /** 프로젝트 회사 tmux 세션 종료 */
  companyStop: (projectId: string) =>
    postJSON<{ ok: boolean; error?: string }>(`/api/${projectId}/company/stop`, {}),

  /** 프로젝트 회사 실행 상태 조회 */
  companyStatus: (projectId: string) =>
    getJSON<{ active: boolean; session: string; windows: string[] }>(`/api/${projectId}/company/status`),

  // ── Terminal API ──

  /** 에이전트 터미널 세션 열기 (스크롤백 반환, cols/rows로 tmux pane 리사이즈) */
  terminalOpen: (agent: string, cols?: number, rows?: number) =>
    postJSON<{ ok: boolean; scrollback?: string; offset?: number; error?: string }>(
      `${apiBase()}/terminal/${agent}/open`, { cols, rows }
    ),

  /** 터미널 출력 폴링 (since offset 이후 새 데이터) */
  terminalRead: (agent: string, since: number) =>
    getJSON<{ data: string; offset: number }>(
      `${apiBase()}/terminal/${agent}/read?since=${since}`
    ),

  /** 터미널 세션 닫기 */
  terminalClose: (agent: string) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/terminal/${agent}/close`, {}),

  /** 터미널에 입력 전송 */
  terminalWrite: (agent: string, input: string) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/terminal/${agent}/write`, { input }),
};
