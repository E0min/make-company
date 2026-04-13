"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { StructuredEvent } from "@/lib/types";
import {
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";

/* ━━━ Types ━━━ */

interface Props {
  onNavigateToTab?: (tab: string) => void;
}

/* ━━━ Constants ━━━ */

const EVENT_TYPES = [
  { value: "all", label: "전체 이벤트" },
  { value: "gate_rejected", label: "게이트 거부" },
  { value: "skill_missing", label: "스킬 누락" },
  { value: "skill_blocked", label: "스킬 차단" },
  { value: "force_transition", label: "강제 전환" },
  { value: "verify_passed_bypass_rejected", label: "검증 우회 차단" },
  { value: "parent_done_blocked", label: "선행 작업 차단" },
  { value: "auto_verify", label: "자동 검증" },
  { value: "doc_updated", label: "문서 갱신" },
] as const;

const TIME_RANGES = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "all", label: "All" },
] as const;

type TimeRange = (typeof TIME_RANGES)[number]["value"];

/** Classify event into severity for color coding */
function eventSeverity(event: string): "error" | "warning" | "success" | "info" {
  if (
    event.includes("rejected") ||
    event.includes("blocked") ||
    event === "skill_missing"
  ) {
    return "error";
  }
  if (event === "force_transition" || event.includes("warning")) {
    return "warning";
  }
  if (
    event === "auto_verify" ||
    event.includes("pass") ||
    event === "doc_updated"
  ) {
    return "success";
  }
  return "info";
}

const SEVERITY_STYLES: Record<string, string> = {
  error: "text-red-400 bg-red-400/10 border-red-400/30",
  warning: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  success: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  info: "text-zinc-400 bg-zinc-400/10 border-zinc-400/30",
};

const SEVERITY_DOT: Record<string, string> = {
  error: "bg-red-400",
  warning: "bg-amber-400",
  success: "bg-emerald-400",
  info: "bg-zinc-500",
};

/** Filter events by time range relative to now */
function filterByTimeRange(events: StructuredEvent[], range: TimeRange): StructuredEvent[] {
  if (range === "all") return events;
  const now = Date.now();
  const msMap: Record<string, number> = {
    "1h": 3600_000,
    "6h": 6 * 3600_000,
    "24h": 24 * 3600_000,
    "7d": 7 * 24 * 3600_000,
  };
  const cutoff = now - (msMap[range] ?? 0);
  return events.filter((e) => {
    try {
      return new Date(e.ts).getTime() >= cutoff;
    } catch {
      return true;
    }
  });
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleTimeString("ko-KR", { hour12: false }) +
      " " +
      d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
    );
  } catch {
    return ts;
  }
}

/* ━━━ Main Component ━━━ */

