"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { X, Pencil, Loader2, CheckCircle, Plus, PackageOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentNodeData = {
  stepId: string;
  agent: string;
  prompt: string;
  output: string;
  /** Current execution status — drives border colour & status icon. */
  status?: "idle" | "working" | "done" | "error";
  onChangeAgent: (agent: string) => void;
  onChangeId: (id: string) => void;
  onChangeOutput: (output: string) => void;
  onDelete: () => void;
  onEditPrompt: () => void;
  /** Called when the user clicks the [+] button below the node. */
  onAddAfter?: () => void;
};

export type AgentNodeType = Node<AgentNodeData, "agent">;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable short labels for each agent role. */
const AGENT_LABELS: Record<string, string> = {
  "ceo": "CEO",
  "product-manager": "PM",
  "ui-ux-designer": "Designer",
  "frontend-engineer": "Frontend",
  "backend-engineer": "Backend",
  "fe-qa": "FE QA",
  "be-qa": "BE QA",
  "marketing-strategist": "Marketing",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic HSL colour derived from agent name.
 * Hue is computed via a simple char-code hash so each agent gets a stable,
 * visually distinct accent colour.
 */
function agentColor(agent: string): string {
  let h = 0;
  for (let i = 0; i < agent.length; i++) {
    h = agent.charCodeAt(i) + ((h << 5) - h);
  }
  return `hsl(${Math.abs(h) % 360}, 60%, 55%)`;
}

/** Truncate text to `max` characters, appending "..." when clipped. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AgentNodeRaw({ data, selected }: NodeProps<AgentNodeType>) {
  const {
    stepId,
    agent,
    prompt,
    output,
    status = "idle",
    onDelete,
    onEditPrompt,
    onAddAfter,
  } = data;

  const dotColor = agentColor(agent);
  const label = AGENT_LABELS[agent] || agent || "Agent";

  /* Extract first line / first 20 chars of prompt as summary */
  const promptSummary = prompt
    ? truncate(prompt.split("\n")[0], 20)
    : "(no prompt)";

  return (
    /* group wrapper — enables child hover detection for the [+] button */
    <div className="group relative">
      <div
        className={cn(
          /* sizing & shape */
          "w-[220px] rounded-lg",
          /* background */
          "bg-card",
          /* base border */
          "border",
          /* status-based border colour */
          status === "idle" && "border-border",
          status === "working" && "border-vc-indigo ring-1 ring-vc-indigo/30",
          status === "done" && "border-vc-green",
          status === "error" && "border-vc-red",
          /* selection ring (overlays status border) */
          selected && "ring-1 ring-primary",
        )}
      >
        {/* ── Target handle (top) ── */}
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />

        {/* ── Section 1: Agent label row ── */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          {/* Colour dot */}
          <span
            className="shrink-0 size-2.5 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden
          />
          {/* Role label */}
          <span className="text-sm font-semibold text-foreground leading-none">
            {label}
          </span>
          {/* Status icon — top-right area */}
          <span className="ml-auto shrink-0">
            {status === "working" && (
              <Loader2 className="size-3.5 text-vc-indigo animate-spin" />
            )}
            {status === "done" && (
              <CheckCircle className="size-3.5 text-vc-green" />
            )}
          </span>
        </div>

        {/* Prompt summary */}
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground leading-tight break-all">
            {promptSummary}
          </p>
        </div>

        {/* ── Divider ── */}
        <div className="border-t border-border" />

        {/* ── Section 2: Output + Step ID + actions ── */}
        <div className="flex flex-col gap-1 px-3 py-2">
          {/* Output row */}
          <div className="flex items-center gap-1.5">
            <PackageOpen className="size-3 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-foreground truncate">
              {output || "output"}
            </span>
          </div>
          {/* Step ID + edit / delete buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground font-mono truncate flex-1">
              {stepId}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="nodrag shrink-0"
              onClick={onEditPrompt}
              aria-label="Edit prompt"
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="nodrag shrink-0"
              onClick={onDelete}
              aria-label="Delete step"
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>

        {/* ── Source handle (bottom) ── */}
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />
      </div>

      {/* ── [+] "Add after" button — visible on hover ── */}
      {onAddAfter && (
        <button
          type="button"
          className={cn(
            /* positioning: centred below the source handle */
            "nodrag absolute left-1/2 -translate-x-1/2",
            /* offset below bottom handle (handle is ~6px below card) */
            "bottom-[-28px]",
            /* appearance */
            "flex items-center justify-center",
            "size-5 rounded-full",
            "bg-vc-indigo text-white",
            "border border-vc-indigo/50",
            "shadow-sm",
            /* hover reveal — hidden by default, shown when parent group is hovered */
            "opacity-0 group-hover:opacity-100",
            "transition-opacity duration-150",
            /* cursor */
            "cursor-pointer",
          )}
          onClick={onAddAfter}
          aria-label="Add step after"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * `memo()` is required for React Flow custom nodes to avoid unnecessary
 * re-renders during viewport interactions (pan / zoom / drag).
 */
const AgentNode = memo(AgentNodeRaw);
AgentNode.displayName = "AgentNode";

export default AgentNode;
