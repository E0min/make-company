"use client";

import { useState, useEffect, useCallback } from "react";
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
  ChevronRight,
  Users,
  Gauge,
  RefreshCw,
  AlertTriangle,
  ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ━━━ Helper: format timestamp ━━━ */

function formatTs(ts: string | null): string {
  if (!ts) return "없음";
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
    if (mins < 1) return "방금";
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    return `${Math.floor(hrs / 24)}일 전`;
  } catch {
    return ts;
  }
}

/* ━━━ Helper: WIP limit display ━━━ */

const formatWipLimit = (v: number) => v >= 999 ? "미설정" : String(v);

/* ━━━ Korean label mappings ━━━ */

const HOOK_LABELS: Record<string, string> = {
  "agent-harness": "에이전트 행동 검증",
  "post-tool-use": "도구 사용 후 검증",
  "ticket-context": "티켓 컨텍스트 주입",
};

const GATE_LABELS: Record<string, string> = {
  "quality_gate_fail": "품질 게이트 실패",
  "verify_passed_bypass_rejected": "우회 시도 차단",
  "parent_done_blocked": "선행 작업 미완료",
  "wip_limit_blocked": "WIP 한도 초과",
  "reviewer_not_approved": "리뷰어 미승인",
  "skill_missing": "필수 스킬 누락",
  "force_transition": "강제 상태 전환",
  "auto_verify": "자동 검증",
  "doc_updated": "문서 갱신",
};

/* ━━━ Main Component ━━━ */

