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
    return { ok: false, error: String(e) } as ApiResult<T>;
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

  // ── Structured Events ──

  /** 구조화된 이벤트 조회 (activity.jsonl) */
  events: (filters?: { limit?: number; event?: string; agent?: string; ticket?: string }) => {
    const params = new URLSearchParams();
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.event) params.set("event", filters.event);
    if (filters?.agent) params.set("agent", filters.agent);
    if (filters?.ticket) params.set("ticket", filters.ticket);
    const qs = params.toString();
    return getJSON<import("./types").EventsResponse>(`${apiBase()}/events${qs ? `?${qs}` : ""}`);
  },

  /** 이벤트 기록 */
  eventLog: (event: { event: string; agent?: string; ticket?: string; team?: string; data?: Record<string, unknown> }) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/events`, event),

  // ── Heartbeats + Insights ──

  heartbeats: () =>
    getJSON<{ heartbeats: Record<string, { agent: string; ts: string; ticket?: string; status?: string; next_action?: string; goal?: string; quality?: number }> }>(`${apiBase()}/heartbeats`),

  heartbeatLog: (body: { agent: string; ticket?: string; status?: string; next_action?: string; goal?: string; quality?: number }) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/heartbeats`, body),

  insights: () =>
    getJSON<{ total_events: number; agent_activity: Record<string, number>; top_agents: [string, number][]; gate_rejections: number; cycle_times: Array<{ ticket: string; title: string; seconds: number }>; avg_cycle_seconds: number; status_counts: Record<string, number>; suggestions?: Array<{ type: string; message: string; severity: string; ticket?: string; agent?: string }> }>(`${apiBase()}/insights`),

  /** 팀 메트릭 (팀별 티켓 수/WIP/이벤트) */
  teamMetrics: () =>
    getJSON<{ teams: Record<string, { tickets: Record<string, number>; events_24h: number; agents: number; wip_usage: string }> }>(`${apiBase()}/team-metrics`),

  // ── Org Chart ──

  orgchart: () =>
    getJSON<{ nodes: Array<{ id: string; label: string; team: string | null; teamLabel: string; state: string; reports_to: string | null; approves: string[]; heartbeat: Record<string, unknown> | null }>; edges: Array<{ source: string; target: string; type: string }> }>(`${apiBase()}/orgchart`),

  // ── Git ──

  /** Git 커밋 로그 (에이전트/티켓 태그 파싱) */
  gitLog: (filters?: { limit?: number; agent?: string; ticket?: string }) => {
    const params = new URLSearchParams();
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.agent) params.set("agent", filters.agent);
    if (filters?.ticket) params.set("ticket", filters.ticket);
    const qs = params.toString();
    return getJSON<{ commits: Array<{ hash: string; short_hash: string; author: string; date: string; message: string; agent: string | null; ticket: string | null }> }>(`${apiBase()}/git/log${qs ? `?${qs}` : ""}`);
  },

  // ── Goals ──

  goals: () => getJSON<import("./types").GoalsResponse>(`${apiBase()}/goals`),

  goalCreate: (body: { title: string; mission?: string; tickets?: string[] }) =>
    postJSON<{ ok: boolean; id?: string; goal?: import("./types").Goal }>(`${apiBase()}/goals`, body),

  goalUpdate: (id: string, body: Record<string, unknown>) =>
    postJSON<{ ok: boolean; goal?: import("./types").Goal }>(`${apiBase()}/goals/${id}/update`, body),

  goalDelete: (id: string) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/goals/${id}/delete`, {}),

  // ── Tickets ──

  /** 티켓 목록 (필터 지원) */
  tickets: (filters?: { status?: string; team?: string; assignee?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.team) params.set("team", filters.team);
    if (filters?.assignee) params.set("assignee", filters.assignee);
    const qs = params.toString();
    return getJSON<import("./types").TicketsResponse>(`${apiBase()}/tickets${qs ? `?${qs}` : ""}`);
  },

  /** 티켓 상세 */
  ticket: (id: string) =>
    getJSON<import("./types").Ticket>(`${apiBase()}/tickets/${id}`),

  /** 티켓 허용 전환 목록 (서버 기반 워크플로/WIP/게이트 검증) */
  ticketTransitions: (id: string) =>
    getJSON<{
      current: string;
      transitions: Array<{ status: string; allowed: boolean; reason?: string }>;
      wip_warning?: string;
      blocked_children?: string[];
    }>(`${apiBase()}/tickets/${id}/transitions`),

  /** 티켓 생성 */
  ticketCreate: (body: {
    title: string;
    type?: string;
    description?: string;
    status?: string;
    priority?: string;
    assignee?: string | null;
    team?: string | null;
    parent?: string | null;
    labels?: string[];
    acceptance_criteria?: string[];
    created_by?: string;
  }) => postJSON<{ ok: boolean; id?: string; ticket?: import("./types").Ticket }>(`${apiBase()}/tickets`, body),

  /** 티켓 업데이트 (상태/담당자/등 변경) */
  ticketUpdate: (id: string, body: Record<string, unknown>) =>
    postJSON<{ ok: boolean; changed?: string[]; ticket?: import("./types").Ticket; missing_steps?: string[]; wip_tickets?: string[]; failures?: string[]; ticket_type?: string }>(`${apiBase()}/tickets/${id}/update`, body),

  /** 티켓 코멘트 추가 */
  ticketComment: (id: string, message: string, agent?: string) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/tickets/${id}/comment`, { message, agent: agent ?? "user" }),

  /** 실시간 작업 흐름 DAG (에이전트 간 메시지 흐름) */
  flow: () => getJSON<{ nodes: Array<{ id: string; label: string; team: string | null; teamLabel: string; state: string }>; edges: Array<{ source: string; target: string; timestamp: string }> }>(`${apiBase()}/flow`),

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
    team?: string | null;
  }) => postJSON(`${apiBase()}/agents/save`, body),

  /** 팀 생성/수정 */
  teamsSave: (body: { id: string; label: string; description?: string }) =>
    postJSON(`${apiBase()}/teams/save`, body),

  /** 팀 삭제 (소속 에이전트는 소속 없음으로) */
  teamsDelete: (id: string) =>
    postJSON(`${apiBase()}/teams/delete`, { id }),

  /** AI로 에이전트 .md 생성 */
  agentsGenerate: (role: string, id?: string) =>
    postJSON<{ content?: string }>(`${apiBase()}/agents/generate`, { role, id: id ?? "" }),

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

  // ━━━ Docs API ━━━

  /** 문서 목록 조회 */
  docs: () =>
    getJSON<{ docs: Array<{ type: string; id: string; path: string; label: string; updated_at: string }> }>(`${apiBase()}/docs`),

  /** 문서 내용 조회 */
  docContent: (type: string, id: string) =>
    getJSON<{ type: string; id: string; path: string; content: string; updated_at: string }>(`${apiBase()}/docs/${type}/${id}`),

  /** 문서 저장 */
  docSave: (type: string, id: string, content: string) =>
    postJSON<{ ok: boolean; updated_at?: string }>(`${apiBase()}/docs/${type}/${id}/save`, { content }),

  // ━━━ Analytics API ━━━

  analyticsActivity: (limit = 200, event?: string, agent?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (event) params.set("event", event);
    if (agent) params.set("agent", agent);
    return getJSON<{ entries: import("./types").ActivityEvent[] }>(`${apiBase()}/analytics/activity?${params}`);
  },

  analyticsScores: () =>
    getJSON<{ agents: Record<string, import("./types").AgentScores> }>(`${apiBase()}/analytics/scores`),

  analyticsWorkflows: () =>
    getJSON<{ workflows: Record<string, import("./types").WorkflowAnalysis> }>(`${apiBase()}/analytics/workflows`),

  // ━━━ Agent Profile API ━━━

  agentProfile: (agent: string) =>
    getJSON<import("./types").AgentProfile>(`${apiBase()}/agent/${agent}/profile`),

  agentMemoryStructured: (agent: string) =>
    getJSON<{ agent: string; memory: import("./types").StructuredMemory }>(`${apiBase()}/agent/${agent}/memory/structured`),

  agentMemoryAppend: (agent: string, section: string, entry: string) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/agent/${agent}/memory/append`, { section, entry }),

  // ━━━ Shared Knowledge API ━━━

  sharedKnowledge: (agent?: string, limit = 10) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (agent) params.set("agent", agent);
    return getJSON<{ entries: import("./types").SharedKnowledge[] }>(`${apiBase()}/shared-knowledge?${params}`);
  },

  sharedKnowledgeAppend: (entry: import("./types").SharedKnowledge) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/shared-knowledge/append`, { entry }),

  // ━━━ Skills API ━━━

  skillsInstalled: () =>
    getJSON<{ skills: import("./types").InstalledSkill[] }>(`${apiBase()}/skills/installed`),

  skillsUsage: () =>
    getJSON<{ usage: Record<string, import("./types").SkillUsageAgg> }>(`${apiBase()}/skills/usage`),

  skillsCandidates: () =>
    getJSON<{ candidates: import("./types").SkillCandidate[] }>(`${apiBase()}/skills/candidates`),

  /** 에이전트 할당 스킬 조회 */
  agentSkills: (agentId: string) =>
    getJSON<{ agent: string; skills: string[] }>(`${apiBase()}/agents/${agentId}/skills`),

  /** 에이전트 스킬 할당 업데이트 */
  agentSkillsUpdate: (agentId: string, skills: string[]) =>
    postJSON<{ ok: boolean; skills?: string[] }>(`${apiBase()}/agents/${agentId}/skills`, { skills }),

  skillConfig: (skill: string) =>
    getJSON<{ skill: string; overrides: Record<string, unknown> }>(`${apiBase()}/skills/${skill}/config`),

  skillConfigSave: (skill: string, config: Record<string, unknown>) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/skills/${skill}/config`, { config }),

  // ━━━ Tools API ━━━

  toolProfiles: () =>
    getJSON<{ profiles: Record<string, import("./types").ToolProfile> }>(`${apiBase()}/tools/profiles`),

  toolProfilesSave: (profiles: Record<string, import("./types").ToolProfile>) =>
    postJSON<{ ok: boolean }>(`${apiBase()}/tools/profiles`, { profiles }),

  // ━━━ Retrospectives & Improvements ━━━

  retrospectives: () =>
    getJSON<{ retrospectives: import("./types").Retrospective[] }>(`${apiBase()}/retrospectives`),

  improvements: () =>
    getJSON<{ improvements: import("./types").Improvement[] }>(`${apiBase()}/improvements`),

  // ━━━ Harness API ━━━

  harnessSummary: () =>
    getJSON<import("./types").HarnessSummary>(`${apiBase()}/harness/summary`),

  /** 하네스 건강 점수 (0-100) */
  harnessHealth: () =>
    getJSON<{ health_score: number; checks: Record<string, unknown> }>(`${apiBase()}/harness/health`),
};
