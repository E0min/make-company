"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Plus, X, Loader2, ChevronRight, ChevronDown, Clock, AlertCircle,
  Circle, CheckCircle2, Eye, MessageSquare, Tag,
  ArrowUp, ArrowDown, Minus, LayoutGrid, List, Search,
  ShieldAlert, Ban, GitBranch, Filter, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, getCurrentProject } from "@/lib/api";
import type {
  Ticket, TicketStatus, TicketPriority, TicketType, StateResponse, AgentsResponse, Goal,
} from "@/lib/types";

// ━━━ 상수 ━━━

const STATUSES: { key: TicketStatus; label: string; icon: React.ReactNode }[] = [
  { key: "backlog", label: "Backlog", icon: <Circle className="size-3 text-zinc-500" /> },
  { key: "todo", label: "Todo", icon: <Circle className="size-3 text-blue-400" /> },
  { key: "in_progress", label: "In Progress", icon: <Loader2 className="size-3 text-indigo-400 animate-spin" /> },
  { key: "review", label: "Review", icon: <Eye className="size-3 text-amber-400" /> },
  { key: "done", label: "Done", icon: <CheckCircle2 className="size-3 text-emerald-400" /> },
];

const PRIORITY_STYLE: Record<TicketPriority, { icon: React.ReactNode; color: string }> = {
  critical: { icon: <AlertCircle className="size-3" />, color: "text-red-400" },
  high: { icon: <ArrowUp className="size-3" />, color: "text-orange-400" },
  medium: { icon: <Minus className="size-3" />, color: "text-zinc-400" },
  low: { icon: <ArrowDown className="size-3" />, color: "text-blue-400" },
};

const STATUS_BY_NUM: Record<string, TicketStatus> = {
  "1": "backlog",
  "2": "todo",
  "3": "in_progress",
  "4": "review",
  "5": "done",
};

type FilterPreset = "all" | "my_tasks" | "in_progress";

// ━━━ localStorage helpers ━━━