export function AuditTab({ onNavigateToTab }: Props) {
  const [events, setEvents] = useState<StructuredEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [eventType, setEventType] = useState("all");
  const [agentFilter, setAgentFilter] = useState("");
  const [agentFilterInput, setAgentFilterInput] = useState("");
  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketFilterInput, setTicketFilterInput] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");

  // Debounce refs
  const agentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticketDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expanded rows (stable key: ts-event-agent)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Auto-refresh
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup debounce timeouts
  useEffect(() => {
    return () => {
      if (agentDebounceRef.current) clearTimeout(agentDebounceRef.current);
      if (ticketDebounceRef.current) clearTimeout(ticketDebounceRef.current);
    };
  }, []);

  const handleAgentFilterChange = useCallback((value: string) => {
    setAgentFilterInput(value);
    if (agentDebounceRef.current) clearTimeout(agentDebounceRef.current);
    agentDebounceRef.current = setTimeout(() => {
      setAgentFilter(value);
    }, 300);
  }, []);

  const handleTicketFilterChange = useCallback((value: string) => {
    setTicketFilterInput(value);
    if (ticketDebounceRef.current) clearTimeout(ticketDebounceRef.current);
    ticketDebounceRef.current = setTimeout(() => {
      setTicketFilter(value);
    }, 300);
  }, []);

  const fetchEvents = useCallback(async () => {
    if (!getCurrentProject()) {
      setLoading(false);
      return;
    }
    try {
      const filters: { event?: string; agent?: string; ticket?: string; limit?: number } = {
        limit: 500,
      };
      if (eventType !== "all") filters.event = eventType;
      if (agentFilter.trim()) filters.agent = agentFilter.trim();
      if (ticketFilter.trim()) filters.ticket = ticketFilter.trim();
      const res = await api.events(filters);
      setEvents(res.events ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [eventType, agentFilter, ticketFilter]);

  // Initial fetch + refetch when filters change
  useEffect(() => {
    setLoading(true);
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh every 10s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchEvents();
    }, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEvents]);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Apply time range filter client-side
  const filteredEvents = filterByTimeRange(events, timeRange);

  // Loading state
  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-4 animate-spin mr-2 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">감사 이벤트 불러오는 중...</span>
      </div>
    );
  }

  // Error state
  if (error && events.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-red-400">
          감사 이벤트 로드 실패: {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="size-4 text-muted-foreground shrink-0" />

            {/* Event type */}
            <Select value={eventType} onValueChange={(v) => setEventType(v ?? "all")}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="이벤트 유형" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Agent filter */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={agentFilterInput}
                onChange={(e) => handleAgentFilterChange(e.target.value)}
                placeholder="에이전트 필터..."
                className="h-8 w-[160px] pl-7 text-xs"
              />
            </div>

            {/* Ticket filter */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={ticketFilterInput}
                onChange={(e) => handleTicketFilterChange(e.target.value)}
                placeholder="티켓 필터..."
                className="h-8 w-[160px] pl-7 text-xs"
              />
            </div>

            {/* Time range pills */}
            <div className="flex items-center gap-0.5 rounded-md bg-zinc-900/60 p-0.5">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setTimeRange(r.value)}
                  className={cn(
                    "px-2 py-1 rounded text-xs font-mono font-medium transition-colors",
                    timeRange === r.value
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Manual refresh */}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5 ml-auto"
              onClick={() => fetchEvents()}
            >
              <RefreshCw className="size-3" />
              새로고침
            </Button>

            {/* Count */}
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {filteredEvents.length}건
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      {filteredEvents.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="size-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              감사 이벤트가 없습니다
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-[20px_140px_140px_100px_100px_1fr_16px] gap-2 px-4 py-2 border-b border-border text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              <span />
              <span>시간</span>
              <span>이벤트</span>
              <span>에이전트</span>
              <span>티켓</span>
              <span>상세</span>
              <span />
            </div>

            {/* Table body */}
            <ScrollArea className="max-h-[calc(100vh-320px)]">
              <div className="divide-y divide-border/40">
                {filteredEvents.map((evt) => {
                  const stableKey = `${evt.ts}-${evt.event}-${evt.agent || ""}`;
                  const severity = eventSeverity(evt.event);
                  const isExpanded = expandedRows.has(stableKey);
                  const hasData =
                    evt.data && Object.keys(evt.data).length > 0;
                  const detail = evt.data
                    ? (evt.data.reason as string) ??
                      (evt.data.message as string) ??
                      (evt.data.description as string) ??
                      ""
                    : "";

                  return (
                    <div key={stableKey}>
                      {/* Main row */}
                      <button
                        type="button"
                        onClick={() => hasData && toggleRow(stableKey)}
                        className={cn(
                          "w-full grid grid-cols-[20px_140px_140px_100px_100px_1fr_16px] gap-2 px-4 py-2.5 text-left text-xs transition-colors",
                          hasData
                            ? "hover:bg-muted/30 cursor-pointer"
                            : "cursor-default",
                          isExpanded && "bg-muted/20"
                        )}
                      >
                        {/* Severity dot */}
                        <div className="flex items-center">
                          <span
                            className={cn(
                              "size-2 rounded-full shrink-0",
                              SEVERITY_DOT[severity]
                            )}
                          />
                        </div>

                        {/* Timestamp */}
                        <span className="font-mono tabular-nums text-muted-foreground text-xs truncate">
                          {formatTimestamp(evt.ts)}
                        </span>

                        {/* Event badge */}
                        <div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-mono",
                              SEVERITY_STYLES[severity]
                            )}
                          >
                            {evt.event}
                          </Badge>
                        </div>

                        {/* Agent — clickable */}
                        <span
                          className="font-mono text-muted-foreground truncate cursor-pointer hover:text-foreground hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToTab?.("agents");
                          }}
                        >
                          {evt.agent ?? "--"}
                        </span>

                        {/* Ticket — clickable */}
                        <span
                          className="font-mono text-indigo-400/80 truncate cursor-pointer hover:text-indigo-300 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToTab?.("tickets");
                          }}
                        >
                          {evt.ticket ?? "--"}
                        </span>

                        {/* Detail preview */}
                        <span className="text-muted-foreground truncate">
                          {detail}
                        </span>

                        {/* Expand chevron */}
                        <div className="flex items-center">
                          {hasData &&
                            (isExpanded ? (
                              <ChevronDown className="size-3 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-3 text-muted-foreground/50" />
                            ))}
                        </div>
                      </button>

                      {/* Expanded data — structured table */}
                      {isExpanded && hasData && (
                        <div className="px-8 py-3 bg-zinc-950/50 border-t border-border/20">
                          <table className="w-full text-xs">
                            <tbody>
                              {Object.entries(evt.data!).map(([key, value]) => (
                                <tr key={key} className="border-b border-border/10 last:border-0">
                                  <td className="py-1.5 pr-4 font-mono text-muted-foreground align-top whitespace-nowrap">{key}</td>
                                  <td className="py-1.5 font-mono text-zinc-300 break-all">
                                    {typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value ?? "")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
