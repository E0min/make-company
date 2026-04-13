"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
import { api } from "@/lib/api";
import type {
  StateResponse,
  AgentsResponse,
  ActivityEntry,
} from "@/lib/types";
import {
  Users,
  Loader2,
  CheckCircle2,
  Clock,
  Activity,
  Terminal,
  LayoutGrid,
  Rows3,
  GitBranch,
  Network,
  Download,
  Ticket,
  Play,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveFlowGraph } from "./LiveFlowGraph";
import { OrgChartView } from "./OrgChartView";
import { AgentDetailPopover } from "./AgentDetailPopover";

type TeamMetrics = Record<string, { tickets: Record<string, number>; events_24h: number; agents: number; wip_usage: string }>;

interface Props {
  state: StateResponse | null;
  agents: AgentsResponse | null;
  activityEntries: ActivityEntry[];
  onOpenTerminal?: (agentId: string) => void;
  projectActive?: boolean;
}

type ViewMode = "flat" | "team" | "flow" | "org";

export function OverviewTab({ state, agents, activityEntries, onOpenTerminal, projectActive = true }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [teamMetrics, setTeamMetrics] = useState<TeamMetrics | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; position: { x: number; y: number } } | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // 팀별 뷰 진입 시 메트릭 fetch
  useEffect(() => {
    if (viewMode === "team") {
      api.teamMetrics().then((r) => setTeamMetrics(r.teams ?? null)).catch(() => setTeamMetrics(null));
    }
  }, [viewMode]);

  // config.json 기준 활성 에이전트만 (server Phase 1에서 이미 config 기준으로 반환)
  const rawStatuses = state?.agents ?? [];
  const agentStatuses = projectActive
    ? rawStatuses
    : rawStatuses.map((a) => ({ ...a, state: "offline" as const, last_message: "", timestamp: "" }));

  const teams = state?.teams ?? {};
  const totalAgents = agentStatuses.length;
  const working = projectActive ? agentStatuses.filter((a) => a.state === "working").length : 0;
  const done = projectActive ? agentStatuses.filter((a) => a.state === "done").length : 0;
  const idle = projectActive ? agentStatuses.filter((a) => a.state === "idle" || a.state === "active").length : 0;
  const offline = projectActive ? 0 : totalAgents;
  const eventCount = activityEntries.length;

  // ── 에이전트 카드 클릭 핸들러 ──
  const handleCardClick = (agentId: string, rect: DOMRect) => {
    const containerRect = gridContainerRef.current?.getBoundingClientRect();
    const x = containerRect
      ? rect.left + rect.width / 2 - containerRect.left
      : rect.left + rect.width / 2;
    const y = containerRect
      ? rect.bottom - containerRect.top
      : rect.bottom;
    setSelectedAgent({ id: agentId, position: { x, y } });
  };

  // 팀별 그룹핑
  const teamGroups = viewMode === "team"
    ? (() => {
        const groups: Record<string, typeof agentStatuses> = {};
        for (const a of agentStatuses) {
          const key = a.team ?? "__none__";
          (groups[key] ??= []).push(a);
        }
        return groups;
      })()
    : null;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={<Users className="size-4 text-violet-400" />} label="Active Agents" value={totalAgents} />
        <KpiCard icon={<Loader2 className="size-4 text-violet-400 animate-spin" />} label="Working" value={working} accent={working > 0} />
        <KpiCard icon={<CheckCircle2 className="size-4 text-emerald-400" />} label="Done" value={done} />
        <KpiCard icon={<Clock className="size-4 text-zinc-400" />} label={projectActive ? "Idle" : "Offline"} value={projectActive ? idle : offline} />
        <KpiCard icon={<Activity className="size-4 text-amber-400" />} label="Events" value={eventCount} />
      </div>

      {/* Agent Grid Header + 뷰 모드 토글 */}
      {agentStatuses.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {totalAgents} agents {Object.keys(teams).length > 0 && `· ${Object.keys(teams).length} teams`}
          </span>
          <div className="flex gap-1">
            {([
              { mode: "flat" as const, icon: <LayoutGrid className="size-3" />, label: "그리드" },
              { mode: "team" as const, icon: <Rows3 className="size-3" />, label: "팀별" },
              { mode: "flow" as const, icon: <GitBranch className="size-3" />, label: "흐름" },
              { mode: "org" as const, icon: <Network className="size-3" />, label: "조직도" },
            ]).map((v) => (
              <Button
                key={v.mode}
                variant={viewMode === v.mode ? "secondary" : "ghost"}
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => setViewMode(v.mode)}
              >
                {v.icon}
                {v.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Agent Grid */}
      {/* 흐름 뷰 */}
      {viewMode === "flow" && (
        <LiveFlowGraph teams={teams} onOpenTerminal={onOpenTerminal} />
      )}

      {/* 조직도 뷰 */}
      {viewMode === "org" && (
        <OrgChartView onOpenTerminal={onOpenTerminal} />
      )}

      {/* 그리드 / 팀별 뷰 */}
      {viewMode !== "flow" && viewMode !== "org" && agentStatuses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 space-y-6">
            <div className="text-center space-y-1">
              <h3 className="text-base font-semibold">시작 가이드</h3>
              <p className="text-sm text-muted-foreground">4단계로 Virtual Company를 시작하세요</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {([
                { step: 1, icon: <Users className="size-5 text-violet-400" />, title: "팀 만들기", desc: "Agents 탭에서 팀을 구성하세요" },
                { step: 2, icon: <Download className="size-5 text-emerald-400" />, title: "에이전트 추가", desc: "Import Global로 에이전트를 추가하세요" },
                { step: 3, icon: <Ticket className="size-5 text-amber-400" />, title: "첫 티켓 생성", desc: "Tickets 탭에서 첫 번째 티켓을 만드세요" },
                { step: 4, icon: <Play className="size-5 text-indigo-400" />, title: "태스크 시작", desc: "kickoff.sh로 태스크를 실행하세요" },
              ] as const).map((item) => (
                <div key={item.step} className="flex flex-col items-center text-center p-4 rounded-lg border border-border/50 bg-muted/10 space-y-2">
                  <div className="flex items-center justify-center size-10 rounded-full border border-border bg-muted/30">
                    {item.icon}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-muted-foreground">{item.step}.</span>
                    <span className="text-sm font-semibold">{item.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : viewMode !== "flow" && teamGroups ? (
        // 팀별 그룹 뷰
        <div ref={gridContainerRef} className="space-y-5 relative">
          {Object.entries(teamGroups).map(([teamKey, members]) => {
            const teamDef = teamKey === "__none__" ? null : teams[teamKey];
            const metrics = teamKey !== "__none__" ? teamMetrics?.[teamKey] : null;
            return (
              <div key={teamKey}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {teamDef?.label ?? "소속 없음"}
                  </h3>
                  <Badge variant="outline" className="text-[9px]">{members.length}</Badge>
                  {/* 팀 메트릭 */}
                  {metrics && (
                    <div className="flex items-center gap-3 ml-auto text-[10px] text-muted-foreground font-mono tabular-nums">
                      {metrics.tickets.in_progress != null && (
                        <span className="flex items-center gap-1">
                          <Loader2 className="size-2.5 text-indigo-400" />
                          {metrics.tickets.in_progress}
                        </span>
                      )}
                      {metrics.tickets.review != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-2.5 text-amber-400" />
                          {metrics.tickets.review}
                        </span>
                      )}
                      {metrics.tickets.done != null && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="size-2.5 text-emerald-400" />
                          {metrics.tickets.done}
                        </span>
                      )}
                      <span className="border-l border-border/30 pl-3 flex items-center gap-1">
                        WIP {metrics.wip_usage}
                      </span>
                      <span className="flex items-center gap-1">
                        <BarChart3 className="size-2.5" />
                        {metrics.events_24h} events/24h
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {members.map((agent) => (
                    <AgentStatusCard key={agent.id} agent={agent} teams={teams} onOpenTerminal={onOpenTerminal} onCardClick={handleCardClick} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* 에이전트 상세 팝오버 */}
          {selectedAgent && (
            <AgentDetailPopover
              agentId={selectedAgent.id}
              position={selectedAgent.position}
              onClose={() => setSelectedAgent(null)}
              onOpenTerminal={onOpenTerminal}
            />
          )}
        </div>
      ) : viewMode !== "flow" ? (
        // 플랫 뷰
        <div ref={gridContainerRef} className="relative">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {agentStatuses.map((agent) => (
              <AgentStatusCard key={agent.id} agent={agent} teams={teams} onOpenTerminal={onOpenTerminal} onCardClick={handleCardClick} />
            ))}
          </div>

          {/* 에이전트 상세 팝오버 */}
          {selectedAgent && (
            <AgentDetailPopover
              agentId={selectedAgent.id}
              position={selectedAgent.position}
              onClose={() => setSelectedAgent(null)}
              onOpenTerminal={onOpenTerminal}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── KPI Card ── */

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </div>
        <div
          className={cn(
            "text-2xl font-semibold tabular-nums",
            accent && "text-violet-400"
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Agent Status Card ── */

function AgentStatusCard({
  agent,
  teams,
  onOpenTerminal,
  onCardClick,
}: {
  agent: StateResponse["agents"][number];
  teams: StateResponse["teams"];
  onOpenTerminal?: (agentId: string) => void;
  onCardClick?: (agentId: string, rect: DOMRect) => void;
}) {
  const c = stateColor(agent.state);
  const teamLabel = agent.team && teams[agent.team] ? teams[agent.team].label : null;
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (onCardClick && cardRef.current) {
      onCardClick(agent.id, cardRef.current.getBoundingClientRect());
    }
  };

  return (
    <Card
      ref={cardRef}
      className="overflow-hidden relative group cursor-pointer transition-colors hover:ring-1 hover:ring-foreground/20"
      onClick={handleClick}
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", c.bar)} />
      <CardContent className="p-3.5 pl-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold font-mono truncate">{agent.id}</div>
            {teamLabel && (
              <span className="text-[9px] text-muted-foreground/60">{teamLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenTerminal && (
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); onOpenTerminal(agent.id); }}
                title={`Open ${agent.id} terminal`}
              >
                <Terminal className="size-3" />
              </Button>
            )}
            <Badge variant="outline" className={cn("text-[10px] font-mono", c.text, c.bg)}>
              {agent.state}
            </Badge>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-2 min-h-[2rem]">
          {agent.last_message || "No recent message"}
        </p>
        <div className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">
          {agent.timestamp || "--"}
        </div>
      </CardContent>
    </Card>
  );
}
