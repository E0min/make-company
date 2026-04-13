"use client";

import { useState, useEffect } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HarnessSummary } from "@/lib/types";
import {
  Shield,
  GitBranch,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  ChevronRight,
  Users,
  Gauge,
} from "lucide-react";

/* ━━━ Helper: format timestamp ━━━ */

function formatTs(ts: string | null): string {
  if (!ts) return "never";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ko-KR", { hour12: false }) + " " + d.toLocaleDateString("ko-KR");
  } catch {
    return ts;
  }
}

/* ━━━ Helper: relative time ━━━ */

function relativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return ts;
  }
}

/* ━━━ Main Component ━━━ */

export function HarnessTab() {
  const [data, setData] = useState<HarnessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCurrentProject()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.harnessSummary();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">Loading harness data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-red-400">
          Failed to load harness data: {error}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No harness data available. Select a project first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column: Hooks + Gates */}
      <div className="space-y-6">
        <HookStatsSection hooks={data.hooks} />
        <GateHistorySection gates={data.gates} />
      </div>
      {/* Right column: Skills + Workflow */}
      <div className="space-y-6">
        <SkillPipelineSection skills={data.skills} />
        <WorkflowRuleMapSection workflow={data.workflow} />
      </div>
    </div>
  );
}

/* ━━━ Section 1: Hook Execution Stats ━━━ */

