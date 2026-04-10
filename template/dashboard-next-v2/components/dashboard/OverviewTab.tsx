"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  state: StateResponse | null;
  agents: AgentsResponse | null;
  activityEntries: ActivityEntry[];
  onOpenTerminal?: (agentId: string) => void;
  projectActive?: boolean;
}

/**
 * Overview 탭.
 * - KPI 카드 5개: 총 에이전트, 작업중, 완료, 대기(idle), 이벤트 수
 * - Agent 그리드: id, state, last_message, timestamp
 */
export function OverviewTab({ state, agents, activityEntries, onOpenTerminal, projectActive = true }: Props) {
  // inactive 프로젝트면 모든 에이전트를 offline으로 강제
  const rawStatuses = state?.agents ?? [];
  const agentStatuses = projectActive
    ? rawStatuses
    : rawStatuses.map((a) => ({ ...a, state: "offline" as const, last_message: "", timestamp: "" }));

  const totalAgents = agents?.agents?.length ?? agentStatuses.length;
  const working = projectActive ? agentStatuses.filter((a) => a.state === "working").length : 0;
  const done = projectActive ? agentStatuses.filter((a) => a.state === "done").length : 0;
  const idle = projectActive ? agentStatuses.filter((a) => a.state === "idle").length : 0;
  const offline = projectActive ? 0 : totalAgents;
  const eventCount = activityEntries.length;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          icon={<Users className="size-4 text-violet-400" />}
          label="Total Agents"
          value={totalAgents}
        />
        <KpiCard
          icon={<Loader2 className="size-4 text-violet-400 animate-spin" />}
          label="Working"
          value={working}
          accent={working > 0}
        />
        <KpiCard
          icon={<CheckCircle2 className="size-4 text-emerald-400" />}
          label="Done"
          value={done}
        />
        <KpiCard
          icon={<Clock className="size-4 text-zinc-400" />}
          label={projectActive ? "Idle" : "Offline"}
          value={projectActive ? idle : offline}
        />
        <KpiCard
          icon={<Activity className="size-4 text-amber-400" />}
          label="Events"
          value={eventCount}
        />
      </div>

      {/* Agent Grid */}
      {agentStatuses.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No agents running. Go to the Agents tab to add agents.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {agentStatuses.map((agent) => (
            <AgentStatusCard key={agent.id} agent={agent} onOpenTerminal={onOpenTerminal} />
          ))}
        </div>
      )}
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
  onOpenTerminal,
}: {
  agent: StateResponse["agents"][number];
  onOpenTerminal?: (agentId: string) => void;
}) {
  const c = stateColor(agent.state);

  return (
    <Card className="overflow-hidden relative group">
      {/* 좌측 색상 바 */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", c.bar)} />
      <CardContent className="p-3.5 pl-4 space-y-2">
        {/* 상단: ID + 상태 배지 + 터미널 버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold font-mono truncate">
            {agent.id}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenTerminal && (
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                onClick={() => onOpenTerminal(agent.id)}
                title={`Open ${agent.id} terminal`}
              >
                <Terminal className="size-3" />
              </Button>
            )}
            <Badge
              variant="outline"
              className={cn("text-[10px] font-mono", c.text, c.bg)}
            >
              {agent.state}
            </Badge>
          </div>
        </div>

        {/* 최근 메시지 */}
        <p className="text-[11px] text-muted-foreground line-clamp-2 min-h-[2rem]">
          {agent.last_message || "No recent message"}
        </p>

        {/* 타임스탬프 */}
        <div className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">
          {agent.timestamp || "--"}
        </div>
      </CardContent>
    </Card>
  );
}
