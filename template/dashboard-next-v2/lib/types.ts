// Shared types matching v2 server.py response shapes.

// --- Agent state (activity.log 기반) ---

export type AgentState = "working" | "idle" | "done" | "error" | "active" | "offline" | "stopped";

/** GET /api/state → agents[] 항목 */
export interface AgentStatus {
  id: string;
  state: AgentState;
  last_message: string;
  timestamp: string;
  team: string | null;
}

// --- Teams ---

/** 팀 정의 (config.json teams 항목) */
export interface TeamDefinition {
  label: string;
  description: string;
}

/** config.json의 teams 맵 */
export type TeamsMap = Record<string, TeamDefinition>;

/** GET /api/state 응답 전체 */
export interface StateResponse {
  project: string;
  tech_stack: string;
  agents: AgentStatus[];
  teams: TeamsMap;
  now: number;
}

// --- Tickets ---

export type TicketStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export type TicketPriority = "critical" | "high" | "medium" | "low";

export interface TicketActivity {
  ts: string;
  agent: string;
  action: string;
  from?: unknown;
  to?: unknown;
  message?: string;
  result?: string;
  reason?: string;
}

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string | null;
  team: string | null;
  parent: string | null;
  children: string[];
  created_at: string;
  updated_at: string;
  created_by: string;
  goal: string | null;
  labels: string[];
  description: string;
  acceptance_criteria: string[];
  activity: TicketActivity[];
}

export interface TicketsResponse {
  tickets: Ticket[];
}

// --- Goals ---

export interface Goal {
  id: string;
  title: string;
  mission: string;
  status: "active" | "completed" | "archived";
  tickets: string[];
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface GoalsResponse {
  goals: Goal[];
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
  team: string | null;
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

// ━━━ Analytics & Intelligence Types (Phase 1-6) ━━━

/** JSONL 활동 이벤트 */
export interface ActivityEvent {
  ts: string;
  event: "task_start" | "task_end" | "agent_start" | "agent_end" | "agent_error" | "retro_saved" | "skill_used" | "memory_updated" | "workflow_start" | "workflow_end";
  agent?: string;
  task_id?: string;
  workflow?: string;
  step?: string;
  duration_sec?: number;
  quality_self?: number;
  meta?: Record<string, unknown>;
}

/** 구조화된 에이전트 메모리 */
export interface StructuredMemory {
  learnings: string[];
  patterns: string[];
  self_assessment: Record<string, string>;
  project_specific: string[];
  raw: string;
}

/** 에이전트 성과 스코어 */
export interface AgentScores {
  total_tasks: number;
  avg_duration_sec: number;
  error_rate: number;
  avg_quality: number;
  trend: "improving" | "declining" | "stable" | "insufficient_data";
}

/** 워크플로우 분석 */
export interface WorkflowAnalysis {
  run_count: number;
  bottleneck_step: string | null;
  avg_step_durations: Record<string, number>;
}

/** 설치된 스킬 */
export interface InstalledSkill {
  name: string;
  description: string;
  category: string;
  path: string;
  is_symlink: boolean;
}

/** 스킬 사용 집계 */
export interface SkillUsageAgg {
  count: number;
  success: number;
  success_rate: number;
  agents: string[];
}

/** 도구 프로필 */
export interface ToolProfile {
  preferred: string[];
  avoid: string[];
  instructions: string;
}

/** 공유 지식 */
export interface SharedKnowledge {
  ts: string;
  author: string;
  type: "pitfall" | "pattern" | "preference" | "architecture";
  key: string;
  insight: string;
  confidence: number;
  relevant_agents: string[];
  retro_ref?: string;
}

/** 스킬 후보 */
export interface SkillCandidate {
  ts: string;
  agent: string;
  pattern: string;
  frequency: number;
  promoted: boolean;
}

/** 자기개선 권고 */
export interface ImprovementFinding {
  type: "bottleneck" | "quality_decline" | "skill_gap" | "tool_mismatch";
  agent?: string;
  description: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
}

export interface Improvement {
  id: string;
  generated_at: string;
  trigger: string;
  findings: ImprovementFinding[];
  auto_applied: string[];
}

/** 에이전트 프로필 (통합) */
export interface AgentProfile {
  agent: AgentFull;
  memory: StructuredMemory;
  scores: AgentScores;
  tools: ToolProfile;
}

/** 회고 */
export interface RetroFeedback {
  agent_id: string;
  went_well: string;
  went_wrong: string;
  action_item: string;
}

export interface Retrospective {
  id: string;
  project: string;
  task: string;
  completed_at: string;
  duration_seconds: number;
  participants: { agent_id: string; role: string }[];
  feedback: RetroFeedback[];
  summary: string;
  tags: string[];
}

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