function HookStatsSection({ hooks }: { hooks: HarnessSummary["hooks"] }) {
  const rows = [
    {
      name: "agent-harness",
      executions: hooks.agent_harness.executions,
      lastRun: hooks.agent_harness.last_run,
      badges: [
        { label: `${hooks.agent_harness.warnings} warn`, color: hooks.agent_harness.warnings > 0 ? "text-amber-400 bg-amber-400/10 border-amber-400/30" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/30" },
        { label: `${hooks.agent_harness.blocks} block`, color: hooks.agent_harness.blocks > 0 ? "text-red-400 bg-red-400/10 border-red-400/30" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/30" },
      ],
    },
    {
      name: "post-tool-use",
      executions: hooks.post_tool_use.executions,
      lastRun: null,
      badges: [
        { label: `${hooks.post_tool_use.commits_tagged} commits`, color: "text-indigo-400 bg-indigo-400/10 border-indigo-400/30" },
        { label: `${hooks.post_tool_use.auto_verify_pass} pass`, color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
        { label: `${hooks.post_tool_use.auto_verify_fail} fail`, color: hooks.post_tool_use.auto_verify_fail > 0 ? "text-red-400 bg-red-400/10 border-red-400/30" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/30" },
      ],
    },
    {
      name: "ticket-context",
      executions: hooks.ticket_context.executions,
      lastRun: null,
      badges: [
        { label: `${hooks.ticket_context.wip_warnings} WIP warn`, color: hooks.ticket_context.wip_warnings > 0 ? "text-amber-400 bg-amber-400/10 border-amber-400/30" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/30" },
        { label: `${hooks.ticket_context.goal_warnings} goal warn`, color: hooks.ticket_context.goal_warnings > 0 ? "text-amber-400 bg-amber-400/10 border-amber-400/30" : "text-zinc-500 bg-zinc-500/10 border-zinc-500/30" },
      ],
    },
  ];

  const maxExec = Math.max(...rows.map((r) => r.executions), 1);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Shield className="size-4 text-indigo-400" />
        Hook Execution Stats
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          {rows.map((row) => (
            <div key={row.name} className="space-y-2">
              {/* Header: name + count */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-medium">{row.name}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px] tabular-nums font-mono">
                    {row.executions} runs
                  </Badge>
                  {row.lastRun && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatTs(row.lastRun)}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full rounded-sm bg-zinc-800">
                <div
                  className="h-full rounded-sm bg-indigo-500/70 transition-all"
                  style={{ width: `${(row.executions / maxExec) * 100}%` }}
                />
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                {row.badges.map((b) => (
                  <Badge
                    key={b.label}
                    variant="outline"
                    className={cn("text-[9px] font-mono", b.color)}
                  >
                    {b.label}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

/* ━━━ Section 2: Gate Pass/Reject History ━━━ */

function GateHistorySection({ gates }: { gates: HarnessSummary["gates"] }) {
  const passRate = gates.total_checks > 0
    ? Math.round((gates.passed / gates.total_checks) * 100)
    : 0;

  // SVG circular progress
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (passRate / 100) * circumference;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Gauge className="size-4 text-emerald-400" />
        Gate Pass/Reject History
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Pass rate indicator */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
                <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-800" />
                <circle
                  cx="36" cy="36" r={radius}
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className={passRate >= 80 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-red-400"}
                  stroke="currentColor"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
                {passRate}%
              </span>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Pass Rate</div>
              <div className="flex gap-3 text-[11px] tabular-nums">
                <span className="text-emerald-400">{gates.passed} passed</span>
                <span className="text-red-400">{gates.rejected} rejected</span>
                <span className="text-muted-foreground">{gates.total_checks} total</span>
              </div>
            </div>
          </div>

          {/* Recent gate events */}
          {gates.recent.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-2">
              No recent gate events.
            </div>
          ) : (
            <div className="space-y-1.5">
              {gates.recent.slice(0, 10).map((evt, i) => (
                <div
                  key={`${evt.ticket}-${evt.gate}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[11px]"
                >
                  {evt.result === "pass" ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-3.5 text-red-400 shrink-0" />
                  )}
                  <span className="font-mono text-muted-foreground shrink-0">{evt.ticket}</span>
                  <span className="text-muted-foreground shrink-0">{evt.gate}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono shrink-0",
                      evt.result === "pass"
                        ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"
                        : "text-red-400 bg-red-400/10 border-red-400/30"
                    )}
                  >
                    {evt.result}
                  </Badge>
                  <span className="truncate text-muted-foreground flex-1">{evt.reason}</span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
                    {relativeTime(evt.ts)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ━━━ Section 3: Skill Pipeline ━━━ */

function SkillPipelineSection({ skills }: { skills: HarnessSummary["skills"] }) {
  const complianceRate = skills.total_checks > 0
    ? Math.round((skills.compliant / skills.total_checks) * 100)
    : 0;

  const agents = Object.entries(skills.by_agent);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Zap className="size-4 text-amber-400" />
        Skill Pipeline
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Enforcement mode + compliance */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono uppercase",
                  skills.enforcement === "strict"
                    ? "text-indigo-400 bg-indigo-400/10 border-indigo-400/30"
                    : "text-zinc-400 bg-zinc-400/10 border-zinc-400/30"
                )}
              >
                {skills.enforcement}
              </Badge>
              <span className="text-sm font-medium">Enforcement</span>
            </div>
            <div className="text-sm tabular-nums font-mono">
              <span className={complianceRate >= 80 ? "text-emerald-400" : complianceRate >= 50 ? "text-amber-400" : "text-red-400"}>
                {complianceRate}%
              </span>
              <span className="text-muted-foreground ml-1.5 text-[11px]">
                ({skills.compliant}/{skills.total_checks})
              </span>
            </div>
          </div>

          {/* Global compliance bar */}
          <div className="h-2 w-full rounded-sm bg-zinc-800">
            <div
              className={cn(
                "h-full rounded-sm transition-all",
                complianceRate >= 80 ? "bg-emerald-500/70" : complianceRate >= 50 ? "bg-amber-500/70" : "bg-red-500/70"
              )}
              style={{ width: `${complianceRate}%` }}
            />
          </div>

          {/* Per-agent visual pipeline */}
          {agents.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-2">
              No per-agent skill data.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                Per-Agent Skill Pipeline
              </div>
              {agents.map(([agent, stats]) => {
                const total = stats.compliant + stats.missing;
                const pct = total > 0 ? Math.round((stats.compliant / total) * 100) : 0;
                const textColor = pct >= 100 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";

                // Build skill badges: compliant ones are green, missing ones are red
                // We know the counts but not individual names from by_agent alone.
                // Show visual representation: N green badges + M red badges
                const compliantCount = stats.compliant;
                const missingCount = stats.missing;

                return (
                  <div key={agent} className="rounded-md border border-border/50 px-3 py-2.5 space-y-2">
                    {/* Agent header */}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-medium text-foreground/80">{agent}</span>
                      <span className={cn("text-[10px] tabular-nums font-mono font-medium", textColor)}>
                        {pct}%
                      </span>
                    </div>

                    {/* Skill pipeline flow */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* Compliant skills */}
                      {(stats.compliant_skills?.length
                        ? stats.compliant_skills
                        : Array.from({ length: compliantCount }, (_, i) => `skill-${i + 1}`)
                      ).map((skill, idx, arr) => (
                        <span key={`ok-${skill}`} className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono text-emerald-400 bg-emerald-400/10 border-emerald-400/30 gap-0.5"
                          >
                            <CheckCircle2 className="size-2.5" />
                            {skill}
                          </Badge>
                          {idx < arr.length - 1 || missingCount > 0 ? (
                            <ArrowRight className="size-2.5 text-muted-foreground/40 shrink-0" />
                          ) : null}
                        </span>
                      ))}
                      {/* Missing skills */}
                      {(stats.missing_skills?.length
                        ? stats.missing_skills
                        : Array.from({ length: missingCount }, (_, i) => `missing-${i + 1}`)
                      ).map((skill, idx, arr) => (
                        <span key={`miss-${skill}`} className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono text-red-400 bg-red-400/10 border-red-400/30 gap-0.5"
                          >
                            <XCircle className="size-2.5" />
                            {skill}
                          </Badge>
                          {idx < arr.length - 1 ? (
                            <ArrowRight className="size-2.5 text-muted-foreground/40 shrink-0" />
                          ) : null}
                        </span>
                      ))}
                    </div>

                    {/* Compact progress bar */}
                    <div className="h-1 w-full rounded-sm bg-zinc-800">
                      <div
                        className={cn(
                          "h-full rounded-sm transition-all",
                          pct >= 100 ? "bg-emerald-500/70" : pct >= 50 ? "bg-amber-500/70" : "bg-red-500/70"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ━━━ Section 4: Workflow Rule Map ━━━ */

function WorkflowRuleMapSection({ workflow }: { workflow: HarnessSummary["workflow"] }) {
  const templates = Object.entries(workflow.templates);
  const gateEntries = Object.entries(workflow.gates);
  const stepSkillEntries = Object.entries(workflow.step_skills);
  const criticEntries = Object.entries(workflow.critic_loop);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <GitBranch className="size-4 text-violet-400" />
        Workflow Rule Map
      </h2>

      {/* Workflow templates */}
      {templates.map(([name, tmpl]) => (
        <Card key={name}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] font-mono">{name}</Badge>
              <span className="text-[10px] text-muted-foreground">{tmpl.steps.length} steps</span>
            </div>

            {/* Step chain */}
            <div className="flex flex-wrap items-center gap-1">
              {tmpl.steps.map((step, i) => (
                <span key={step} className="flex items-center gap-1">
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-border/50 text-foreground/80">
                    {step}
                  </span>
                  {i < tmpl.steps.length - 1 && (
                    <ChevronRight className="size-3 text-muted-foreground/50" />
                  )}
                </span>
              ))}
            </div>

            {/* Required before */}
            {tmpl.required_before && Object.keys(tmpl.required_before).length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                  Required Before
                </div>
                {Object.entries(tmpl.required_before).map(([step, deps]) => (
                  <div key={step} className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-mono text-amber-400">{step}</span>
                    <ArrowRight className="size-3 text-muted-foreground/50" />
                    <span className="text-muted-foreground">needs</span>
                    {deps.map((dep) => (
                      <Badge key={dep} variant="outline" className="text-[9px] font-mono text-zinc-400 bg-zinc-400/10 border-zinc-400/30">
                        {dep}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Quality Gates */}
      {gateEntries.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
              Quality Gates
            </div>
            {gateEntries.map(([transition, gate]) => (
              <div key={transition} className="space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono font-medium text-indigo-400">{transition}</span>
                  <ArrowRight className="size-3 text-muted-foreground/50" />
                  <span className="text-muted-foreground">reviewer:</span>
                  <Badge variant="secondary" className="text-[9px] font-mono">{gate.reviewer}</Badge>
                </div>
                <div className="flex flex-wrap gap-1 ml-4">
                  {gate.criteria.map((c) => (
                    <Badge key={c} variant="outline" className="text-[9px] text-zinc-400 bg-zinc-400/10 border-zinc-400/30">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* WIP Limits */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
            WIP Limits
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{workflow.wip_limits.global}</div>
              <div className="text-[10px] text-muted-foreground">Global</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{workflow.wip_limits.per_agent}</div>
              <div className="text-[10px] text-muted-foreground">Per Agent</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{workflow.wip_limits.per_team}</div>
              <div className="text-[10px] text-muted-foreground">Per Team</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critic Loop */}
      {criticEntries.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="size-3.5 text-violet-400" />
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                Critic Loop
              </span>
            </div>
            <div className="space-y-1.5">
              {criticEntries.map(([agent, critic]) => (
                <div key={agent} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-foreground/80">{agent}</span>
                  <ArrowRight className="size-3 text-muted-foreground/50" />
                  <span className="font-mono text-violet-400">{critic}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step Skills */}
      {stepSkillEntries.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 text-amber-400" />
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                Step Skills
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] font-mono uppercase ml-auto",
                  workflow.skill_enforcement === "strict"
                    ? "text-indigo-400 bg-indigo-400/10 border-indigo-400/30"
                    : "text-zinc-400 bg-zinc-400/10 border-zinc-400/30"
                )}
              >
                {workflow.skill_enforcement}
              </Badge>
            </div>
            {stepSkillEntries.map(([step, agentSkills]) => (
              <div key={step} className="space-y-1.5">
                <div className="text-[11px] font-mono font-medium text-indigo-400">{step}</div>
                {Object.entries(agentSkills).map(([agent, skillList]) => (
                  <div key={agent} className="flex items-start gap-2 ml-3 text-[11px]">
                    <span className="font-mono text-muted-foreground shrink-0">{agent}:</span>
                    <div className="flex flex-wrap gap-1">
                      {skillList.map((skill) => (
                        <Badge key={skill} variant="outline" className="text-[9px] font-mono text-amber-400 bg-amber-400/10 border-amber-400/30">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
