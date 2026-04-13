"use client";

/**
 * LiveFlowGraph — 실시간 에이전트 작업 흐름 DAG
 *
 * channel/general.md의 메시지 흐름(sender→@mention)을 파싱한
 * /api/flow 데이터를 @xyflow/react로 시각화합니다.
 *
 * - 노드: 에이전트 (상태별 색상 + 팀 배지)
 * - 엣지: 메시지 흐름 (타임스탬프 라벨 + 애니메이션)
 * - 레이아웃: 자동 계층 배치 (Orch 상단 → 팀별 하단)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import { AgentDetailPopover } from "./AgentDetailPopover";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
import { api, getCurrentProject } from "@/lib/api";
import { useSSE } from "@/hooks/useSSE";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Circle, Radio } from "lucide-react";
import type { TeamsMap } from "@/lib/types";

// ━━━ 타입 ━━━

interface FlowNode {
  id: string;
  label: string;
  team: string | null;
  teamLabel: string;
  state: string;
}

interface FlowEdge {
  source: string;
  target: string;
  timestamp: string;
}

interface FlowResponse {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ━━━ 노드 데이터 타입 ━━━

type FlowNodeData = {
  label: string;
  team: string | null;
  teamLabel: string;
  state: string;
};

type FlowNodeType = Node<FlowNodeData, "flow">;

// ━━━ 상태별 스타일 (unified from lib/format.ts) ━━━

function stateIcon(state: string) {
  switch (state) {
    case "working": return <Loader2 className="size-3 text-indigo-400 animate-spin" />;
    case "done": return <CheckCircle2 className="size-3 text-emerald-400" />;
    case "error": case "permanently-failed": case "dead": return <AlertCircle className="size-3 text-red-400" />;
    case "active": return <Circle className="size-3 text-indigo-400 fill-indigo-400" />;
    default: return <Circle className="size-3 text-muted-foreground/40 fill-muted-foreground/20" />;
  }
}

function agentColor(agent: string): string {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = agent.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 50%)`;
}

// ━━━ 커스텀 노드 ━━━

function FlowNodeRaw({ data }: NodeProps<FlowNodeType>) {
  const { label, team, teamLabel, state } = data;
  const c = stateColor(state);
  const dotColor = agentColor(label);

  return (
    <div className={cn("w-[160px] rounded-lg bg-card border shadow-sm", c.border)}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-muted-foreground !border-2 !border-background" />

      <div className="px-3 py-2.5 space-y-1.5">
        {/* 에이전트 이름 + 상태 */}
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="text-sm font-semibold truncate flex-1">{label}</span>
          {stateIcon(state)}
        </div>

        {/* 팀 배지 */}
        {teamLabel && (
          <Badge variant="outline" className="text-[9px] w-fit">
            {teamLabel}
          </Badge>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-muted-foreground !border-2 !border-background" />
    </div>
  );
}

const FlowNodeComponent = memo(FlowNodeRaw);
FlowNodeComponent.displayName = "FlowNode";

const nodeTypes = { flow: FlowNodeComponent };

// ━━━ 자동 레이아웃 (계층적 배치) ━━━

