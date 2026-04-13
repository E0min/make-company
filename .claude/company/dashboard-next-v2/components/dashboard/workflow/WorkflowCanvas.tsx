"use client";

import { useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";

import type { WorkflowDefinition, WorkflowStep } from "@/lib/types";
import AgentNode, { type AgentNodeType } from "./AgentNode";

// ---------------------------------------------------------------------------
// nodeTypes must be defined OUTSIDE the component to prevent React Flow from
// re-mounting every node on each render.
// ---------------------------------------------------------------------------
const nodeTypes = { agent: AgentNode };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  definition: WorkflowDefinition;
  onChange: (def: WorkflowDefinition) => void;
  onEditPrompt: (stepId: string) => void;
}

// ---------------------------------------------------------------------------
// Auto-layout: topological sort -> layered positioning
// ---------------------------------------------------------------------------

/**
 * Compute (x, y) positions for each step using a topological layer approach.
 *
 * Steps with no dependencies sit at layer 0. Each subsequent layer contains
 * steps whose dependencies have all been placed in earlier layers.
 *
 * - Y gap between layers: 140 px
 * - X gap between siblings: 260 px (centred around x = 0)
 */
function autoLayout(steps: WorkflowStep[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (steps.length === 0) return positions;

  /* Build adjacency / in-degree maps */
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  const stepIds = new Set(steps.map((s) => s.id));

  for (const s of steps) {
    inDegree.set(s.id, 0);
    children.set(s.id, []);
  }

  for (const s of steps) {
    for (const dep of s.depends_on) {
      if (!stepIds.has(dep)) continue;
      inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      children.get(dep)?.push(s.id);
    }
  }

  /* Kahn's algorithm — group by layer */
  const layers: string[][] = [];
  let queue = steps.filter((s) => inDegree.get(s.id) === 0).map((s) => s.id);

  while (queue.length > 0) {
    layers.push(queue);
    const next: string[] = [];
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        const d = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, d);
        if (d === 0) next.push(child);
      }
    }
    queue = next;
  }

  /* Assign positions (y per layer, x centred within layer) */
  const Y_GAP = 140;
  const X_GAP = 260;

  for (let layer = 0; layer < layers.length; layer++) {
    const ids = layers[layer];
    const totalWidth = (ids.length - 1) * X_GAP;
    const startX = -totalWidth / 2;
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], { x: startX + i * X_GAP, y: layer * Y_GAP });
    }
  }

  /* Handle orphans (cyclic leftovers — shouldn't happen, but be safe) */
  let orphanY = layers.length * Y_GAP;
  for (const s of steps) {
    if (!positions.has(s.id)) {
      positions.set(s.id, { x: 0, y: orphanY });
      orphanY += Y_GAP;
    }
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Cycle detection via BFS
// ---------------------------------------------------------------------------

/**
 * Return `true` when adding source -> target would create a cycle.
 * Uses BFS from `target` following existing edges; if we reach `source`
 * there's a cycle.
 */
function wouldCreateCycle(
  source: string,
  target: string,
  edges: Edge[]
): boolean {
  /* Build adjacency list (existing directed edges: source -> target) */
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  /* BFS from target — can we reach source? */
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === source) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adj.get(cur) ?? []) {
      queue.push(next);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function definitionToFlow(
  def: WorkflowDefinition,
  callbacks: {
    onChangeAgent: (stepId: string, agent: string) => void;
    onChangeId: (oldId: string, newId: string) => void;
    onChangeOutput: (stepId: string, output: string) => void;
    onDelete: (stepId: string) => void;
    onEditPrompt: (stepId: string) => void;
    onAddAfter: (stepId: string) => void;
  }
): { nodes: Node[]; edges: Edge[] } {
  const positions = autoLayout(def.steps);

  const nodes: Node[] = def.steps.map((step) => {
    const pos = positions.get(step.id) ?? { x: 0, y: 0 };
    return {
      id: step.id,
      type: "agent" as const,
      position: pos,
      data: {
        stepId: step.id,
        agent: step.agent,
        prompt: step.prompt,
        output: step.output,
        onChangeAgent: (agent: string) =>
          callbacks.onChangeAgent(step.id, agent),
        onChangeId: (newId: string) =>
          callbacks.onChangeId(step.id, newId),
        onChangeOutput: (output: string) =>
          callbacks.onChangeOutput(step.id, output),
        onDelete: () => callbacks.onDelete(step.id),
        onEditPrompt: () => callbacks.onEditPrompt(step.id),
        onAddAfter: () => callbacks.onAddAfter(step.id),
      },
    };
  });

  const edges: Edge[] = [];
  for (const step of def.steps) {
    for (const dep of step.depends_on) {
      /* Resolve the source step's output name for the edge label */
      const sourceStep = def.steps.find((s) => s.id === dep);
      const outputLabel = sourceStep?.output || dep;

      edges.push({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
        type: "smoothstep",
        animated: true,
        /* Edge label — shows which output is flowing into this step */
        label: outputLabel,
        labelStyle: {
          fill: "oklch(0.55 0.01 270)",
          fontSize: 11,
          fontFamily: "monospace",
        },
        labelBgStyle: {
          fill: "oklch(0.145 0.007 285)",
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 8] as [number, number],
        labelBgBorderRadius: 4,
      });
    }
  }

  return { nodes, edges };
}

function flowToDefinition(
  nodes: Node[],
  edges: Edge[],
  name: string,
  description: string
): WorkflowDefinition {
  /* Build depends_on lookup from edges */
  const depsMap = new Map<string, string[]>();
  for (const edge of edges) {
    const list = depsMap.get(edge.target) ?? [];
    list.push(edge.source);
    depsMap.set(edge.target, list);
  }

  const steps: WorkflowStep[] = nodes.map((node) => {
    const d = node.data as Record<string, unknown>;
    return {
      id: d.stepId as string,
      agent: d.agent as string,
      prompt: d.prompt as string,
      depends_on: depsMap.get(node.id) ?? [],
      output: d.output as string,
    };
  });

  return { name, description, steps };
}

// ---------------------------------------------------------------------------
// Inner component (must be child of ReactFlowProvider)
// ---------------------------------------------------------------------------

function WorkflowCanvasInner({ definition, onChange, onEditPrompt }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /*
   * Track whether a sync from the internal state is in progress to
   * avoid infinite loops: external change -> setNodes -> onChange -> ...
   */
  const isSyncing = useRef(false);

  // ── Callbacks passed into every AgentNode ──

  const handleChangeAgent = useCallback(
    (stepId: string, agent: string) => {
      const next: WorkflowDefinition = {
        ...definition,
        steps: definition.steps.map((s) =>
          s.id === stepId ? { ...s, agent } : s
        ),
      };
      onChange(next);
    },
    [definition, onChange]
  );

  const handleChangeId = useCallback(
    (oldId: string, newId: string) => {
      const trimmed = newId.trim();
      if (!trimmed || trimmed === oldId) return;
      /* Rename the step + update all depends_on references */
      const next: WorkflowDefinition = {
        ...definition,
        steps: definition.steps.map((s) => {
          let step = s;
          if (step.id === oldId) {
            step = { ...step, id: trimmed };
          }
          if (step.depends_on.includes(oldId)) {
            step = {
              ...step,
              depends_on: step.depends_on.map((d) =>
                d === oldId ? trimmed : d
              ),
            };
          }
          return step;
        }),
      };
      onChange(next);
    },
    [definition, onChange]
  );

  const handleChangeOutput = useCallback(
    (stepId: string, output: string) => {
      const next: WorkflowDefinition = {
        ...definition,
        steps: definition.steps.map((s) =>
          s.id === stepId ? { ...s, output } : s
        ),
      };
      onChange(next);
    },
    [definition, onChange]
  );

  const handleDelete = useCallback(
    (stepId: string) => {
      const next: WorkflowDefinition = {
        ...definition,
        steps: definition.steps
          .filter((s) => s.id !== stepId)
          .map((s) => ({
            ...s,
            depends_on: s.depends_on.filter((d) => d !== stepId),
          })),
      };
      onChange(next);
    },
    [definition, onChange]
  );

  const handleEditPrompt = useCallback(
    (stepId: string) => {
      onEditPrompt(stepId);
    },
    [onEditPrompt]
  );

  /** Insert a new empty step that depends on `parentStepId`. */
  const handleAddAfter = useCallback(
    (parentStepId: string) => {
      const idx = definition.steps.length + 1;
      const newStep: WorkflowStep = {
        id: `step-${idx}`,
        agent: "",
        prompt: "",
        depends_on: [parentStepId],
        output: `step-${idx}`,
      };
      onChange({ ...definition, steps: [...definition.steps, newStep] });
    },
    [definition, onChange]
  );

  // ── Sync definition -> React Flow state ──

  useEffect(() => {
    isSyncing.current = true;

    const { nodes: nextNodes, edges: nextEdges } = definitionToFlow(
      definition,
      {
        onChangeAgent: handleChangeAgent,
        onChangeId: handleChangeId,
        onChangeOutput: handleChangeOutput,
        onDelete: handleDelete,
        onEditPrompt: handleEditPrompt,
        onAddAfter: handleAddAfter,
      }
    );

    setNodes(nextNodes);
    setEdges(nextEdges);

    /* Release the guard after a tick so React can flush the update. */
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, [
    definition,
    handleChangeAgent,
    handleChangeId,
    handleChangeOutput,
    handleDelete,
    handleEditPrompt,
    handleAddAfter,
    setNodes,
    setEdges,
  ]);

  // ── Connection handler (with cycle check) ──

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      /* Prevent self-loops */
      if (connection.source === connection.target) return;

      /* Prevent cycles */
      if (wouldCreateCycle(connection.source, connection.target, edges)) return;

      const nextEdges = addEdge(
        {
          ...connection,
          type: "smoothstep",
          animated: true,
        },
        edges
      );
      setEdges(nextEdges);

      /* Propagate to parent */
      const nextDef = flowToDefinition(
        nodes,
        nextEdges,
        definition.name,
        definition.description
      );
      onChange(nextDef);
    },
    [edges, nodes, definition, onChange, setEdges]
  );

  // ── Edge deletion handler ──

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const deletedIds = new Set(deleted.map((e) => e.id));
      const remaining = edges.filter((e) => !deletedIds.has(e.id));
      const nextDef = flowToDefinition(
        nodes,
        remaining,
        definition.name,
        definition.description
      );
      onChange(nextDef);
    },
    [edges, nodes, definition, onChange]
  );

  // ── Node double-click opens prompt editor ──

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onEditPrompt(node.id);
    },
    [onEditPrompt]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={handleConnect}
      onEdgesDelete={handleEdgesDelete}
      onNodeDoubleClick={handleNodeDoubleClick}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.3 }}
      defaultEdgeOptions={{ type: "smoothstep", animated: true }}
      proOptions={{ hideAttribution: true }}
    >
      <Controls position="bottom-right" />
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    </ReactFlow>
  );
}

// ---------------------------------------------------------------------------
// Public wrapper (provides ReactFlowProvider)
// ---------------------------------------------------------------------------

export default function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full">
        <WorkflowCanvasInner {...props} />
      </div>
    </ReactFlowProvider>
  );
}
