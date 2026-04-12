"use client";

import { useEffect, useState, useCallback } from "react";
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
  Plus, X, Loader2, ChevronRight, Clock, AlertCircle,
  Circle, CheckCircle2, Eye, MessageSquare, Tag,
  ArrowUp, ArrowDown, Minus, LayoutGrid, List,
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
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [activeId, setActiveId] = useState<string | null>(null);

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

  // 상태별 그룹핑
  const grouped: Record<TicketStatus, Ticket[]> = {
    backlog: [], todo: [], in_progress: [], review: [], done: [],
  };
  for (const t of tickets) {
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
    } else {
      // 롤백
      setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: ticket.status } : t));
      toast.error("상태 변경 실패", { description: r.error });
    }
  };

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
        <div className="flex gap-2">
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
              <StatusColumn key={s.key} status={s} tickets={grouped[s.key]} onDetail={setDetailTicket} />
            ))}
          </div>
          <DragOverlay>
            {activeTicket ? <TicketCard ticket={activeTicket} isDragOverlay /> : null}
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
              {tickets.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">티켓이 없습니다</td></tr>
              ) : tickets.map((t) => {
                const p = PRIORITY_STYLE[t.priority];
                return (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setDetailTicket(t)}>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{t.id}</td>
                    <td className="px-3 py-2 font-medium">{t.title}</td>
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
        onOpenChange={setCreateOpen}
        teams={teams}
        goals={goals}
        agents={agentList}
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
}: {
  status: (typeof STATUSES)[number];
  tickets: Ticket[];
  onDetail: (t: Ticket) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.key });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 w-[220px] flex flex-col rounded-xl border transition-colors",
        isOver ? "border-indigo-500/50 bg-indigo-500/5" : "border-border/50 bg-muted/10",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30">
        {status.icon}
        <span className="text-xs font-semibold">{status.label}</span>
        <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto">{tickets.length}</Badge>
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-[100px]">
        {tickets.map((t) => (
          <DraggableTicket key={t.id} ticket={t} onDetail={() => onDetail(t)} />
        ))}
      </div>
    </div>
  );
}

// ━━━ 드래그 가능한 티켓 ━━━

function DraggableTicket({ ticket, onDetail }: { ticket: Ticket; onDetail: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });

  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}>
      <TicketCard ticket={ticket} dragProps={{ ...attributes, ...listeners }} onDetail={onDetail} />
    </div>
  );
}

// ━━━ 티켓 카드 ━━━

function TicketCard({
  ticket, isDragOverlay, dragProps, onDetail,
}: {
  ticket: Ticket;
  isDragOverlay?: boolean;
  dragProps?: Record<string, unknown>;
  onDetail?: () => void;
}) {
  const p = PRIORITY_STYLE[ticket.priority];

  return (
    <Card
      className={cn(
        "cursor-pointer hover:border-foreground/20 transition-colors",
        isDragOverlay && "shadow-lg ring-2 ring-indigo-500/30 rotate-1",
      )}
      onClick={onDetail}
    >
      <CardContent className="p-2.5 space-y-1.5" {...dragProps}>
        {/* ID + 우선순위 */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">{ticket.id}</span>
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
        </div>
      </CardContent>
    </Card>
  );
}

// ━━━ 생성 다이얼로그 ━━━

function CreateTicketDialog({
  open, onOpenChange, teams, goals, agents, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teams: StateResponse["teams"];
  goals: Goal[];
  agents: { id: string; name: string }[];
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
        <DialogHeader className="shrink-0"><DialogTitle>새 티켓</DialogTitle></DialogHeader>
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
  ticket, teams, agents, onClose, onUpdated,
}: {
  ticket: Ticket;
  teams: StateResponse["teams"];
  agents: { id: string; name: string }[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const p = PRIORITY_STYLE[ticket.priority];
  const [commits, setCommits] = useState<Array<{ hash: string; short_hash: string; author: string; date: string; message: string; agent: string | null }>>([]);

  useEffect(() => {
    api.gitLog({ ticket: ticket.id, limit: 20 }).then((r) => setCommits(r.commits ?? [])).catch(() => setCommits([]));
  }, [ticket.id]);

  const handleStatusChange = async (newStatus: TicketStatus) => {
    const r = await api.ticketUpdate(ticket.id, { status: newStatus });
    if (r.ok) { toast.success("상태 변경됨"); await onUpdated(); }
    else { toast.error("변경 실패", { description: r.error }); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-[480px] max-w-full h-full bg-card border-l border-border shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
            <span className={cn("flex items-center gap-1 text-xs", p.color)}>{p.icon}{ticket.priority}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* 제목 */}
          <h2 className="text-lg font-bold">{ticket.title}</h2>

          {/* 상태 변경 */}
          <div className="flex items-center gap-2">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => handleStatusChange(s.key)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                  ticket.status === s.key
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {s.icon}{s.label}
              </button>
            ))}
          </div>

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
