// Shared types matching server.py response shapes.

export type AgentState =
  | "working"
  | "idle"
  | "compacting"
  | "paused"
  | "error"
  | "rate-limited"
  | "done"
  | "stopped"
  | "permanently-failed"
  | "dead"
  | "unknown";

export interface Agent {
  id: string;
  label: string;
  engine: "claude" | "gemini";
  agent_file: string;
  protected: boolean;
  assigned_skills: string[];
  state: AgentState;
  state_ts: number;
  elapsed: number;
  heartbeat_age: number | null;
  inbox_size: number;
  tokens: number;
  messages: number;
}

export interface StateResponse {
  project: string;
  session_name: string;
  now: number;
  agents: Agent[];
  cost_limit: number;
  total_tokens: number;
  error?: string;
}

export interface ChannelResponse {
  lines: string[];
}

export interface WorkflowNode {
  id: string;
  agent: string;
  prompt?: string;
  depends_on?: string[];
  status?: "pending" | "running" | "done" | "failed" | "waiting";
}

export interface WorkflowActive {
  workflow_id: string;
  title?: string;
  status?: string;
  nodes: WorkflowNode[];
  file?: string;
}

export interface WorkflowTemplate {
  file: string;
  id: string;
  title: string;
}

export interface WorkflowsResponse {
  active: WorkflowActive[];
  templates: WorkflowTemplate[];
}

export interface TaskItem {
  id?: string;
  title?: string;
  status?: string;
  created_at?: number;
  [k: string]: unknown;
}

export interface TasksResponse {
  tasks: TaskItem[];
}

export interface KnowledgeResponse {
  index: string;
}

export interface SkillItem {
  name: string;
  desc: string;
}

export interface SkillsResponse {
  skills: SkillItem[];
}

export interface LibraryItem {
  library_path: string;
  category: string;
  name: string;
  default_label: string;
  description: string;
  default_skills: string;
}

export interface LibraryResponse {
  library: LibraryItem[];
  categories: string[];
}

export interface PresetItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  agent_count: number;
}

export interface PresetsResponse {
  presets: PresetItem[];
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  conflict?: boolean;
  error?: string;
}