function lsGet(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

// ━━━ Props ━━━

interface Props {
  state: StateResponse | null;
  agents: AgentsResponse | null;
}

// ━━━ 메인 컴포넌트 ━━━

export function TicketsTab({ state, agents }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [goalCreateOpen, setGoalCreateOpen] = useState(false);
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [viewMode, setViewMode] = useState<"board" | "list">(() => lsGet("vc-ticket-viewMode", "board") as "board" | "list");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState(() => lsGet("vc-ticket-search", ""));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");
  const [goalFilter, setGoalFilter] = useState<string>("__all__");

  // Persist viewMode and search to localStorage
  useEffect(() => { lsSet("vc-ticket-viewMode", viewMode); }, [viewMode]);
  useEffect(() => { lsSet("vc-ticket-search", search); }, [search]);

  const teams = state?.teams ?? {};
  const agentList = agents?.agents ?? [];

  const fetchAll = useCallback(async () => {
    if (!getCurrentProject()) { setLoading(false); return; }
    try {
      const [tRes, gRes] = await Promise.all([api.tickets(), api.goals()]);
      setTickets(tRes.tickets ?? []);
      setGoals(gRes.goals ?? []);
    } catch { setTickets([]); setGoals([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 필터 프리셋 적용
  const firstAgentId = agentList.length > 0 ? agentList[0].id : "user";

  const presetFiltered = (() => {
    switch (filterPreset) {
      case "my_tasks":
        return tickets.filter((t) => t.assignee === firstAgentId);
      case "in_progress":
        return tickets.filter((t) => t.status === "in_progress");
      default:
        return tickets;
    }
  })();

  // 목표 필터링
  const goalFiltered = (() => {
    if (goalFilter === "__all__") return presetFiltered;
    if (goalFilter === "__none__") return presetFiltered.filter((t) => t.goal === null);
    return presetFiltered.filter((t) => t.goal === goalFilter);
  })();

  // 검색 필터링
  const filteredTickets = search.trim()
    ? goalFiltered.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          t.labels.some((l) => l.toLowerCase().includes(q)) ||
          (t.assignee?.toLowerCase().includes(q) ?? false)
        );
      })
    : goalFiltered;

  // 상태별 그룹핑
  const grouped: Record<TicketStatus, Ticket[]> = {
    backlog: [], todo: [], in_progress: [], review: [], done: [],
  };
  for (const t of filteredTickets) {
    (grouped[t.status] ??= []).push(t);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const ticketId = String(active.id);
    const newStatus = String(over.id) as TicketStatus;
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === newStatus) return;

    // 낙관적 업데이트
    setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: newStatus } : t));

    const r = await api.ticketUpdate(ticketId, { status: newStatus });
    if (r.ok) {
      toast.success("상태 변경됨", { description: `${ticketId} → ${newStatus}` });
      await fetchAll();
    } else {
      // 롤백
      setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: ticket.status } : t));
      // 상세 거부 사유 표시
      if (r.missing_steps?.length) {
        toast.error("워크플로 위반", { description: `"${r.missing_steps.join(", ")}" 단계를 먼저 완료해야 합니다`, duration: 5000 });
      } else if (r.wip_tickets?.length) {
        toast.error("WIP 한도 초과", { description: `${r.error ?? "진행 중인 작업을 먼저 완료하세요"} (${r.wip_tickets.join(", ")})`, duration: 5000 });
      } else if (r.failures?.length) {
        toast.error("게이트 미충족", { description: r.failures.join(", "), duration: 5000 });
      } else {
        toast.error("상태 변경 실패", { description: r.error });
      }
    }
  };

  // 리스트 뷰 트리: 루트 티켓과 자식 티켓 분리
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const treeRows = (() => {
    const rootTickets = filteredTickets.filter((t) => !t.parent);
    const childMap = new Map<string, Ticket[]>();
    for (const t of filteredTickets) {
      if (t.parent) {
        const arr = childMap.get(t.parent) ?? [];
        arr.push(t);
        childMap.set(t.parent, arr);
      }
    }
    const rows: Array<{ ticket: Ticket; depth: number; hasChildren: boolean; isExpanded: boolean }> = [];
    for (const root of rootTickets) {
      const children = childMap.get(root.id) ?? [];
      rows.push({ ticket: root, depth: 0, hasChildren: children.length > 0, isExpanded: expandedRows.has(root.id) });
      if (expandedRows.has(root.id)) {
        for (const child of children) {
          rows.push({ ticket: child, depth: 1, hasChildren: false, isExpanded: false });
        }
      }
    }
    // 검색 중에 자식만 매칭되어 부모 없이 표시될 수 있는 경우 (고아 자식 추가)
    const addedIds = new Set(rows.map((r) => r.ticket.id));
    for (const t of filteredTickets) {
      if (!addedIds.has(t.id)) {
        rows.push({ ticket: t, depth: 1, hasChildren: false, isExpanded: false });
      }
    }
    return rows;
  })();

  // ━━━ Keyboard navigation (j/k/Enter/1-5) ━━━

  // Build a flat navigable list from the current view
  const navigableTickets: Ticket[] = viewMode === "list"
    ? treeRows.map((r) => r.ticket)
    : filteredTickets;

  // Reset selectedIndex when list changes
  const prevLenRef = useRef(navigableTickets.length);
  useEffect(() => {
    if (navigableTickets.length !== prevLenRef.current) {
      setSelectedIndex((prev) => Math.min(prev, navigableTickets.length - 1));
      prevLenRef.current = navigableTickets.length;
    }
  }, [navigableTickets.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when dialogs/panels are open or focus is in input
      if (detailTicket || createOpen || goalCreateOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const maxIdx = navigableTickets.length - 1;
      if (maxIdx < 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, maxIdx));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" && selectedIndex >= 0 && selectedIndex <= maxIdx) {
        e.preventDefault();
        setDetailTicket(navigableTickets[selectedIndex]);
        return;
      }
      // 1-5: change selected ticket status
      const newStatus = STATUS_BY_NUM[e.key];
      if (newStatus && selectedIndex >= 0 && selectedIndex <= maxIdx) {
        const ticket = navigableTickets[selectedIndex];
        if (ticket.status === newStatus) return;
        // Optimistic update
        setTickets((prev) => prev.map((tk) => tk.id === ticket.id ? { ...tk, status: newStatus } : tk));
        api.ticketUpdate(ticket.id, { status: newStatus }).then((r) => {
          if (r.ok) {
            toast.success("상태 변경됨", { description: `${ticket.id} → ${newStatus}` });
            fetchAll();
          } else {
            // Rollback
            setTickets((prev) => prev.map((tk) => tk.id === ticket.id ? { ...tk, status: ticket.status } : tk));
            const ms = r.missing_steps as string[] | undefined;
            if (ms?.length) {
              toast.error("워크플로 위반", { description: `"${ms.join(", ")}" 단계를 먼저 완료해야 합니다`, duration: 5000 });
            } else {
              toast.error("상태 변경 실패", { description: r.error });
            }
          }
        });
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [detailTicket, createOpen, goalCreateOpen, navigableTickets, selectedIndex, fetchAll]);

  const activeTicket = activeId ? tickets.find((t) => t.id === activeId) : null;

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin mr-2" />Loading tickets...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Tickets</h2>
          <Badge variant="secondary" className="text-[10px]">{tickets.length}</Badge>
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets..."
              className="h-7 w-48 pl-7 text-xs"
            />
          </div>
          {/* Goal Filter */}
          <Select value={goalFilter} onValueChange={(v) => { setGoalFilter(v ?? "__all__"); setSelectedIndex(-1); }}>
            <SelectTrigger className="h-7 w-40 text-xs gap-1">
              <Target className="size-3 text-muted-foreground shrink-0" />
              <SelectValue placeholder="목표: 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">목표: 전체</SelectItem>
              <SelectItem value="__none__">목표 없음</SelectItem>
              {goals.filter((g) => g.status === "active").map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.id}: {g.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Filter Presets */}
          <div className="flex border border-border rounded-md">
            <Button
              variant={filterPreset === "all" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-r-none h-7 text-xs gap-1"
              onClick={() => { setFilterPreset("all"); setSelectedIndex(-1); }}
            >
              전체
            </Button>
            <Button
              variant={filterPreset === "in_progress" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none h-7 text-xs gap-1 border-x border-border"
              onClick={() => { setFilterPreset("in_progress"); setSelectedIndex(-1); }}
            >
              <Filter className="size-3" />
              진행 중
            </Button>
            <Button
              variant={filterPreset === "my_tasks" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-l-none h-7 text-xs gap-1"
              onClick={() => { setFilterPreset("my_tasks"); setSelectedIndex(-1); }}
            >
              내 작업
            </Button>
          </div>

          {/* View Toggle */}
          <div className="flex border border-border rounded-md">
            <Button variant={viewMode === "board" ? "secondary" : "ghost"} size="sm" className="rounded-r-none h-7" onClick={() => setViewMode("board")}>
              <LayoutGrid className="size-3" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" className="rounded-l-none h-7" onClick={() => setViewMode("list")}>
              <List className="size-3" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setGoalCreateOpen(true)}>
            <Plus className="size-3.5" />
            Goal
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Ticket
          </Button>
        </div>
      </div>

      {/* Goals 진행률 바 */}
      {goals.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {goals.filter((g) => g.status === "active").map((g) => (
            <div key={g.id} className="shrink-0 min-w-[200px] p-3 rounded-lg border border-border/50 bg-muted/10 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">{g.title}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(g.progress * 100)}%</span>
              </div>
              {g.mission && <div className="text-[10px] text-muted-foreground truncate">{g.mission}</div>}
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${g.progress * 100}%` }} />
              </div>
              <div className="text-[9px] text-muted-foreground">{g.tickets.length} tickets · {g.id}</div>
            </div>
          ))}
        </div>
      )}

      {/* 보드 뷰 */}
      {viewMode === "board" ? (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {STATUSES.map((s) => (
              <StatusColumn key={s.key} status={s} tickets={grouped[s.key]} onDetail={setDetailTicket} wipLimit={s.key === "in_progress" ? 3 : undefined} selectedTicketId={selectedIndex >= 0 && selectedIndex < navigableTickets.length ? navigableTickets[selectedIndex].id : null} allTickets={tickets} />
            ))}
          </div>
          <DragOverlay>
            {activeTicket ? <TicketCard ticket={activeTicket} isDragOverlay allTickets={tickets} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        /* 리스트 뷰 */
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left w-20">ID</th>
                <th className="px-3 py-2 text-left">제목</th>
                <th className="px-3 py-2 text-left w-24">상태</th>
                <th className="px-3 py-2 text-left w-20">우선순위</th>
                <th className="px-3 py-2 text-left w-24">담당자</th>
                <th className="px-3 py-2 text-left w-24">팀</th>
                <th className="px-3 py-2 text-left w-32">업데이트</th>
              </tr>
            </thead>
            <tbody>
              {treeRows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{search ? "검색 결과가 없습니다" : "티켓이 없습니다"}</td></tr>
              ) : treeRows.map(({ ticket: t, depth, hasChildren, isExpanded }, rowIdx) => {
                const p = PRIORITY_STYLE[t.priority];
                const isSelected = viewMode === "list" && selectedIndex === rowIdx;
                return (
                  <tr key={t.id} className={cn("border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer", depth > 0 && "bg-muted/5", isSelected && "ring-1 ring-primary/50 bg-primary/5")} onClick={() => setDetailTicket(t)}>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      <div className="flex items-center" style={{ paddingLeft: depth > 0 ? "1.5rem" : undefined }}>
                        {hasChildren ? (
                          <button
                            type="button"
                            className="mr-1 p-0.5 rounded hover:bg-muted/60 transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleRow(t.id); }}
                            aria-label={isExpanded ? "서브태스크 접기" : "서브태스크 펼치기"}
                          >
                            {isExpanded
                              ? <ChevronDown className="size-3 text-muted-foreground" />
                              : <ChevronRight className="size-3 text-muted-foreground" />
                            }
                          </button>
                        ) : depth > 0 ? (
                          <span className="mr-1 w-4 flex justify-center text-muted-foreground/30">└</span>
                        ) : (
                          <span className="mr-1 w-4" />
                        )}
                        {t.id}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span className={cn(depth > 0 && "text-muted-foreground")}>{t.title}</span>
                        {t.children.length > 0 && (() => {
                          const total = t.children.length;
                          const doneCount = t.children.filter((cid) => {
                            const child = tickets.find((tk) => tk.id === cid);
                            return child?.status === "done";
                          }).length;
                          const colorClass = doneCount === total
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                            : doneCount > 0
                              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/20"
                              : "bg-zinc-500/15 text-zinc-400 border-zinc-500/20";
                          return (
                            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums border", colorClass)}>
                              <GitBranch className="size-2.5" />
                              {doneCount}/{total}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {STATUSES.find((s) => s.key === t.status)?.label ?? t.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2"><span className={cn("flex items-center gap-1 text-xs", p.color)}>{p.icon}{t.priority}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.assignee ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.team ? teams[t.team]?.label ?? t.team : "-"}</td>
                    <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground tabular-nums">{t.updated_at?.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 생성 다이얼로그 */}
      {/* Goal 생성 */}
      <GoalCreateDialog open={goalCreateOpen} onOpenChange={setGoalCreateOpen} onCreated={fetchAll} />

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateParentId(null); }}
        teams={teams}
        goals={goals}
        agents={agentList}
        parentId={createParentId}
        onCreated={fetchAll}
      />

      {/* 상세 패널 */}
      {detailTicket && (
        <TicketDetailPanel
          ticket={detailTicket}
          teams={teams}
          agents={agentList}
          onClose={() => setDetailTicket(null)}
          onUpdated={fetchAll}
          onCreateSubtask={(parentId) => { setCreateParentId(parentId); setCreateOpen(true); }}
        />
      )}
    </div>
  );
}

// ━━━ 상태 컬럼 (드롭 영역) ━━━

function StatusColumn({
  status,
  tickets,
  onDetail,
  wipLimit,
  selectedTicketId,
  allTickets,
}: {
  status: (typeof STATUSES)[number];
  tickets: Ticket[];
  onDetail: (t: Ticket) => void;
  wipLimit?: number;
  selectedTicketId?: string | null;
  allTickets?: Ticket[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key });
  const isOverWip = wipLimit != null && status.key === "in_progress" && tickets.length >= wipLimit;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 w-[220px] flex flex-col rounded-xl border transition-colors",
        isOver ? "border-indigo-500/50 bg-indigo-500/5" : "border-border/50 bg-muted/10",
        isOverWip && "border-red-500/40",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
        {status.icon}
        <span className="text-xs font-semibold">{status.label}</span>
        <div className="flex items-center gap-1 ml-auto">
          {status.key === "in_progress" && wipLimit != null && (
            <span className={cn("text-[9px] font-mono tabular-nums", isOverWip ? "text-red-400" : "text-muted-foreground")}>
              {tickets.length}/{wipLimit}
            </span>
          )}
          <Badge variant="secondary" className="text-[9px] h-4 px-1">{tickets.length}</Badge>
        </div>
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-[100px]">
        {tickets.map((t) => (
          <DraggableTicket key={t.id} ticket={t} onDetail={() => onDetail(t)} isSelected={selectedTicketId === t.id} allTickets={allTickets} />
        ))}
      </div>
    </div>
  );
}

// ━━━ 드래그 가능한 티켓 ━━━

function DraggableTicket({ ticket, onDetail, isSelected, allTickets }: { ticket: Ticket; onDetail: () => void; isSelected?: boolean; allTickets?: Ticket[] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}>
      <TicketCard ticket={ticket} dragProps={{ ...attributes, ...listeners }} onDetail={onDetail} isSelected={isSelected} allTickets={allTickets} />
    </div>
  );
}

// ━━━ 티켓 카드 ━━━

/** 워크플로 단계 정의 (config.json workflow_templates 기준) */
const WORKFLOW_STEPS: Record<string, string[]> = {
  feature: ["backlog", "todo", "spec", "design", "in_progress", "review", "done"],
  bugfix: ["backlog", "todo", "in_progress", "review", "done"],
  design: ["backlog", "todo", "research", "draft", "review", "done"],
  refactor: ["backlog", "todo", "in_progress", "review", "done"],
};

function TicketCard({
  ticket, isDragOverlay, dragProps, onDetail, isSelected, allTickets,
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  dragProps?: Record<string, unknown>;
  onDetail?: () => void;
  isSelected?: boolean;
  allTickets?: Ticket[];
}) {
  const p = PRIORITY_STYLE[ticket.priority];
  const steps = WORKFLOW_STEPS[ticket.type] ?? WORKFLOW_STEPS.feature;
  const completedSteps = ticket.completed_steps ?? [];
  const currentIdx = steps.indexOf(ticket.status);
  const progress = steps.length > 1 ? Math.max(0, currentIdx) / (steps.length - 1) : 0;

  return (
    <Card
      className={cn(
        "cursor-pointer hover:border-foreground/20 transition-colors",
        isDragOverlay && "shadow-lg ring-2 ring-indigo-500/30 rotate-1",
        isSelected && "ring-1 ring-primary/50 border-primary/30",
      )}
      onClick={onDetail}
    >
      <CardContent className="p-2.5 space-y-1.5" {...dragProps}>
        {/* ID + 우선순위 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">{ticket.id}</span>
            {ticket.type !== "feature" && (
              <Badge variant="outline" className="text-[8px] h-3.5 px-1">{ticket.type}</Badge>
            )}
          </div>
          <span className={cn("flex items-center gap-0.5", p.color)}>{p.icon}</span>
        </div>
        {/* 제목 */}
        <div className="text-xs font-medium line-clamp-2">{ticket.title}</div>
        {/* 메타 */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {ticket.assignee && <span>{ticket.assignee}</span>}
          {ticket.labels.length > 0 && (
            <span className="flex items-center gap-0.5"><Tag className="size-2.5" />{ticket.labels.length}</span>
          )}
          {ticket.acceptance_criteria.length > 0 && (
            <span className="flex items-center gap-0.5"><CheckCircle2 className="size-2.5" />{ticket.acceptance_criteria.length}</span>
          )}
          {ticket.children && ticket.children.length > 0 && (() => {
            const total = ticket.children.length;
            const doneCount = allTickets
              ? ticket.children.filter((cid) => {
                  const child = allTickets.find((t) => t.id === cid);
                  return child?.status === "done";
                }).length
              : 0;
            const colorClass = doneCount === total
              ? "text-emerald-400"
              : doneCount > 0
                ? "text-indigo-400"
                : "text-zinc-400";
            return (
              <span className={cn("flex items-center gap-0.5", colorClass)}>
                <ChevronRight className="size-2.5" />{doneCount}/{total} subtasks
              </span>
            );
          })()}
        </div>
        {/* 워크플로 진행률 바 */}
        {steps.length > 2 && (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", ticket.status === "done" ? "bg-emerald-500" : "bg-indigo-500")}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/60 tabular-nums">
              {currentIdx >= 0 ? currentIdx + 1 : 0}/{steps.length}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ━━━ 생성 다이얼로그 ━━━

function CreateTicketDialog({
  open, onOpenChange, teams, goals, agents, parentId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teams: StateResponse["teams"];
  goals: Goal[];
  agents: { id: string; name: string }[];
  parentId?: string | null;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [ticketType, setTicketType] = useState<TicketType>("feature");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [ac, setAc] = useState("");
  const [labels, setLabels] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setTitle(""); setTicketType("feature"); setDesc(""); setPriority("medium"); setAssignee(null); setTeam(null); setGoal(null); setAc(""); setLabels(""); }
  }, [open]);

  const handleCreate = async () => {
    if (!title.trim()) { toast.warning("제목을 입력하세요"); return; }
    setSaving(true);
    const r = await api.ticketCreate({
      title: title.trim(),
      type: ticketType,
      description: desc.trim(),
      priority,
      assignee,
      team,
      parent: parentId ?? undefined,
      labels: labels.trim() ? labels.split(",").map((l) => l.trim()) : [],
      acceptance_criteria: ac.trim() ? ac.split("\n").map((l) => l.trim()).filter(Boolean) : [],
    });
    if (r.ok) {
      toast.success("티켓 생성됨", { description: String(r.id ?? "") });
      onOpenChange(false);
      await onCreated();
    } else {
      toast.error("생성 실패", { description: r.error });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[40vw] max-w-none max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{parentId ? `서브태스크 생성` : "새 티켓"}</DialogTitle>
          {parentId && <p className="text-xs text-muted-foreground">상위 티켓: {parentId}</p>}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="space-y-1.5">
            <Label>제목</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="무엇을 해야 하나요?" autoFocus />
          </div>
          <div className="grid grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <Label>타입</Label>
              <Select value={ticketType} onValueChange={(v) => setTicketType(v as TicketType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="bugfix">Bugfix</SelectItem>
                  <SelectItem value="design">Design</SelectItem>
                  <SelectItem value="refactor">Refactor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>우선순위</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>담당자</Label>
              <Select value={assignee ?? "__none__"} onValueChange={(v) => setAssignee(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">미정</SelectItem>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>팀</Label>
              <Select value={team ?? "__none__"} onValueChange={(v) => setTeam(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">미정</SelectItem>
                  {Object.entries(teams).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>목표</Label>
              <Select value={goal ?? "__none__"} onValueChange={(v) => setGoal(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">없음</SelectItem>
                  {goals.filter((g) => g.status === "active").map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>설명</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="상세 설명..." />
          </div>
          <div className="space-y-1.5">
            <Label>완료 기준 (줄바꿈으로 구분)</Label>
            <Textarea value={ac} onChange={(e) => setAc(e.target.value)} rows={3} placeholder="로그인 폼 표시&#10;JWT 토큰 발급&#10;에러 처리" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label>라벨 (콤마로 구분)</Label>
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="feature, auth, frontend" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} 생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ━━━ 상세 패널 (사이드 드로어) ━━━

function TicketDetailPanel({
  ticket, teams, agents, onClose, onUpdated, onCreateSubtask,
}: {
  ticket: Ticket;
  teams: StateResponse["teams"];
  agents: { id: string; name: string }[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onCreateSubtask: (parentId: string) => void;
}) {
  const p = PRIORITY_STYLE[ticket.priority];
  const [commits, setCommits] = useState<Array<{ hash: string; short_hash: string; author: string; date: string; message: string; agent: string | null }>>([]);
  const [transitionsData, setTransitionsData] = useState<{
    transitions: Array<{ status: string; allowed: boolean; reason?: string }>;
    wip_warning?: string;
    blocked_children?: string[];
  } | null>(null);
  const [transitionsLoading, setTransitionsLoading] = useState(true);

  useEffect(() => {
    api.gitLog({ ticket: ticket.id, limit: 20 }).then((r) => setCommits(r.commits ?? [])).catch(() => setCommits([]));
  }, [ticket.id]);

  // 서버에서 허용 전환 목록 조회
  useEffect(() => {
    setTransitionsLoading(true);
    api.ticketTransitions(ticket.id)
      .then((r) => setTransitionsData(r))
      .catch(() => setTransitionsData(null))
      .finally(() => setTransitionsLoading(false));
  }, [ticket.id, ticket.status]);

  const handleStatusChange = async (newStatus: TicketStatus) => {
    const r = await api.ticketUpdate(ticket.id, { status: newStatus });
    if (r.ok) {
      toast.success("상태 변경됨");
      await onUpdated();
      // 전환 후 transitions 재조회
      api.ticketTransitions(ticket.id)
        .then((tr) => setTransitionsData(tr))
        .catch(() => setTransitionsData(null));
    } else {
      if (r.missing_steps?.length) {
        toast.error("워크플로 위반", { description: `"${r.missing_steps.join(", ")}" 단계를 먼저 완료해야 합니다`, duration: 5000 });
      } else if (r.wip_tickets?.length) {
        toast.error("WIP 한도 초과", { description: `${r.error ?? "진행 중인 작업을 먼저 완료하세요"} (${r.wip_tickets.join(", ")})`, duration: 5000 });
      } else if (r.failures?.length) {
        toast.error("게이트 미충족", { description: r.failures.join(", "), duration: 5000 });
      } else {
        toast.error("변경 실패", { description: r.error });
      }
    }
  };

  // 서버 transitions API 기반 전환 가능 여부 (폴백: 전부 허용)
  const completedSet = new Set([...(ticket.completed_steps ?? []), ticket.status]);
  const steps = WORKFLOW_STEPS[ticket.type] ?? WORKFLOW_STEPS.feature;

  function canTransition(target: string): { allowed: boolean; reason?: string } {
    if (target === ticket.status) return { allowed: true };
    if (!transitionsData) return { allowed: true }; // 로딩 중이면 허용 (폴백)
    const entry = transitionsData.transitions.find((t) => t.status === target);
    if (!entry) return { allowed: true };
    return { allowed: entry.allowed, reason: entry.reason };
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-[480px] max-w-full h-full bg-card border-l border-border shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
            <Badge variant="outline" className="text-[9px]">{ticket.type}</Badge>
            <span className={cn("flex items-center gap-1 text-xs", p.color)}>{p.icon}{ticket.priority}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* 제목 */}
          <h2 className="text-lg font-bold">{ticket.title}</h2>

          {/* 워크플로 진행 시각화 */}
          {steps.length > 2 && (
            <div className="flex items-center gap-1">
              {steps.map((step, i) => {
                const isCurrent = step === ticket.status;
                const isDone = completedSet.has(step) && !isCurrent;
                return (
                  <div key={step} className="flex items-center gap-1">
                    <div className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono",
                      isCurrent && "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30",
                      isDone && "text-emerald-400/70",
                      !isCurrent && !isDone && "text-muted-foreground/40",
                    )}>
                      {isDone && <CheckCircle2 className="size-2.5" />}
                      {step}
                    </div>
                    {i < steps.length - 1 && <span className="text-muted-foreground/20">›</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* 상태 변경 */}
          <div className="flex items-center gap-2 flex-wrap">
            {transitionsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 전환 정보 로딩...
              </div>
            ) : (
              STATUSES.map((s) => {
                const { allowed, reason } = canTransition(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => allowed ? handleStatusChange(s.key) : toast.warning("전환 불가", { description: reason })}
                    title={!allowed ? reason : undefined}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      ticket.status === s.key
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : allowed
                          ? "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                          : "bg-muted/20 border-border/30 text-muted-foreground/30 cursor-not-allowed"
                    )}
                  >
                    {!allowed && <Ban className="size-2.5" />}
                    {s.icon}{s.label}
                  </button>
                );
              })
            )}
          </div>

          {/* WIP 경고 */}
          {transitionsData?.wip_warning && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs text-amber-400">
              <ShieldAlert className="size-3.5 shrink-0" />
              {transitionsData.wip_warning}
            </div>
          )}

          {/* 미완료 서브태스크 경고 */}
          {transitionsData?.blocked_children && transitionsData.blocked_children.length > 0 && (
            <div className="px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-400 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="size-3.5 shrink-0" />
                미완료 서브태스크 ({transitionsData.blocked_children.length}개)
              </div>
              <ul className="pl-5 space-y-0.5">
                {transitionsData.blocked_children.map((child) => (
                  <li key={child} className="font-mono">{child}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 차단된 전환 (gate rejection reasons) */}
          {transitionsData && transitionsData.transitions.some((t) => !t.allowed) && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-xs">
              <AlertCircle className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium text-amber-400">차단된 전환:</div>
                <ul className="space-y-0.5">
                  {transitionsData.transitions
                    .filter((t) => !t.allowed)
                    .map((t) => (
                      <li key={t.status} className="text-amber-300/80">
                        <span className="font-mono font-medium">{t.status}</span>
                        {t.reason && (
                          <span className="text-amber-400/60">: &ldquo;{t.reason}&rdquo;</span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          )}

          {/* 메타 */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-xs text-muted-foreground">담당자</span><div className="font-medium">{ticket.assignee ?? "미정"}</div></div>
            <div><span className="text-xs text-muted-foreground">팀</span><div className="font-medium">{ticket.team ? teams[ticket.team]?.label ?? ticket.team : "미정"}</div></div>
            <div><span className="text-xs text-muted-foreground">생성</span><div className="text-xs font-mono">{ticket.created_at?.slice(0, 16).replace("T", " ")}</div></div>
            <div><span className="text-xs text-muted-foreground">수정</span><div className="text-xs font-mono">{ticket.updated_at?.slice(0, 16).replace("T", " ")}</div></div>
          </div>

          {/* 라벨 */}
          {ticket.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ticket.labels.map((l) => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
            </div>
          )}

          {/* 설명 */}
          {ticket.description && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">설명</h3>
              <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            </div>
          )}

          {/* 완료 기준 */}
          {ticket.acceptance_criteria.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">완료 기준</h3>
              <ul className="space-y-1">
                {ticket.acceptance_criteria.map((ac, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="size-3.5 mt-0.5 text-muted-foreground/40 shrink-0" />
                    {ac}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 서브태스크 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground">서브태스크</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-indigo-400 hover:text-indigo-300"
                onClick={() => onCreateSubtask(ticket.id)}
              >
                <Plus className="size-3" />
                서브태스크
              </Button>
            </div>
            {ticket.children.length > 0 ? (
              <div className="space-y-1">
                {ticket.children.map((childId) => (
                  <div key={childId} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border/40 bg-muted/10 text-xs">
                    <GitBranch className="size-3 text-muted-foreground/50 shrink-0" />
                    <span className="font-mono text-muted-foreground">{childId}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">서브태스크 없음</p>
            )}
          </div>

          {/* Git Commits */}
          {commits.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2">Git Commits</h3>
              <div className="space-y-1.5">
                {commits.map((c) => (
                  <div key={c.hash} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-indigo-400 shrink-0">{c.short_hash}</span>
                    {c.agent && <Badge variant="outline" className="text-[8px] h-4 shrink-0">{c.agent}</Badge>}
                    <span className="text-foreground/80 truncate">{c.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity 타임라인 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">Activity</h3>
            <div className="space-y-2">
              {ticket.activity.map((act, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground/50 font-mono tabular-nums shrink-0 w-32">
                    {act.ts?.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="font-medium text-muted-foreground">{act.agent}</span>
                  <span className="text-foreground/80">
                    {act.action === "created" && "티켓 생성"}
                    {act.action === "comment" && act.message}
                    {act.action?.endsWith("_change") && `${act.action.replace("_change", "")} 변경: ${String(act.from)} → ${String(act.to)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ━━━ Goal 생성 다이얼로그 ━━━

function GoalCreateDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [mission, setMission] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setTitle(""); setMission(""); } }, [open]);

  const handleCreate = async () => {
    if (!title.trim()) { toast.warning("목표 제목을 입력하세요"); return; }
    setSaving(true);
    const r = await api.goalCreate({ title: title.trim(), mission: mission.trim() });
    if (r.ok) {
      toast.success("목표 생성됨", { description: String(r.id ?? "") });
      onOpenChange(false);
      await onCreated();
    } else {
      toast.error("생성 실패", { description: r.error });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>새 목표</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>목표</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="사용자 인증 시스템 구축" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>미션 (왜 이걸 하는가)</Label>
            <Input value={mission} onChange={(e) => setMission(e.target.value)} placeholder="안전한 사용자 경험 제공" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} 생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
