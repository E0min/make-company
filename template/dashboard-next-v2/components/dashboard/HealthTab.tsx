"use client";
import { useState, useEffect, useCallback } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentScores, WorkflowAnalysis, Improvement } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Zap, Clock, BarChart3, Target, Search, UserPlus, Bell, MessageSquare, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/* ━━━ Helper types for fetched data ━━━ */

interface BottleneckAlert {
  icon: React.ReactNode;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
}

interface Suggestion {
  type: string;
  message: string;
  severity: string;
  ticket?: string;
  agent?: string;
}

interface InsightsData {
  total_events: number;
  agent_activity: Record<string, number>;
  gate_rejections: number;
  cycle_times: { ticket: string; title: string; seconds: number }[];
  avg_cycle_seconds: number;
  status_counts: Record<string, number>;
  suggestions?: Suggestion[];
}

/* ━━━ Remediation action config per suggestion type ━━━ */

interface ActionConfig {
  label: string;
  icon: React.ReactNode;
  confirm: string;
  execute: (suggestion: Suggestion) => Promise<string>;
}

function getActionConfig(type: string): ActionConfig | null {
  switch (type) {
    case "stuck":
      return {
        label: "에스컬레이션",
        icon: <AlertTriangle className="size-3" />,
        confirm: "이 티켓을 에스컬레이션 하시겠습니까?",
        execute: async (s) => {
          if (!s.ticket) throw new Error("티켓 정보 없음");
          await api.ticketComment(s.ticket, "Stuck >48h -- escalation. review required", "system");
          return `${s.ticket} 에스컬레이션 완료`;
        },
      };
    case "idle_agent":
      return {
        label: "핑 보내기",
        icon: <Bell className="size-3" />,
        confirm: "이 에이전트에게 핑을 보내시겠습니까?",
        execute: async (s) => {
          if (!s.agent) throw new Error("에이전트 정보 없음");
          const ticketId = s.ticket ?? s.message.match(/TASK-\d+/)?.[0];
          if (!ticketId) throw new Error("관련 티켓 없음");
          await api.ticketComment(ticketId, `@${s.agent} status check requested`, "system");
          return `${s.agent}에게 핑 전송 완료`;
        },
      };
    case "unassigned":
      return {
        label: "자동 배정",
        icon: <UserPlus className="size-3" />,
        confirm: "유휴 에이전트에게 자동 배정하시겠습니까?",
        execute: async (s) => {
          if (!s.ticket) throw new Error("티켓 정보 없음");
          const stateData = await api.state();
          const idleAgent = stateData.agents?.find((a: { state: string }) => a.state === "idle");
          if (!idleAgent) throw new Error("유휴 에이전트 없음");
          const result = await api.ticketUpdate(s.ticket, { assignee: idleAgent.id });
          if (!result.ok) throw new Error(result.error ?? "배정 실패");
          return `${s.ticket} -> ${idleAgent.id} assigned`;
        },
      };
    case "wip_high":
      return {
        label: "경고 전송",
        icon: <MessageSquare className="size-3" />,
        confirm: "WIP 한도 초과 경고를 전송하시겠습니까?",
        execute: async (s) => {
          const ticketId = s.ticket ?? s.message.match(/TASK-\d+/)?.[0];
          if (!ticketId) throw new Error("관련 티켓 없음");
          await api.ticketComment(ticketId, "WIP limit exceeded -- finish current work before proceeding", "system");
          return "WIP 경고 전송 완료";
        },
      };
    case "repeat_reject":
      return {
        label: "개선 제안",
        icon: <MessageSquare className="size-3" />,
        confirm: "코드 품질 개선 제안을 전송하시겠습니까?",
        execute: async (s) => {
          const ticketId = s.ticket ?? s.message.match(/TASK-\d+/)?.[0];
          if (!ticketId) throw new Error("관련 티켓 없음");
          await api.ticketComment(ticketId, "Repeated rejection detected -- code quality process improvement needed", "system");
          return "개선 제안 전송 완료";
        },
      };
    default:
      return null;
  }
}

/* ━━━ Severity → color mapping ━━━ */

