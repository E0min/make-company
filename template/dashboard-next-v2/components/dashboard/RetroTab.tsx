"use client";
import { useState, useEffect } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Retrospective, SharedKnowledge, Improvement } from "@/lib/types";
import { Clock, Users, MessageSquare, Lightbulb, Tag, BookOpen, AlertTriangle } from "lucide-react";

/* ── Tag color map ── */

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  qa:       { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/30" },
  frontend: { bg: "bg-blue-500/15",   text: "text-blue-300",   border: "border-blue-500/30" },
  backend:  { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/30" },
  design:   { bg: "bg-pink-500/15",   text: "text-pink-300",   border: "border-pink-500/30" },
  bugfix:   { bg: "bg-red-500/15",    text: "text-red-300",    border: "border-red-500/30" },
};

const DEFAULT_TAG_COLOR = { bg: "bg-zinc-500/15", text: "text-zinc-300", border: "border-zinc-500/30" };

function tagColor(tag: string) {
  const key = tag.toLowerCase();
  return TAG_COLORS[key] ?? DEFAULT_TAG_COLOR;
}

/* ── Agent color helper (deterministic hash) ── */

const AGENT_COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-amber-500/20 text-amber-300",
  "bg-red-500/20 text-red-300",
  "bg-blue-500/20 text-blue-300",
  "bg-orange-500/20 text-orange-300",
  "bg-lime-500/20 text-lime-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-teal-500/20 text-teal-300",
  "bg-yellow-500/20 text-yellow-300",
];

