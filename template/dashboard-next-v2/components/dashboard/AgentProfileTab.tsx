"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentProfile, AgentFull } from "@/lib/types";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Wrench,
  Lightbulb,
  Star,
  Activity,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ━━━ Props ━━━

interface Props {
  agents: AgentFull[] | null;
}

// ━━━ Main Component ━━━

export function AgentProfileTab({ agents }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentList = agents ?? [];

  // 에이전트 선택 시 프로필 fetch
  useEffect(() => {
    if (!selectedId) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .agentProfile(selectedId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="space-y-6">
      {/* ── Agent Selector (수평 탭 바) ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {agentList.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            에이전트가 없습니다
          </span>
        ) : (
          agentList.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => setSelectedId(agent.id)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border",
                selectedId === agent.id
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-muted/40 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {/* 에이전트 색상 dot */}
              <span
                className="inline-block size-2 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: agent.color || "#71717a" }}
              />
              {agent.name}
            </button>
          ))
        )}
      </div>

      {/* ── Profile Content ── */}
      {!selectedId && (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            <Brain className="size-8 mx-auto mb-3 opacity-40" />
            에이전트를 선택하면 프로필을 확인할 수 있습니다
          </CardContent>
        </Card>
      )}

      {selectedId && loading && (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            <Activity className="size-5 mx-auto mb-2 animate-pulse" />
            프로필을 불러오는 중...
          </CardContent>
        </Card>
      )}

      {selectedId && error && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-400">
            프로필 로딩 실패: {error}
          </CardContent>
        </Card>
      )}

      {selectedId && !loading && !error && profile && (
        <div className="space-y-4">
          <IdentityHeader agent={profile.agent} />
          <PerformanceSummary scores={profile.scores} />
          <MemoryViewer memory={profile.memory} />
          <ToolProfileSection tools={profile.tools} />
        </div>
      )}
    </div>
  );
}

// ━━━ Section 1: Identity Header ━━━

function IdentityHeader({ agent }: { agent: AgentFull }) {
  return (
    <Card className="overflow-hidden relative">
      {/* 왼쪽 컬러 바 (에이전트 고유 색상) */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: agent.color || "#71717a" }}
      />
      <CardContent className="p-5 pl-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* 에이전트 이름 */}
            <h2 className="text-lg font-bold tracking-tight">
              {agent.name}
            </h2>
            {/* 설명 */}
            {agent.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {agent.description}
              </p>
            )}
          </div>
          {/* 카테고리 배지 */}
          {agent.category && (
            <Badge
              variant="outline"
              className="shrink-0 text-[10px] font-mono"
            >
              {agent.category}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ━━━ Section 2: Performance Summary ━━━

function PerformanceSummary({ scores }: { scores: AgentProfile["scores"] }) {
  const trendIcon = {
    improving: <TrendingUp className="size-3.5" />,
    declining: <TrendingDown className="size-3.5" />,
    stable: <Minus className="size-3.5" />,
    insufficient_data: <Minus className="size-3.5" />,
  }[scores.trend];

  const trendColor = {
    improving: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    declining: "text-red-400 bg-red-400/10 border-red-400/30",
    stable: "text-zinc-400 bg-zinc-400/10 border-zinc-400/30",
    insufficient_data: "text-zinc-500 bg-zinc-500/10 border-zinc-500/30",
  }[scores.trend];

  const trendLabel = {
    improving: "향상 중",
    declining: "하락 중",
    stable: "안정적",
    insufficient_data: "데이터 부족",
  }[scores.trend];

  // 품질 점수 색상 (0-10 스케일 가정)
  const qualityColor =
    scores.avg_quality >= 7
      ? "text-emerald-400"
      : scores.avg_quality >= 4
        ? "text-amber-400"
        : "text-red-400";

  // 에러율 색상
  const errorColor =
    scores.error_rate <= 0.05
      ? "text-emerald-400"
      : scores.error_rate <= 0.15
        ? "text-amber-400"
        : "text-red-400";

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Star className="size-4 text-amber-400" />
            성과 요약
          </h3>
          {/* 트렌드 배지 */}
          <Badge
            variant="outline"
            className={cn("text-[10px] gap-1", trendColor)}
          >
            {trendIcon}
            {trendLabel}
          </Badge>
        </div>

        {/* KPI 그리드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCell label="총 작업 수" value={scores.total_tasks} />
          <KpiCell
            label="평균 품질"
            value={scores.avg_quality.toFixed(1)}
            valueClass={qualityColor}
          />
          <KpiCell
            label="에러율"
            value={`${(scores.error_rate * 100).toFixed(1)}%`}
            valueClass={errorColor}
          />
          <KpiCell
            label="평균 소요시간"
            value={formatDuration(scores.avg_duration_sec)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** 단일 KPI 셀 */
function KpiCell({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
      <div className={cn("text-lg font-bold tabular-nums", valueClass)}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

/** 초 → 읽기 쉬운 형식 변환 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// ━━━ Section 3: Memory Viewer ━━━

function MemoryViewer({ memory }: { memory: AgentProfile["memory"] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
          <Brain className="size-4 text-violet-400" />
          메모리
        </h3>

        <div className="space-y-1">
          <CollapsibleSection title="학습 내용 (Learnings)" defaultOpen>
            {memory.learnings.length === 0 ? (
              <EmptyPlaceholder />
            ) : (
              <ul className="space-y-1.5">
                {memory.learnings.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Lightbulb className="size-3.5 mt-0.5 shrink-0 text-amber-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="패턴 (Patterns)">
            {memory.patterns.length === 0 ? (
              <EmptyPlaceholder />
            ) : (
              <ul className="space-y-1.5">
                {memory.patterns.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="size-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="자기 평가 (Self-Assessment)">
            {Object.keys(memory.self_assessment).length === 0 ? (
              <EmptyPlaceholder />
            ) : (
              <div className="space-y-2">
                {Object.entries(memory.self_assessment).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-sm">
                    <span className="font-medium text-foreground min-w-[100px] shrink-0">
                      {key}
                    </span>
                    <span className="text-muted-foreground">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="프로젝트별 (Project-Specific)">
            {memory.project_specific.length === 0 ? (
              <EmptyPlaceholder />
            ) : (
              <ul className="space-y-1.5">
                {memory.project_specific.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="size-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>
      </CardContent>
    </Card>
  );
}

/** 접을 수 있는 섹션 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** 빈 섹션 플레이스홀더 */
function EmptyPlaceholder() {
  return (
    <p className="text-xs text-muted-foreground italic">아직 기록 없음</p>
  );
}

// ━━━ Section 4: Tool Profile ━━━

function ToolProfileSection({ tools }: { tools: AgentProfile["tools"] }) {
  const hasContent =
    tools.preferred.length > 0 ||
    tools.avoid.length > 0 ||
    tools.instructions.trim().length > 0;

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
          <Wrench className="size-4 text-blue-400" />
          도구 프로필
        </h3>

        {!hasContent ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            도구 프로필이 설정되지 않았습니다
          </p>
        ) : (
          <div className="space-y-4">
            {/* 선호 도구 */}
            {tools.preferred.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  선호 도구
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tools.preferred.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                    >
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 사용 금지 도구 */}
            {tools.avoid.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  사용 금지
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tools.avoid.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-red-400/10 text-red-400 border border-red-400/20"
                    >
                      <span className="size-1.5 rounded-full bg-red-400" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 지침 */}
            {tools.instructions.trim() && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  지침
                </h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed border border-border rounded-md p-3 bg-muted/20">
                  {tools.instructions}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
