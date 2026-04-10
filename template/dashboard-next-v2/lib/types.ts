// Shared types matching v2 server.py response shapes.

// --- Agent state (activity.log 기반) ---

export type AgentState = "working" | "idle" | "done" | "error" | "active" | "offline" | "stopped";

/** GET /api/state → agents[] 항목 */
export interface AgentStatus {
  id: string;
  state: AgentState;
  last_message: string;
  timestamp: string;
}

/** GET /api/state 응답 전체 */
export interface StateResponse {
  project: string;
  tech_stack: string;
  agents: AgentStatus[];
  now: number;
}

// --- Activity ---

/** GET /api/activity → entries[] 항목 */
export interface ActivityEntry {
  timestamp: string;
  agent: string;
  message: string;
  raw: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}

// --- Agents (에이전트 .md 파일 관리) ---

/** GET /api/agents → agents[] 항목 (프로젝트 에이전트) */
export interface AgentFull {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  content: string;
  is_global: boolean;
}

export interface AgentsResponse {
  agents: AgentFull[];
}

/** GET /api/agents/global → agents[] 항목 */
export interface GlobalAgent {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface GlobalAgentsResponse {
  agents: GlobalAgent[];
}

/** GET /api/agent/{id}/output */
export interface AgentOutputResponse {
  output: string;
}

/** GET /api/agent/{id}/memory */
export interface AgentMemoryResponse {
  memory: string;
}

// --- Workflows ---

export interface WorkflowItem {
  file: string;
  name: string;
  title: string;
  description: string;
}

export interface WorkflowsResponse {
  workflows: WorkflowItem[];
}

// --- Running process ---

export interface RunningResponse {
  pid: number | null;
  task: string | null;
  mode: string | null;
  started: string | null;
}

// --- SSE event payloads ---

export interface SSEActivityEvent {
  type: "activity";
  data: string;
}

export interface SSEAgentOutputEvent {
  type: "agent_output";
  agent: string;
  data: string;
}

export type SSEEvent = SSEActivityEvent | SSEAgentOutputEvent;

// --- Generic result wrapper ---

export interface ApiResult<T = unknown> {
  ok: boolean;
  [key: string]: unknown;
  error?: string;
}

// ━━━ Workflow Builder ━━━

/** 워크플로우 빌더용 타입 */
export interface WorkflowStep {
  id: string;
  agent: string;
  prompt: string;
  depends_on: string[];
  output: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowContentResponse {
  ok: boolean;
  name: string;
  content: string;
}

export const AVAILABLE_AGENTS = [
  "ceo", "product-manager", "ui-ux-designer",
  "frontend-engineer", "backend-engineer",
  "fe-qa", "be-qa", "marketing-strategist",
] as const;

export type AgentId = (typeof AVAILABLE_AGENTS)[number];

// ━━━ v1 호환 타입 (다른 컴포넌트 마이그레이션 전까지 유지) ━━━
// TODO: 각 컴포넌트를 v2 타입으로 전환한 뒤 아래 블록 삭제

/** @deprecated v2에서는 AgentStatus + AgentFull 사용 */
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

/** @deprecated v2에서는 ActivityResponse 사용 */
export interface ChannelResponse {
  lines: string[];
}

/** @deprecated v2에서는 WorkflowItem 사용 */
export interface WorkflowTemplate {
  file: string;
  id: string;
  title: string;
}

/** @deprecated v2에서 제거됨 */
export interface WorkflowNode {
  id: string;
  agent: string;
  prompt?: string;
  depends_on?: string[];
  status?: "pending" | "running" | "done" | "failed" | "waiting";
}

/** @deprecated v2에서 제거됨 */
export interface WorkflowActive {
  workflow_id: string;
  title?: string;
  status?: string;
  nodes: WorkflowNode[];
  file?: string;
}

/** @deprecated v2에서 제거됨 */
export interface TaskItem {
  id?: string;
  title?: string;
  status?: string;
  created_at?: number;
  [k: string]: unknown;
}

/** @deprecated v2에서 제거됨 */
export interface TasksResponse {
  tasks: TaskItem[];
}

/** @deprecated v2에서 제거됨 */
export interface KnowledgeResponse {
  index: string;
}

/** @deprecated v2에서 제거됨 */
export interface SkillItem {
  name: string;
  desc: string;
}

/** @deprecated v2에서 제거됨 */
export interface SkillsResponse {
  skills: SkillItem[];
}

/** @deprecated v2에서 제거됨 */
export interface LibraryItem {
  library_path: string;
  category: string;
  name: string;
  default_label: string;
  description: string;
  default_skills: string;
}

/** @deprecated v2에서 제거됨 */
export interface LibraryResponse {
  library: LibraryItem[];
  categories: string[];
}

/** @deprecated v2에서 제거됨 */
export interface PresetItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  agent_count: number;
}

/** @deprecated v2에서 제거됨 */
export interface PresetsResponse {
  presets: PresetItem[];
}