function agentColorClass(agent: string): string {
  let hash = 0;
  for (let i = 0; i < agent.length; i++) {
    hash = (hash << 5) - hash + agent.charCodeAt(i);
    hash |= 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

/* ── Duration formatter ── */

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/* ── Date formatter ── */

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
      + " " + d.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

/* ── Confidence label / color ── */

function confidenceLevel(c: number): { label: string; color: string; barColor: string } {
  if (c >= 0.7) return { label: "높음", color: "from-emerald-500/60", barColor: "bg-emerald-500" };
  if (c >= 0.4) return { label: "중간", color: "from-amber-500/60",   barColor: "bg-amber-500" };
  return { label: "낮음", color: "from-zinc-500/60", barColor: "bg-zinc-500" };
}

/* ════════════════════════════════════════════════════════
   RetroTab – 회고 타임라인 + 팀 공유 지식
   ════════════════════════════════════════════════════════ */

export function RetroTab() {
  /* ── State ── */
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [knowledge, setKnowledge] = useState<SharedKnowledge[]>([]);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [expandedRetro, setExpandedRetro] = useState<string | null>(null);

  /* ── Fetch data on mount ── */
  useEffect(() => {
    if (!getCurrentProject()) return;

    api.retrospectives()
      .then((res) => setRetros(res.retrospectives ?? []))
      .catch(() => setRetros([]));

    api.sharedKnowledge(undefined, 20)
      .then((res) => setKnowledge(res.entries ?? []))
      .catch(() => setKnowledge([]));

    api.improvements()
      .then((res) => setImprovements(res.improvements ?? []))
      .catch(() => setImprovements([]));
  }, []);

  /* ── Derived: unique tags from all retros ── */
  const allTags = Array.from(
    new Set(retros.flatMap((r) => r.tags ?? []))
  ).sort();

  /* ── Filtered retros (multi-tag intersection) ── */
  const filteredRetros = selectedTags.length === 0
    ? retros
    : retros.filter((r) =>
        selectedTags.every((t) => (r.tags ?? []).includes(t))
      );

  /* ── Sorted newest first ── */
  const sortedRetros = [...filteredRetros].sort(
    (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
  );

  /* ── Tag toggle handler ── */
  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function clearTags() {
    setSelectedTags([]);
  }

  /* ── Expand/collapse retro card ── */
  function toggleExpand(id: string) {
    setExpandedRetro((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-8">
      {/* ━━━ Section 1: Tag Filter Bar ━━━ */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="size-4 text-zinc-400 shrink-0" />
          {/* "전체" clear button */}
          <button
            onClick={clearTags}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors border",
              selectedTags.length === 0
                ? "bg-zinc-100/10 text-zinc-100 border-zinc-400/40"
                : "bg-transparent text-zinc-400 border-zinc-600 hover:bg-zinc-700/50"
            )}
          >
            전체
          </button>
          {allTags.map((tag) => {
            const tc = tagColor(tag);
            const isActive = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-all border",
                  isActive
                    ? cn(tc.bg, tc.text, tc.border, "ring-1 ring-white/10")
                    : "bg-transparent text-zinc-400 border-zinc-700 hover:bg-zinc-800"
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {/* ━━━ Section 2: Retrospective Timeline ━━━ */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="size-4 text-violet-400" />
          <h2 className="text-base font-semibold">회고 타임라인</h2>
          <Badge variant="secondary" className="text-[10px] font-mono">
            {sortedRetros.length}건
          </Badge>
        </div>

        {sortedRetros.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <MessageSquare className="size-8 mb-3 opacity-30" />
              <p className="text-sm">
                {retros.length === 0
                  ? "회고 데이터가 없습니다"
                  : "선택한 태그에 해당하는 회고가 없습니다"}
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Timeline container: left border line */
          <div className="relative ml-3 border-l-2 border-zinc-700 pl-6 space-y-4">
            {sortedRetros.map((retro) => (
              <RetroCard
                key={retro.id}
                retro={retro}
                isExpanded={expandedRetro === retro.id}
                onToggle={() => toggleExpand(retro.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ━━━ Section 3: Shared Knowledge ━━━ */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="size-4 text-emerald-400" />
          <h2 className="text-base font-semibold">팀 공유 지식</h2>
          <Badge variant="secondary" className="text-[10px] font-mono">
            {knowledge.length}건
          </Badge>
        </div>

        {knowledge.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Lightbulb className="size-8 mb-3 opacity-30" />
              <p className="text-sm">공유된 지식이 없습니다</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {knowledge.map((k, i) => (
              <KnowledgeCard key={`${k.ts}-${i}`} item={k} />
            ))}
          </div>
        )}
      </div>

      {/* ━━━ Section 4: Improvements ━━━ */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="size-4 text-amber-400" />
          <h2 className="text-base font-semibold">자기개선 권고</h2>
          <Badge variant="secondary" className="text-[10px] font-mono">
            {improvements.length}건
          </Badge>
        </div>

        {improvements.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <AlertTriangle className="size-8 mb-3 opacity-30" />
              <p className="text-sm">개선 권고가 없습니다</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {improvements.map((imp) => (
              <ImprovementCard key={imp.id} item={imp} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   RetroCard – single timeline card
   ════════════════════════════════════════ */

function RetroCard({
  retro,
  isExpanded,
  onToggle,
}: {
  retro: Retrospective;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      {/* Timeline dot */}
      <div className="absolute -left-[31px] top-3 size-3 rounded-full bg-zinc-600 border-2 border-zinc-800 ring-2 ring-zinc-900" />

      <Card
        className={cn(
          "cursor-pointer transition-colors hover:ring-zinc-600",
          isExpanded && "ring-violet-500/40"
        )}
        onClick={onToggle}
      >
        <CardContent className="space-y-3">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {retro.task}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {formatDate(retro.completed_at)}
              </p>
            </div>

            {/* Duration badge */}
            <div className="flex items-center gap-1 shrink-0 text-[11px] text-zinc-400">
              <Clock className="size-3" />
              {formatDuration(retro.duration_seconds)}
            </div>
          </div>

          {/* Participants as agent badges */}
          {retro.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {retro.participants.map((p) => (
                <span
                  key={p.agent_id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    agentColorClass(p.agent_id)
                  )}
                >
                  <Users className="size-2.5" />
                  {p.agent_id}
                </span>
              ))}
            </div>
          )}

          {/* Summary */}
          <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
            {retro.summary}
          </p>

          {/* Expandable feedback section */}
          {isExpanded && retro.feedback.length > 0 && (
            <div className="pt-2 border-t border-zinc-700/60 space-y-3">
              {retro.feedback.map((fb) => (
                <div key={fb.agent_id} className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-zinc-300">
                    {fb.agent_id}
                  </p>
                  <div className="grid gap-1.5 text-[11px]">
                    {/* went_well */}
                    {fb.went_well && (
                      <div className="flex gap-2 items-start">
                        <span className="shrink-0 mt-0.5 size-1.5 rounded-full bg-emerald-500" />
                        <span className="text-emerald-300/90">{fb.went_well}</span>
                      </div>
                    )}
                    {/* went_wrong */}
                    {fb.went_wrong && (
                      <div className="flex gap-2 items-start">
                        <span className="shrink-0 mt-0.5 size-1.5 rounded-full bg-red-500" />
                        <span className="text-red-300/90">{fb.went_wrong}</span>
                      </div>
                    )}
                    {/* action_item */}
                    {fb.action_item && (
                      <div className="flex gap-2 items-start">
                        <span className="shrink-0 mt-0.5 size-1.5 rounded-full bg-amber-500" />
                        <span className="text-amber-300/90">{fb.action_item}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tags */}
          {(retro.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {retro.tags.map((tag) => {
                const tc = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                      tc.bg, tc.text, tc.border
                    )}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════
   KnowledgeCard – shared knowledge item
   ════════════════════════════════════════ */

function KnowledgeCard({ item }: { item: SharedKnowledge }) {
  const conf = confidenceLevel(item.confidence);

  return (
    <Card className="relative overflow-hidden">
      {/* Left gradient border colored by confidence */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1 bg-gradient-to-b to-transparent",
          conf.color
        )}
      />

      <CardContent className="pl-5 space-y-2">
        {/* Key (title) */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-semibold text-foreground leading-snug">
            {item.key}
          </h4>

          {/* Author badge */}
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
              agentColorClass(item.author)
            )}
          >
            {item.author}
          </span>
        </div>

        {/* Insight */}
        <p className="text-[11px] text-zinc-300 leading-relaxed">
          {item.insight}
        </p>

        {/* Bottom row: confidence bar + relevant agents */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Confidence bar */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] text-zinc-500 shrink-0">신뢰도</span>
            <div className="flex-1 h-1.5 bg-zinc-700/60 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", conf.barColor)}
                style={{ width: `${Math.round(item.confidence * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
              {Math.round(item.confidence * 100)}%
            </span>
          </div>

          {/* Relevant agents as dots */}
          {item.relevant_agents.length > 0 && (
            <div className="flex items-center gap-0.5 shrink-0" title={item.relevant_agents.join(", ")}>
              {item.relevant_agents.map((a) => (
                <span
                  key={a}
                  className={cn(
                    "inline-block size-2 rounded-full",
                    agentColorClass(a).split(" ")[0] // extract just the bg class
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ════════════════════════════════════════
   ImprovementCard – self-improvement recommendation
   ════════════════════════════════════════ */

const SEVERITY_STYLE: Record<string, { badge: string; border: string }> = {
  high:   { badge: "bg-red-500/15 text-red-300 border-red-500/30", border: "border-l-red-500" },
  medium: { badge: "bg-amber-500/15 text-amber-300 border-amber-500/30", border: "border-l-amber-500" },
  low:    { badge: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30", border: "border-l-zinc-500" },
};

const TYPE_LABEL: Record<string, string> = {
  bottleneck: "병목",
  quality_decline: "품질 저하",
  skill_gap: "스킬 갭",
  tool_mismatch: "도구 불일치",
};

function ImprovementCard({ item }: { item: Improvement }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="space-y-3">
        {/* Header: generated date + trigger */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground truncate">
              {item.trigger}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatDate(item.generated_at)}
            </p>
          </div>
        </div>

        {/* Findings */}
        {item.findings.length > 0 && (
          <div className="space-y-2">
            {item.findings.map((f, fi) => {
              const sev = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.low;
              return (
                <div
                  key={fi}
                  className={cn("border-l-2 pl-3 py-1 space-y-1", sev.border)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium border", sev.badge)}>
                      {f.severity}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {TYPE_LABEL[f.type] ?? f.type}
                    </span>
                    {f.agent && (
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium", agentColorClass(f.agent))}>
                        {f.agent}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400">{f.description}</p>
                  <p className="text-[11px] text-zinc-200">{f.suggestion}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Auto-applied actions */}
        {item.auto_applied.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-zinc-700/60">
            <p className="text-[10px] font-semibold text-zinc-400">자동 적용됨</p>
            <ul className="space-y-0.5">
              {item.auto_applied.map((action, ai) => (
                <li key={ai} className="text-[10px] text-emerald-300/80 flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5 size-1.5 rounded-full bg-emerald-500" />
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
