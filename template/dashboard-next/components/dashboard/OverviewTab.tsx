"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  STATE_RANK,
  formatElapsed,
  formatTokens,
  stateColor,
} from "@/lib/format";
import type {
  Agent,
  ChannelResponse,
  StateResponse,
  TasksResponse,
  WorkflowsResponse,
} from "@/lib/types";

interface Props {
  state: StateResponse | null;
  workflows: WorkflowsResponse | null;
  channel: ChannelResponse | null;
  tasks: TasksResponse | null;
  onJump: (tab: string) => void;
}

const LEGEND = [
  { state: "working", label: "working" },
  { state: "idle", label: "idle" },
  { state: "compacting", label: "compacting" },
  { state: "paused", label: "paused" },
  { state: "error", label: "error" },
] as const;

export function OverviewTab({
  state,
  workflows,
  channel,
  tasks,
  onJump,
}: Props) {
  const agents = state?.agents ?? [];
  const working = agents.filter((a) => a.state === "working").length;
  const total = state?.total_tokens ?? 0;
  const limit = state?.cost_limit ?? 200_000;
  const pct = limit > 0 ? Math.min(100, Math.round((total / limit) * 100)) : 0;
  const wfActive = workflows?.active?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Active"
          value={String(agents.length)}
          sub="agents"
          onClick={() => onJump("agents")}
        />
        <KpiCard label="Working" value={String(working)} sub="in progress" />
        <Card className="cursor-default">
          <CardContent className="p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tokens
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatTokens(total)}
            </div>
            <Progress value={pct} className="h-1" />
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {pct}% of {formatTokens(limit)}
            </div>
          </CardContent>
        </Card>
        <KpiCard
          label="Workflows"
          value={String(wfActive)}
          sub="active"
          onClick={() => onJump("workflows")}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        {LEGEND.map((l) => {
          const c = stateColor(l.state as Agent["state"]);
          return (
            <span key={l.state} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", c.dot)} />
              {l.label}
            </span>
          );
        })}
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {[...agents]
          .sort(
            (a, b) =>
              (STATE_RANK[a.state] ?? 99) - (STATE_RANK[b.state] ?? 99)
          )
          .map((a) => (
            <AgentTile key={a.id} agent={a} />
          ))}
      </div>

      {/* Bottom split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Tasks</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {tasks?.tasks?.length ? (
              <ul className="space-y-1.5">
                {tasks.tasks.slice(0, 8).map((t, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 font-mono"
                  >
                    <span className="truncate">
                      {String(t.title ?? t.id ?? "task")}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {String(t.status ?? "—")}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No tasks yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Channel · last 10</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <ChannelLines lines={channel?.lines ?? []} max={10} />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? "cursor-pointer hover:border-violet-500/50 transition-colors" : ""}
    >
      <CardContent className="p-4 space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function AgentTile({ agent }: { agent: Agent }) {
  const c = stateColor(agent.state);
  return (
    <Card className="overflow-hidden relative">
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", c.bar)} />
      <CardContent className="p-3.5 pl-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{agent.label}</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {agent.id} · {agent.engine}
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn("text-[10px] font-mono", c.text, c.bg)}
          >
            {agent.state}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{formatElapsed(agent.elapsed)}</span>
          <span>{formatTokens(agent.tokens)} tok</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChannelLines({
  lines,
  max,
}: {
  lines: string[];
  max?: number;
}) {
  const subset = max ? lines.slice(-max) : lines;
  return (
    <div className="font-mono text-[11px] space-y-1">
      {subset.length === 0 ? (
        <p className="text-muted-foreground">No messages.</p>
      ) : (
        subset.map((line, i) => {
          const m = line.match(/^\[([^→\]]+)→([^\]]+)\]\s*(.*)$/);
          if (m) {
            return (
              <div key={i} className="flex gap-2">
                <span className="text-violet-400">{m[1]}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-emerald-400">{m[2]}</span>
                <span className="text-foreground/90 truncate">{m[3]}</span>
              </div>
            );
          }
          return (
            <div key={i} className="text-muted-foreground truncate">
              {line}
            </div>
          );
        })
      )}
    </div>
  );
}
