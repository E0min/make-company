"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Controls, Background, BackgroundVariant,
  Handle, Position, useReactFlow, type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Circle, ArrowDown } from "lucide-react";
import { AgentDetailPopover } from "./AgentDetailPopover";

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

// ━━━ Org 노드 컴포넌트 ━━━

function OrgNodeRaw({ data }: NodeProps<OrgNodeType>) {
  const c = stateColor(data.state);
  const hb = data.heartbeat as Record<string, string | number> | null;

  return (
    <div className={cn("w-[180px] rounded-lg bg-card border shadow-sm", c.border)}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-muted-foreground !border-2 !border-background" />

      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full shrink-0", c.dot)} />
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

interface OrgChartProps {
  onOpenTerminal?: (agentId: string) => void;
  onNavigateToProfile?: (agentId: string) => void;
  teams?: Record<string, { label: string; description: string }>;
}

function OrgChartInner({ onOpenTerminal, onNavigateToProfile, teams }: OrgChartProps) {
  const [data, setData] = useState<{ nodes: OrgNode[]; edges: { source: string; target: string }[] } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; position: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { flowToScreenPosition } = useReactFlow();

  useEffect(() => {
    api.orgchart().then(setData).catch(() => setData(null));
  }, []);

  const { xyNodes, xyEdges } = useMemo(() => {
    if (!data) return { xyNodes: [], xyEdges: [] };
    return autoLayout(data.nodes, data.edges);
  }, [data]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const screenPos = flowToScreenPosition({ x: node.position.x + 90, y: node.position.y + 70 });
    const containerRect = containerRef.current?.getBoundingClientRect();
    const offsetX = containerRect ? screenPos.x - containerRect.left : screenPos.x;
    const offsetY = containerRect ? screenPos.y - containerRect.top : screenPos.y;
    setSelectedAgent({ id: node.id, position: { x: offsetX, y: offsetY } });
  }, [flowToScreenPosition]);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        조직도 데이터가 없습니다. config.json에 reporting 구조를 정의하세요.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-[450px] border border-border rounded-lg overflow-hidden bg-background relative">
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
        elementsSelectable={true}
        onNodeClick={handleNodeClick}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.3 0 0)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* 에이전트 상세 팝오버 */}
      {selectedAgent && (
        <AgentDetailPopover
          agentId={selectedAgent.id}
          position={selectedAgent.position}
          onClose={() => setSelectedAgent(null)}
          onOpenTerminal={onOpenTerminal}
          onNavigateToProfile={onNavigateToProfile}
          teams={teams}
        />
      )}
    </div>
  );
}

export function OrgChartView(props: OrgChartProps) {
  return (
    <ReactFlowProvider>
      <OrgChartInner onOpenTerminal={props.onOpenTerminal} onNavigateToProfile={props.onNavigateToProfile} teams={props.teams} />
    </ReactFlowProvider>
  );
}
