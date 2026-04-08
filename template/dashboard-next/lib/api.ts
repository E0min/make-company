// API client for the Virtual Company Python server.
// Dev: set NEXT_PUBLIC_VC_API_BASE=http://localhost:7777 (or use Next rewrites in next.config).
// Prod (when served by Python): leave empty so requests are same-origin.

import type {
  StateResponse,
  ChannelResponse,
  WorkflowsResponse,
  TasksResponse,
  KnowledgeResponse,
  SkillsResponse,
  LibraryResponse,
  PresetsResponse,
  ApiResult,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_VC_API_BASE ?? "";

let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
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

export const api = {
  // GET
  state: () => getJSON<StateResponse>("/api/state"),
  channel: () => getJSON<ChannelResponse>("/api/channel"),
  workflows: () => getJSON<WorkflowsResponse>("/api/workflows"),
  tasks: () => getJSON<TasksResponse>("/api/tasks"),
  knowledge: () => getJSON<KnowledgeResponse>("/api/knowledge"),
  skills: () => getJSON<SkillsResponse>("/api/skills"),
  library: () => getJSON<LibraryResponse>("/api/library"),
  presets: () => getJSON<PresetsResponse>("/api/presets"),
  workflowTemplate: (file: string) =>
    getJSON<{ workflow: unknown }>(`/api/workflows/template/${file}`),

  // POST — agents
  createAgent: (body: {
    id: string;
    label: string;
    engine: string;
    agent_file: string;
    description: string;
    role_body: string;
    skills: string[];
  }) => postJSON("/api/agents/create", body),

  addAgentFromLibrary: (library_path: string) =>
    postJSON("/api/agents/from-library", { library_path }),

  deleteAgent: (id: string) => postJSON(`/api/agents/${id}/delete`, {}),

  setAgentSkills: (id: string, skills: string[]) =>
    postJSON(`/api/agents/${id}/skills`, { skills }),

  // POST — workflows
  createWorkflow: (workflow: unknown) =>
    postJSON("/api/workflows/create", { workflow }),

  runWorkflow: (file: string, user_request: string) =>
    postJSON(`/api/workflows/${file}/run`, { user_request }),

  deleteWorkflow: (file: string) =>
    postJSON(`/api/workflows/${file}/delete`, {}),

  // POST — presets
  exportPreset: (body: {
    id: string;
    name: string;
    description: string;
    icon: string;
  }) => postJSON("/api/presets/export", body),

  // POST — runtime
  pause: () => postJSON("/api/pause", {}),
  resume: () => postJSON("/api/resume", {}),
  inject: (agent: string, message: string) =>
    postJSON("/api/inject", { agent, message }),
};