export function HarnessTab() {
  const [data, setData] = useState<HarnessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (showLoading = true) => {
    if (!getCurrentProject()) {
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await api.harnessSummary();
      setData(res);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getCurrentProject()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    fetchData().then(() => {
      if (cancelled) return;
    });

    // 15초 폴링
    const interval = setInterval(() => {
      if (!cancelled) fetchData(false);
    }, 15_000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">행동 규칙 데이터를 불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-red-400">
          데이터를 불러오지 못했습니다: {error}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          데이터가 없습니다. 프로젝트를 먼저 선택해 주세요.
        </CardContent>
      </Card>
    );
  }

  /* ── Compliance summary calculations (2B) ── */
  const passRate = data.gates.total_checks > 0
    ? Math.round((data.gates.passed / data.gates.total_checks) * 100)
    : 0;
  const totalWarnings =
    data.hooks.agent_harness.warnings +
    data.hooks.ticket_context.wip_warnings +
    data.hooks.ticket_context.goal_warnings;
  const totalBlocks = data.hooks.agent_harness.blocks;

  return (
    <div className="space-y-6">
      {/* ── Header: Last updated + Refresh ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {lastUpdated
            ? `마지막 업데이트 ${lastUpdated.toLocaleTimeString("ko-KR", { hour12: false })}`
            : "불러오는 중..."}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => fetchData(false)}
        >
          <RefreshCw className="size-3" />
          새로고침
        </Button>
      </div>

      {/* ── 2A: Tab description header ── */}
      <div className="space-y-1">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="size-5 text-indigo-400" />
          에이전트 행동 규칙
        </h1>
        <p className="text-sm text-muted-foreground">
          훅 실행, 품질 게이트, 스킬 사용, 워크플로우 규칙의 실시간 준수 현황입니다.
        </p>
      </div>

      {/* ── 2B: Unified compliance summary ── */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <Gauge className={cn(
              "size-5 mx-auto",
              passRate >= 80 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-red-400"
            )} />
            <div className={cn(
              "text-2xl font-bold tabular-nums",
              passRate >= 80 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-red-400"
            )}>
              {passRate}%
            </div>
            <div className="text-xs text-muted-foreground">전체 준수율</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <AlertTriangle className="size-5 mx-auto text-amber-400" />
            <div className="text-2xl font-bold tabular-nums text-amber-400">
              {totalWarnings}
            </div>
            <div className="text-xs text-muted-foreground">경고</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <ShieldOff className="size-5 mx-auto text-red-400" />
            <div className="text-2xl font-bold tabular-nums text-red-400">
              {totalBlocks}
            </div>
            <div className="text-xs text-muted-foreground">차단</div>
          </CardContent>
        </Card>
      </div>

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
        훅 실행 현황
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          {rows.map((row) => (
            <div key={row.name} className="space-y-2">
              {/* Header: name + count */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-medium">{HOOK_LABELS[row.name] ?? row.name}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs tabular-nums font-mono">
                    {row.executions}회 실행
                  </Badge>
                  {row.lastRun && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
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
                    className={cn("text-xs font-mono", b.color)}
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
        품질 게이트 이력
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
              <div className="text-sm font-medium">통과율</div>
              <div className="flex gap-3 text-xs tabular-nums">
                <span className="text-emerald-400">{gates.passed} 통과</span>
                <span className="text-red-400">{gates.rejected} 거부</span>
                <span className="text-muted-foreground">{gates.total_checks} 전체</span>
              </div>
            </div>
          </div>

          {/* Recent gate events */}
          {gates.recent.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-2">
              최근 게이트 이벤트가 없습니다.
            </div>
          ) : (
            <div className="space-y-1.5">
              {gates.recent.slice(0, 10).map((evt, i) => (
                <div
                  key={`${evt.ticket}-${evt.gate}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-xs"
                >
                  {evt.result === "pass" ? (
                    <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="size-3.5 text-red-400 shrink-0" />
                  )}
                  <span className="font-mono text-muted-foreground shrink-0">{evt.ticket}</span>
                  <span className="text-muted-foreground shrink-0">{GATE_LABELS[evt.gate] ?? evt.gate}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-mono shrink-0",
                      evt.result === "pass"
                        ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"
                        : "text-red-400 bg-red-400/10 border-red-400/30"
                    )}
                  >
                    {evt.result === "pass" ? "통과" : "거부"}
                  </Badge>
                  <span className="truncate text-muted-foreground flex-1">{evt.reason}</span>
                  <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
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
        스킬 준수 현황
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          {/* Enforcement mode + compliance */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-mono uppercase",
                  skills.enforcement === "strict"
                    ? "text-indigo-400 bg-indigo-400/10 border-indigo-400/30"
                    : "text-zinc-400 bg-zinc-400/10 border-zinc-400/30"
                )}
              >
                {skills.enforcement}
              </Badge>
              <span className="text-sm font-medium">시행 모드</span>
            </div>
            <div className="text-sm tabular-nums font-mono">
              <span className={complianceRate >= 80 ? "text-emerald-400" : complianceRate >= 50 ? "text-amber-400" : "text-red-400"}>
                {complianceRate}%
              </span>
              <span className="text-muted-foreground ml-1.5 text-xs">
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
            <div className="text-xs text-muted-foreground text-center py-2">
              에이전트별 스킬 데이터가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                에이전트별 스킬 현황
              </div>
              {agents.map(([agent, stats]) => {
                const total = stats.compliant + stats.missing;
                const pct = total > 0 ? Math.round((stats.compliant / total) * 100) : 0;
                const textColor = pct >= 100 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";

                const compliantCount = stats.compliant;
                const missingCount = stats.missing;

                return (
                  <div key={agent} className="rounded-md border border-border/50 px-3 py-2.5 space-y-2">
                    {/* Agent header */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-medium text-foreground/80">{agent}</span>
                      <span className={cn("text-xs tabular-nums font-mono font-medium", textColor)}>
                        {pct}%
                      </span>
                    </div>

                    {/* Skill badges (2D: fallback fix, 2E: no ArrowRight, flex wrap) */}
                    <div className="flex flex-wrap gap-1.5">
                      {/* Compliant skills */}
                      {stats.compliant_skills?.length ? (
                        stats.compliant_skills.map((skill) => (
                          <Badge
                            key={`ok-${skill}`}
                            variant="outline"
                            className="text-xs font-mono text-emerald-400 bg-emerald-400/10 border-emerald-400/30 gap-0.5"
                          >
                            <CheckCircle2 className="size-2.5" />
                            {skill}
                          </Badge>
                        ))
                      ) : compliantCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono text-emerald-400 bg-emerald-400/10 border-emerald-400/30 gap-0.5"
                        >
                          <CheckCircle2 className="size-2.5" />
                          {compliantCount}건 준수
                        </Badge>
                      ) : null}
                      {/* Missing skills */}
                      {stats.missing_skills?.length ? (
                        stats.missing_skills.map((skill) => (
                          <Badge
                            key={`miss-${skill}`}
                            variant="outline"
                            className="text-xs font-mono text-red-400 bg-red-400/10 border-red-400/30 gap-0.5"
                          >
                            <XCircle className="size-2.5" />
                            {skill}
                          </Badge>
                        ))
                      ) : missingCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="text-xs font-mono text-red-400 bg-red-400/10 border-red-400/30 gap-0.5"
                        >
                          <XCircle className="size-2.5" />
                          {missingCount}건 누락
                        </Badge>
                      ) : null}
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
        워크플로우 규칙
      </h2>

      {/* Workflow templates */}
      {templates.map(([name, tmpl]) => (
        <Card key={name}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs font-mono">{name}</Badge>
              <span className="text-xs text-muted-foreground">{tmpl.steps.length}단계</span>
            </div>

            {/* Step chain */}
            <div className="flex flex-wrap items-center gap-1">
              {tmpl.steps.map((step, i) => (
                <span key={step} className="flex items-center gap-1">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 border border-border/50 text-foreground/80">
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
                <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                  선행 조건
                </div>
                {Object.entries(tmpl.required_before).map(([step, deps]) => (
                  <div key={step} className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono text-amber-400">{step}</span>
                    <ChevronRight className="size-3 text-muted-foreground/50" />
                    <span className="text-muted-foreground">필요:</span>
                    {deps.map((dep) => (
                      <Badge key={dep} variant="outline" className="text-xs font-mono text-zinc-400 bg-zinc-400/10 border-zinc-400/30">
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
            <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              품질 게이트
            </div>
            {gateEntries.map(([transition, gate]) => (
              <div key={transition} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-medium text-indigo-400">{transition}</span>
                  <ChevronRight className="size-3 text-muted-foreground/50" />
                  <span className="text-muted-foreground">리뷰어:</span>
                  <Badge variant="secondary" className="text-xs font-mono">{gate.reviewer}</Badge>
                </div>
                <div className="flex flex-wrap gap-1 ml-4">
                  {gate.criteria.map((c) => (
                    <Badge key={c} variant="outline" className="text-xs text-zinc-400 bg-zinc-400/10 border-zinc-400/30">
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
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            WIP 한도
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{formatWipLimit(workflow.wip_limits.global)}</div>
              <div className="text-xs text-muted-foreground">전체</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{formatWipLimit(workflow.wip_limits.per_agent)}</div>
              <div className="text-xs text-muted-foreground">에이전트별</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold tabular-nums">{formatWipLimit(workflow.wip_limits.per_team)}</div>
              <div className="text-xs text-muted-foreground">팀별</div>
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
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                비평 루프
              </span>
            </div>
            <div className="space-y-1.5">
              {criticEntries.map(([agent, critic]) => (
                <div key={agent} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-foreground/80">{agent}</span>
                  <ChevronRight className="size-3 text-muted-foreground/50" />
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
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                단계별 스킬
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-mono uppercase ml-auto",
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
                <div className="text-xs font-mono font-medium text-indigo-400">{step}</div>
                {Object.entries(agentSkills).map(([agent, skillList]) => (
                  <div key={agent} className="flex items-start gap-2 ml-3 text-xs">
                    <span className="font-mono text-muted-foreground shrink-0">{agent}:</span>
                    <div className="flex flex-wrap gap-1">
                      {skillList.map((skill) => (
                        <Badge key={skill} variant="outline" className="text-xs font-mono text-amber-400 bg-amber-400/10 border-amber-400/30">
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