function autoLayout(flowNodes: FlowNode[], flowEdges: FlowEdge[]): { nodes: Node[]; edges: Edge[] } {
  if (flowNodes.length === 0) return { nodes: [], edges: [] };

  // 인접 리스트 + 진입 차수
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  for (const n of flowNodes) {
    adj[n.id] = [];
    inDeg[n.id] = 0;
  }
  for (const e of flowEdges) {
    if (adj[e.source]) adj[e.source].push(e.target);
    inDeg[e.target] = (inDeg[e.target] ?? 0) + 1;
  }

  // BFS 레벨 할당
  const level: Record<string, number> = {};
  const queue = flowNodes.filter((n) => (inDeg[n.id] ?? 0) === 0).map((n) => n.id);
  for (const id of queue) level[id] = 0;

  let qi = 0;
  while (qi < queue.length) {
    const curr = queue[qi++];
    for (const next of adj[curr] ?? []) {
      level[next] = Math.max(level[next] ?? 0, (level[curr] ?? 0) + 1);
      inDeg[next]--;
      if (inDeg[next] === 0) queue.push(next);
    }
  }
  // 레벨이 없는 노드 (고립) → 마지막 레벨+1
  const maxLevel = Math.max(...Object.values(level), 0);
  for (const n of flowNodes) {
    if (level[n.id] === undefined) level[n.id] = maxLevel + 1;
  }

  // 레벨별 그룹핑
  const levels: Record<number, FlowNode[]> = {};
  for (const n of flowNodes) {
    const lv = level[n.id] ?? 0;
    (levels[lv] ??= []).push(n);
  }

  // 좌표 계산
  const NODE_W = 160;
  const NODE_H = 80;
  const GAP_X = 40;
  const GAP_Y = 100;

  const xyNodes: Node[] = [];
  for (const [lv, members] of Object.entries(levels)) {
    const lvNum = Number(lv);
    const totalWidth = members.length * NODE_W + (members.length - 1) * GAP_X;
    const startX = -totalWidth / 2;

    members.forEach((n, i) => {
      xyNodes.push({
        id: n.id,
        type: "flow",
        position: { x: startX + i * (NODE_W + GAP_X), y: lvNum * (NODE_H + GAP_Y) },
        data: {
          label: n.label,
          team: n.team,
          teamLabel: n.teamLabel,
          state: n.state,
        },
      });
    });
  }

  const xyEdges: Edge[] = flowEdges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.timestamp || undefined,
    animated: true,
    style: { stroke: "oklch(0.6 0.05 285)", strokeWidth: 2 },
    labelStyle: { fontSize: 10, fill: "oklch(0.5 0 0)" },
  }));

  return { nodes: xyNodes, edges: xyEdges };
}

// ━━━ 메인 컴포넌트 ━━━

interface Props {
  teams: TeamsMap;
  onOpenTerminal?: (agentId: string) => void;
  onNavigateToProfile?: (agentId: string) => void;
}

function LiveFlowGraphInner({ teams, onOpenTerminal, onNavigateToProfile }: Props) {
  const [flowData, setFlowData] = useState<FlowResponse | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; position: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { flowToScreenPosition } = useReactFlow();

  // SSE: message_routed 이벤트 수신 → 즉시 갱신
  const handleActivity = useCallback((line: string) => {
    // SSE activity에 message_routed가 오면 flow 데이터 리프레시
    if (line.includes("message_routed") || line.includes("→")) {
      api.flow().then(setFlowData).catch(() => {});
    }
    setSseConnected(true);
    // 10초 이내에 다음 이벤트가 없으면 disconnected로 간주
    if (sseTimerRef.current) clearTimeout(sseTimerRef.current);
    sseTimerRef.current = setTimeout(() => setSseConnected(false), 10000);
  }, []);

  const handleAgentOutput = useCallback(() => {}, []);

  useSSE(handleActivity, handleAgentOutput, {
    enabled: true,
    reconnectInterval: 3000,
    project: getCurrentProject(),
  });

  // SSE fallback: 30초 폴링 (SSE가 끊길 때 대비)
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await api.flow();
        if (!cancelled) setFlowData(data);
      } catch { /* */ }
    }

    poll();
    const t = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!flowData) return { nodes: [], edges: [] };
    return autoLayout(flowData.nodes, flowData.edges);
  }, [flowData]);

  // ── 노드 클릭 핸들러 ──

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const screenPos = flowToScreenPosition({ x: node.position.x + 80, y: node.position.y + 70 });
    const containerRect = containerRef.current?.getBoundingClientRect();
    const offsetX = containerRect ? screenPos.x - containerRect.left : screenPos.x;
    const offsetY = containerRect ? screenPos.y - containerRect.top : screenPos.y;
    setSelectedAgent({ id: node.id, position: { x: offsetX, y: offsetY } });
  }, [flowToScreenPosition]);

  if (!flowData || flowData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground border border-dashed border-border rounded-lg">
        작업 흐름이 없습니다. 태스크를 실행하면 에이전트 간 메시지 흐름이 여기에 표시됩니다.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-[400px] border border-border rounded-lg overflow-hidden bg-background relative">
      {/* SSE 연결 상태 인디케이터 */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 bg-card/80 backdrop-blur-sm rounded-full px-2 py-1 border border-border/50">
        <Radio className={cn("size-3", sseConnected ? "text-emerald-400" : "text-zinc-500")} />
        <span className="text-[9px] text-muted-foreground">{sseConnected ? "Live" : "Polling"}</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
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

export function LiveFlowGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <LiveFlowGraphInner teams={props.teams} onOpenTerminal={props.onOpenTerminal} onNavigateToProfile={props.onNavigateToProfile} />
    </ReactFlowProvider>
  );
}
