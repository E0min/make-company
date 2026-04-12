"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Controls, Background, BackgroundVariant,
  Handle, Position, type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Circle, ArrowDown } from "lucide-react";

// ━━━ 타입 ━━━

interface OrgNode {
  id: string;
  label: string;
  team: string | null;
  teamLabel: string;
  state: string;
  reports_to: string | null;
  approves: string[];
  heartbeat: Record<string, unknown> | null;
}

type OrgNodeData = OrgNode & Record<string, unknown>;
type OrgNodeType = Node<OrgNodeData, "org">;

// ━━━ 상태 스타일 ━━━

function stateStyle(state: string) {
  switch (state) {
    case "working": return { border: "border-indigo-500 ring-1 ring-indigo-500/30", dot: "bg-indigo-400 animate-pulse" };
    case "done": return { border: "border-emerald-500", dot: "bg-emerald-400" };
    case "error": return { border: "border-red-500", dot: "bg-red-400" };
    case "active": return { border: "border-indigo-400/50", dot: "bg-indigo-400" };
    default: return { border: "border-border", dot: "bg-zinc-500" };
  }
}

// ━━━ Org 노드 컴포넌트 ━━━

function OrgNodeRaw({ data }: NodeProps<OrgNodeType>) {
  const s = stateStyle(data.state);
  const hb = data.heartbeat as Record<string, string | number> | null;

  return (
    <div className={cn("w-[180px] rounded-lg bg-card border shadow-sm", s.border)}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-muted-foreground !border-2 !border-background" />

      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full shrink-0", s.dot)} />
          <span className="text-sm font-bold truncate flex-1">{data.label}</span>
        </div>

        {data.teamLabel && (
          <Badge variant="outline" className="text-[9px] w-fit">{data.teamLabel}</Badge>
        )}

        {data.approves.length > 0 && (
          <div className="text-[9px] text-muted-foreground">
            승인: {data.approves.join(", ")}
          </div>
        )}

        {hb && (
          <div className="text-[9px] text-muted-foreground border-t border-border/30 pt-1 mt-1 space-y-0.5">
            {hb.ticket && <div>티켓: {String(hb.ticket)}</div>}
            {hb.status && <div>상태: {String(hb.status)}</div>}
            {hb.quality && <div>품질: {String(hb.quality)}/10</div>}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-muted-foreground !border-2 !border-background" />
    </div>
  );
}

const OrgNodeComponent = memo(OrgNodeRaw);
OrgNodeComponent.displayName = "OrgNode";
const nodeTypes = { org: OrgNodeComponent };

// ━━━ 자동 레이아웃 (계층) ━━━

function autoLayout(nodes: OrgNode[], edges: { source: string; target: string }[]): { xyNodes: Node[]; xyEdges: Edge[] } {
  if (nodes.length === 0) return { xyNodes: [], xyEdges: [] };

  const childMap: Record<string, string[]> = {};
  for (const e of edges) {
    (childMap[e.source] ??= []).push(e.target);
  }

  // BFS 레벨
  const roots = nodes.filter((n) => !n.reports_to);
  const level: Record<string, number> = {};
  const queue = roots.map((r) => r.id);
  for (const id of queue) level[id] = 0;

  let qi = 0;
  while (qi < queue.length) {
    const curr = queue[qi++];
    for (const child of childMap[curr] ?? []) {
      level[child] = (level[curr] ?? 0) + 1;
      queue.push(child);
    }
  }
  // 미배치 노드
  const maxLv = Math.max(...Object.values(level), 0);
  for (const n of nodes) {
    if (level[n.id] === undefined) level[n.id] = maxLv + 1;
  }

  const levels: Record<number, OrgNode[]> = {};
  for (const n of nodes) (levels[level[n.id]] ??= []).push(n);

  const W = 180, GAP_X = 50, GAP_Y = 120;
  const xyNodes: Node[] = [];

  for (const [lv, members] of Object.entries(levels)) {
    const total = members.length * W + (members.length - 1) * GAP_X;
    const startX = -total / 2;
    members.forEach((n, i) => {
      xyNodes.push({
        id: n.id,
        type: "org",
        position: { x: startX + i * (W + GAP_X), y: Number(lv) * GAP_Y },
        data: { ...n } as OrgNodeData,
      });
    });
  }

  const xyEdges: Edge[] = edges.map((e, i) => ({
    id: `org-e-${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: "oklch(0.5 0.03 285)", strokeWidth: 1.5 },
    animated: false,
  }));

  return { xyNodes, xyEdges };
}

// ━━━ 메인 컴포넌트 ━━━

function OrgChartInner() {
  const [data, setData] = useState<{ nodes: OrgNode[]; edges: { source: string; target: string }[] } | null>(null);

  useEffect(() => {
    api.orgchart().then(setData).catch(() => setData(null));
  }, []);

  const { xyNodes, xyEdges } = useMemo(() => {
    if (!data) return { xyNodes: [], xyEdges: [] };
    return autoLayout(data.nodes, data.edges);
  }, [data]);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        조직도 데이터가 없습니다. config.json에 reporting 구조를 정의하세요.
      </div>
    );
  }

  return (
    <div className="h-[450px] border border-border rounded-lg overflow-hidden bg-background">
      <ReactFlow
        nodes={xyNodes}
        edges={xyEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.3 0 0)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function OrgChartView() {
  return (
    <ReactFlowProvider>
      <OrgChartInner />
    </ReactFlowProvider>
  );
}