function severityColor(severity: "high" | "medium" | "low") {
  switch (severity) {
    case "high":
      return { text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" };
    case "medium":
      return { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30" };
    case "low":
      return { text: "text-zinc-400", bg: "bg-zinc-400/10", border: "border-zinc-400/30" };
  }
}

/* ━━━ Trend → icon mapping ━━━ */

function TrendIcon({ trend }: { trend: AgentScores["trend"] }) {
  switch (trend) {
    case "improving":
      return <TrendingUp className="size-3.5 text-emerald-400" />;
    case "declining":
      return <TrendingDown className="size-3.5 text-red-400" />;
    case "stable":
      return <Minus className="size-3.5 text-zinc-400" />;
    default:
      return <Minus className="size-3.5 text-zinc-600" />;
  }
}

/* ━━━ Derive bottleneck alerts from scores & workflows ━━━ */

function deriveAlerts(
  agentScores: Record<string, AgentScores>,
  workflowData: Record<string, WorkflowAnalysis>
): BottleneckAlert[] {
  const alerts: BottleneckAlert[] = [];

  // Find highest error-rate agent
  let worstAgent = "";
  let worstRate = 0;
  for (const [name, scores] of Object.entries(agentScores)) {
    if (scores.error_rate > worstRate) {
      worstRate = scores.error_rate;
      worstAgent = name;
    }
  }
  if (worstAgent && worstRate > 0) {
    alerts.push({
      icon: <AlertTriangle className="size-4" />,
      title: "High Error Rate",
      description: `${worstAgent} has a ${(worstRate * 100).toFixed(1)}% error rate across ${agentScores[worstAgent].total_tasks} tasks.`,
      severity: worstRate > 0.2 ? "high" : worstRate > 0.1 ? "medium" : "low",
    });
  }

  // Find slowest workflow bottleneck step
  for (const [wfName, analysis] of Object.entries(workflowData)) {
    if (analysis.bottleneck_step) {
      const stepDuration = analysis.avg_step_durations[analysis.bottleneck_step] ?? 0;
      alerts.push({
        icon: <Clock className="size-4" />,
        title: "Workflow Bottleneck",
        description: `"${wfName}" bottleneck at step "${analysis.bottleneck_step}" (avg ${stepDuration.toFixed(1)}s).`,
        severity: stepDuration > 120 ? "high" : stepDuration > 60 ? "medium" : "low",
      });
    }
  }

  // Find declining quality trends
  for (const [name, scores] of Object.entries(agentScores)) {
    if (scores.trend === "declining") {
      alerts.push({
        icon: <TrendingDown className="size-4" />,
        title: "Quality Declining",
        description: `${name} quality is trending down (avg quality: ${scores.avg_quality.toFixed(2)}).`,
        severity: scores.avg_quality < 0.5 ? "high" : scores.avg_quality < 0.7 ? "medium" : "low",
      });
    }
  }

  return alerts;
}

/* ━━━ Format seconds to human-readable string ━━━ */

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toFixed(0)}s`;
}

/* ━━━ Main Component ━━━ */

interface HealthTabProps {
  onInvestigate?: (type: "ticket" | "agent", id: string) => void;
}

export function HealthTab({ onInvestigate }: HealthTabProps = {}) {
  const [agentScores, setAgentScores] = useState<Record<string, AgentScores>>({});
  const [workflowData, setWorkflowData] = useState<Record<string, WorkflowAnalysis>>({});
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const [scoresRes, workflowsRes, improvementsRes, insightsRes] = await Promise.all([
        api.analyticsScores().catch(() => ({ agents: {} })),
        api.analyticsWorkflows().catch(() => ({ workflows: {} })),
        api.improvements().catch(() => ({ improvements: [] })),
        api.insights().catch(() => null),
      ]);

      setAgentScores((scoresRes as { agents: Record<string, AgentScores> }).agents ?? {});
      setWorkflowData((workflowsRes as { workflows: Record<string, WorkflowAnalysis> }).workflows ?? {});
      setImprovements((improvementsRes as { improvements: Improvement[] }).improvements ?? []);
      if (insightsRes) setInsights(insightsRes as InsightsData);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 프로젝트 선택 전이면 API 호출 스킵 (라우팅 충돌 방지)
    if (!getCurrentProject()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    fetchAll().then(() => {
      if (cancelled) return;
    });

    // 15초 폴링
    const interval = setInterval(() => {
      if (!cancelled) fetchAll(false);
    }, 15_000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchAll]);

  /** Execute a remediation action for a suggestion */
  const handleAction = useCallback(async (index: number, suggestion: Suggestion, config: ActionConfig) => {
    if (!window.confirm(config.confirm)) return;

    setActionLoading(index);
    try {
      const result = await config.execute(suggestion);
      toast.success("작업 완료", { description: result });
      // Refresh insights to reflect the change
      await fetchAll(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error("작업 실패", { description: message });
    } finally {
      setActionLoading(null);
    }
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">Loading health data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-red-400">
          Failed to load health data: {error}
        </CardContent>
      </Card>
    );
  }

  const alerts = deriveAlerts(agentScores, workflowData);

  return (
    <div className="space-y-8">
      {/* ── Header: Last updated + Refresh ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {lastUpdated
            ? `Last updated ${lastUpdated.toLocaleTimeString("ko-KR", { hour12: false })}`
            : "Loading..."}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => fetchAll(false)}
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {/* ── Section 0: Insights KPI ── */}
      {insights && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="size-4 text-indigo-400" />
            프로젝트 인사이트
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4 text-center">
              <div className="text-2xl font-bold tabular-nums">{insights.total_events}</div>
              <div className="text-[10px] text-muted-foreground mt-1">총 이벤트</div>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <div className="text-2xl font-bold tabular-nums text-red-400">{insights.gate_rejections}</div>
              <div className="text-[10px] text-muted-foreground mt-1">게이트 거부</div>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <div className="text-2xl font-bold tabular-nums">{insights.avg_cycle_seconds > 0 ? `${(insights.avg_cycle_seconds / 3600).toFixed(1)}h` : "—"}</div>
              <div className="text-[10px] text-muted-foreground mt-1">평균 사이클 타임</div>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <div className="text-2xl font-bold tabular-nums">{Object.values(insights.status_counts).reduce((a, b) => a + b, 0)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">총 티켓</div>
            </CardContent></Card>
          </div>

          {/* 상태별 분포 + 에이전트 활동 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card><CardContent className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-3">상태별 티켓</h3>
              <div className="space-y-2">
                {Object.entries(insights.status_counts).map(([s, c]) => (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground">{s}</span>
                    <div className="flex-1 h-2 rounded bg-zinc-800">
                      <div className="h-full rounded bg-indigo-500/70" style={{ width: `${Math.min((c / Math.max(...Object.values(insights.status_counts), 1)) * 100, 100)}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{c}</span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-3">에이전트 활동</h3>
              <div className="space-y-2">
                {Object.entries(insights.agent_activity).sort(([,a],[,b]) => b - a).slice(0, 6).map(([agent, count]) => (
                  <div key={agent} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate text-muted-foreground">{agent}</span>
                    <div className="flex-1 h-2 rounded bg-zinc-800">
                      <div className="h-full rounded bg-emerald-500/70" style={{ width: `${Math.min((count / Math.max(...Object.values(insights.agent_activity), 1)) * 100, 100)}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          </div>

          {/* 사이클 타임 */}
          {insights.cycle_times.length > 0 && (
            <Card><CardContent className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-3">사이클 타임 (완료된 티켓)</h3>
              <div className="space-y-1.5">
                {insights.cycle_times.slice(0, 8).map((ct) => (
                  <div key={ct.ticket} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-muted-foreground">{ct.ticket}</span>
                      <span className="truncate">{ct.title}</span>
                    </span>
                    <span className="shrink-0 tabular-nums font-mono text-muted-foreground">
                      {ct.seconds < 3600 ? `${Math.round(ct.seconds / 60)}m` : `${(ct.seconds / 3600).toFixed(1)}h`}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          )}
        </section>
      )}

      {/* ── Suggestions ── */}
      {insights && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-400" />
            Suggestions
          </h2>
          {(!insights.suggestions || insights.suggestions.length === 0) ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                이상 없음
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {insights.suggestions.map((s, i) => {
                const sc = severityColor(s.severity as "high" | "medium" | "low");
                const investigateTarget = s.ticket
                  ? { type: "ticket" as const, id: s.ticket }
                  : s.agent
                    ? { type: "agent" as const, id: s.agent }
                    : null;
                const action = getActionConfig(s.type);
                const isThisLoading = actionLoading === i;
                return (
                  <Card key={i} className="overflow-hidden relative">
                    <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", sc.bg)} />
                    <CardContent className="p-4 pl-5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={cn("size-4", sc.text)} />
                          <Badge variant="outline" className={cn("text-[10px] font-mono uppercase", sc.text, sc.bg)}>
                            {s.severity}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {s.type}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-[12px] text-muted-foreground leading-relaxed">
                        {s.message}
                      </p>
                      <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                        {investigateTarget && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1"
                            disabled={!onInvestigate}
                            onClick={() => onInvestigate?.(investigateTarget.type, investigateTarget.id)}
                          >
                            <Search className="size-3" />
                            조사하기
                          </Button>
                        )}
                        {action && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1"
                            disabled={isThisLoading || actionLoading !== null}
                            onClick={() => handleAction(i, s, action)}
                          >
                            {isThisLoading ? <Loader2 className="size-3 animate-spin" /> : action.icon}
                            {action.label}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Section 1: Bottleneck Alerts ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Zap className="size-4 text-amber-400" />
          Bottleneck Alerts
        </h2>

        {alerts.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No bottlenecks detected. All systems healthy.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.map((alert, i) => {
              const c = severityColor(alert.severity);
              return (
                <Card key={i} className="overflow-hidden relative">
                  {/* Left severity accent bar */}
                  <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", c.bg)} />
                  <CardContent className="p-4 pl-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={c.text}>{alert.icon}</span>
                        <span className="text-sm font-semibold">{alert.title}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-mono uppercase", c.text, c.bg)}
                      >
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {alert.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Section 2: Agent Performance Grid ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Target className="size-4 text-violet-400" />
          Agent Performance
        </h2>

        {Object.keys(agentScores).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No agent score data available yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Object.entries(agentScores).map(([name, scores]) => (
              <AgentScoreCard key={name} name={name} scores={scores} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Workflow Efficiency ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <BarChart3 className="size-4 text-emerald-400" />
          Workflow Efficiency
        </h2>

        {Object.keys(workflowData).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No workflow analytics available yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {Object.entries(workflowData).map(([name, analysis]) => (
              <WorkflowEfficiencyCard key={name} name={name} analysis={analysis} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 4: Recent Improvements ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="size-4 text-blue-400" />
          Recent Improvements
        </h2>

        {improvements.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No improvement reports generated yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {improvements.map((imp) => (
              <ImprovementCard key={imp.id} improvement={imp} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Agent Score Card ── */

function AgentScoreCard({ name, scores }: { name: string; scores: AgentScores }) {
  // Quality color: green (>= 0.8), amber (>= 0.5), red (< 0.5)
  const qualityColor =
    scores.avg_quality >= 0.8
      ? "text-emerald-400"
      : scores.avg_quality >= 0.5
        ? "text-amber-400"
        : "text-red-400";

  // Error bar color: green (< 5%), amber (< 15%), red (>= 15%)
  const errorBarColor =
    scores.error_rate < 0.05
      ? "bg-emerald-500"
      : scores.error_rate < 0.15
        ? "bg-amber-500"
        : "bg-red-500";

  // Error rate width clamped to 100%
  const errorBarWidth = Math.min(scores.error_rate * 100, 100);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {/* Agent name + trend */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold font-mono truncate">{name}</span>
          <TrendIcon trend={scores.trend} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          {/* Total tasks */}
          <span className="text-muted-foreground">Tasks</span>
          <span className="text-right tabular-nums font-medium">
            {scores.total_tasks}
          </span>

          {/* Avg quality */}
          <span className="text-muted-foreground">Quality</span>
          <span className={cn("text-right tabular-nums font-medium", qualityColor)}>
            {(scores.avg_quality * 100).toFixed(1)}%
          </span>

          {/* Avg duration */}
          <span className="text-muted-foreground">Avg Duration</span>
          <span className="text-right tabular-nums font-medium">
            {formatDuration(scores.avg_duration_sec)}
          </span>
        </div>

        {/* Error rate bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Error Rate</span>
            <span className="tabular-nums font-mono">
              {(scores.error_rate * 100).toFixed(1)}%
            </span>
          </div>
          {/* Bar track */}
          <div className="h-1.5 w-full rounded-full bg-zinc-800">
            {/* Bar fill */}
            <div
              className={cn("h-full rounded-full transition-all", errorBarColor)}
              style={{ width: `${errorBarWidth}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Workflow Efficiency Card ── */

function WorkflowEfficiencyCard({
  name,
  analysis,
}: {
  name: string;
  analysis: WorkflowAnalysis;
}) {
  const steps = Object.entries(analysis.avg_step_durations);
  // Max step duration for proportional bar widths
  const maxDuration = Math.max(...steps.map(([, d]) => d), 1);
  // Total duration
  const totalDuration = steps.reduce((sum, [, d]) => sum + d, 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{name}</span>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {analysis.run_count} runs
            </Badge>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            Total: {formatDuration(totalDuration)}
          </span>
        </div>

        {/* Step bars */}
        {steps.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No step data.</div>
        ) : (
          <div className="space-y-2">
            {steps.map(([stepName, duration]) => {
              const isBottleneck = stepName === analysis.bottleneck_step;
              const barWidth = (duration / maxDuration) * 100;
              return (
                <div key={stepName} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={cn(
                        "truncate",
                        isBottleneck ? "text-red-400 font-semibold" : "text-muted-foreground"
                      )}
                    >
                      {stepName}
                      {isBottleneck && (
                        <span className="ml-1.5 text-[9px] text-red-400/70 uppercase tracking-wider">
                          bottleneck
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums font-mono text-[10px] shrink-0 ml-2">
                      {formatDuration(duration)}
                    </span>
                  </div>
                  {/* Horizontal bar */}
                  <div className="h-2 w-full rounded-sm bg-zinc-800">
                    <div
                      className={cn(
                        "h-full rounded-sm transition-all",
                        isBottleneck ? "bg-red-500/80" : "bg-emerald-500/60"
                      )}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Improvement Card ── */

function ImprovementCard({ improvement }: { improvement: Improvement }) {
  const { id, generated_at, trigger, findings, auto_applied } = improvement;
  const autoAppliedSet = new Set(auto_applied);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{trigger}</span>
            <span className="text-[10px] text-muted-foreground/70 font-mono tabular-nums shrink-0">
              {generated_at}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            {id.slice(0, 8)}
          </span>
        </div>

        {/* Findings list */}
        {findings.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No findings.</div>
        ) : (
          <div className="space-y-2">
            {findings.map((finding, i) => {
              const c = severityColor(finding.severity);
              // Check if this finding's suggestion was auto-applied
              const isApplied = auto_applied.some(
                (applied) => finding.description.includes(applied) || finding.suggestion.includes(applied)
              );

              return (
                <div
                  key={i}
                  className="rounded-md border border-border/50 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] font-mono uppercase shrink-0", c.text, c.bg)}
                      >
                        {finding.severity}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] shrink-0">
                        {finding.type.replace("_", " ")}
                      </Badge>
                      {finding.agent && (
                        <span className="text-[11px] text-muted-foreground font-mono truncate">
                          {finding.agent}
                        </span>
                      )}
                    </div>
                    {isApplied && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 shrink-0">
                        <svg className="size-3" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M13.5 4.5L6.5 11.5L2.5 7.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        auto-applied
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed">
                    {finding.description}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground/60">Suggestion:</span>{" "}
                    {finding.suggestion}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Auto-applied summary */}
        {auto_applied.length > 0 && (
          <div className="text-[10px] text-emerald-400/70 border-t border-border/30 pt-2">
            {auto_applied.length} improvement{auto_applied.length !== 1 ? "s" : ""} auto-applied
          </div>
        )}
      </CardContent>
    </Card>
  );
}
