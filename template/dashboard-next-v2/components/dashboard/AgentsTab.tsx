"use client";

import { useEffect, useState } from "react";
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
  Plus,
  Trash2,
  Pencil,
  Download,
  Sparkles,
  Loader2,
  Terminal,
  X,
  GripVertical,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { stateColor } from "@/lib/format";
import type {
  AgentFull,
  AgentsResponse,
  GlobalAgent,
  StateResponse,
} from "@/lib/types";

interface Props {
  state: StateResponse | null;
  agents: AgentsResponse | null;
  onRefetch: () => Promise<void>;
  onOpenTerminal?: (agentId: string) => void;
}

const COLORS = [
  "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa",
  "#fb923c", "#a3e635", "#e879f9", "#2dd4bf", "#fbbf24",
];

// ━━━ 메인 컴포넌트: 칸반 보드 ━━━

export function AgentsTab({ state, agents, onRefetch, onOpenTerminal }: Props) {
  const [editAgent, setEditAgent] = useState<AgentFull | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeamId, setNewTeamId] = useState("");
  const [newTeamLabel, setNewTeamLabel] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  // 낙관적 업데이트용 로컬 오버라이드
  const [teamOverrides, setTeamOverrides] = useState<Record<string, string | null>>({});

  const rawAgentList = agents?.agents ?? [];
  // 로컬 오버라이드 적용
  const agentList = rawAgentList.map((a) =>
    a.id in teamOverrides ? { ...a, team: teamOverrides[a.id] } : a
  );
  const teams = state?.teams ?? {};
  const stateMap = new Map(
    (state?.agents ?? []).map((a) => [a.id, a.state])
  );

  // props 변경 시 오버라이드 클리어 (서버 데이터가 최신)
  useEffect(() => {
    setTeamOverrides({});
  }, [agents]);

  // 팀별 그룹핑: [null(소속없음), ...teamKeys]
  const columnKeys = ["__none__", ...Object.keys(teams)];
  const grouped: Record<string, AgentFull[]> = { "__none__": [] };
  for (const k of Object.keys(teams)) grouped[k] = [];
  for (const a of agentList) {
    const key = a.team && teams[a.team] ? a.team : "__none__";
    (grouped[key] ??= []).push(a);
  }

  const activeAgent = activeId ? agentList.find((a) => a.id === activeId) : null;

  // DnD 센서 (약간의 이동 후 드래그 시작 — 클릭과 구분)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const agentId = String(active.id);
    const targetTeam = String(over.id);
    const agent = agentList.find((a) => a.id === agentId);
    if (!agent) return;

    const currentTeam = agent.team ?? "__none__";
    if (currentTeam === targetTeam) return;

    const newTeam = targetTeam === "__none__" ? null : targetTeam;

    // 낙관적 업데이트: 즉시 UI 반영
    setTeamOverrides((prev) => ({ ...prev, [agentId]: newTeam }));

    const r = await api.agentsSave({ id: agentId, content: agent.content, team: newTeam });
    if (r.ok) {
      toast.success("팀 변경됨", { description: `${agent.name} → ${newTeam ? teams[newTeam]?.label ?? newTeam : "소속 없음"}` });
      await onRefetch();
    } else {
      // 실패 시 롤백
      setTeamOverrides((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
      toast.error("팀 변경 실패", { description: r.error });
    }
  };

  const handleDelete = async (id: string) => {
    const r = await api.agentsDelete(id);
    if (r.ok) {
      toast.success("삭제됨", { description: id });
      await onRefetch();
    } else {
      toast.error("삭제 실패", { description: r.error });
    }
  };

  const handleAddTeam = async () => {
    if (!newTeamId.trim()) return;
    const r = await api.teamsSave({ id: newTeamId.trim(), label: newTeamLabel.trim() || newTeamId.trim() });
    if (r.ok) {
      toast.success("팀 추가됨", { description: newTeamLabel || newTeamId });
      setAddingTeam(false);
      setNewTeamId("");
      setNewTeamLabel("");
      await onRefetch();
    } else {
      toast.error("팀 추가 실패", { description: r.error });
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    const r = await api.teamsDelete(teamId);
    if (r.ok) {
      toast.success("팀 삭제됨", { description: teamId });
      await onRefetch();
    } else {
      toast.error("팀 삭제 실패", { description: r.error });
    }
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Agents</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download className="size-3.5" />
            Import Global
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New Agent
          </Button>
        </div>
      </div>

      {/* 칸반 보드 */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ minHeight: "300px" }}>
          {/* 팀 컬럼들 */}
          {columnKeys.map((colKey) => (
            <TeamColumn
              key={colKey}
              teamKey={colKey}
              label={colKey === "__none__" ? "소속 없음" : teams[colKey]?.label ?? colKey}
              agents={grouped[colKey] ?? []}
              stateMap={stateMap}
              isNone={colKey === "__none__"}
              onEdit={setEditAgent}
              onDelete={handleDelete}
              onDeleteTeam={colKey !== "__none__" ? () => handleDeleteTeam(colKey) : undefined}
              onOpenTerminal={onOpenTerminal}
            />
          ))}

          {/* 팀 추가 컬럼 */}
          <div className="shrink-0 w-[220px]">
            {addingTeam ? (
              <Card className="h-full">
                <CardContent className="p-3 space-y-2">
                  <Label className="text-xs">새 팀</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="ID (영문소문자)"
                    value={newTeamId}
                    onChange={(e) => setNewTeamId(e.target.value)}
                    autoFocus
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder="팀 이름"
                    value={newTeamLabel}
                    onChange={(e) => setNewTeamLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTeam()}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAddTeam}>
                      생성
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => setAddingTeam(false)}>
                      <X className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <button
                type="button"
                onClick={() => setAddingTeam(true)}
                className="w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50 text-muted-foreground/40 hover:text-muted-foreground hover:border-border transition-all"
              >
                <Plus className="size-5" />
                <span className="text-xs font-medium">팀 추가</span>
              </button>
            )}
          </div>
        </div>

        {/* 드래그 오버레이 */}
        <DragOverlay>
          {activeAgent ? (
            <AgentCard
              agent={activeAgent}
              agentState={stateMap.get(activeAgent.id) ?? "idle"}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <AgentEditDialog open={createOpen} onOpenChange={setCreateOpen} agent={null} onSaved={onRefetch} teams={teams} />
      <AgentEditDialog open={!!editAgent} onOpenChange={(o) => !o && setEditAgent(null)} agent={editAgent} onSaved={onRefetch} teams={teams} />
      <ImportGlobalDialog open={importOpen} onOpenChange={setImportOpen} existingIds={new Set(agentList.map((a) => a.id))} onImported={onRefetch} />
    </div>
  );
}

// ━━━ 팀 컬럼 (드롭 영역) ━━━

function TeamColumn({
  teamKey,
  label,
  agents,
  stateMap,
  isNone,
  onEdit,
  onDelete,
  onDeleteTeam,
  onOpenTerminal,
}: {
  teamKey: string;
  label: string;
  agents: AgentFull[];
  stateMap: Map<string, string>;
  isNone: boolean;
  onEdit: (agent: AgentFull) => void;
  onDelete: (id: string) => void;
  onDeleteTeam?: () => void;
  onOpenTerminal?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: teamKey });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "shrink-0 w-[240px] flex flex-col rounded-xl border transition-colors",
        isOver ? "border-indigo-500/50 bg-indigo-500/5" : "border-border/50 bg-muted/20",
      )}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/30">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold truncate">{label}</span>
          <Badge variant="secondary" className="text-[9px] h-4 px-1">{agents.length}</Badge>
        </div>
        {onDeleteTeam && (
          <button
            type="button"
            onClick={onDeleteTeam}
            className="text-muted-foreground/40 hover:text-red-400 transition-colors"
            title="팀 삭제"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* 에이전트 목록 */}
      <div className="flex-1 p-2 space-y-2 min-h-[100px]">
        {agents.length === 0 && (
          <div className="flex items-center justify-center h-full text-[10px] text-muted-foreground/30">
            드래그하여 배치
          </div>
        )}
        {agents.map((agent) => (
          <DraggableAgent
            key={agent.id}
            agent={agent}
            agentState={stateMap.get(agent.id) ?? "idle"}
            onEdit={() => onEdit(agent)}
            onDelete={() => onDelete(agent.id)}
            onOpenTerminal={onOpenTerminal ? () => onOpenTerminal(agent.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ━━━ 드래그 가능한 에이전트 카드 ━━━

function DraggableAgent({
  agent,
  agentState,
  onEdit,
  onDelete,
  onOpenTerminal,
}: {
  agent: AgentFull;
  agentState: string;
  onEdit: () => void;
  onDelete: () => void;
  onOpenTerminal?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: agent.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn("transition-opacity", isDragging && "opacity-30")}
    >
      <AgentCard
        agent={agent}
        agentState={agentState}
        dragHandleProps={{ ...attributes, ...listeners }}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenTerminal={onOpenTerminal}
      />
    </div>
  );
}

// ━━━ 에이전트 카드 (공용: 목록 + 오버레이) ━━━

function AgentCard({
  agent,
  agentState,
  isDragOverlay,
  dragHandleProps,
  onEdit,
  onDelete,
  onOpenTerminal,
}: {
  agent: AgentFull;
  agentState: string;
  isDragOverlay?: boolean;
  dragHandleProps?: Record<string, unknown>;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenTerminal?: () => void;
}) {
  const c = stateColor(agentState);

  return (
    <Card className={cn(
      "overflow-hidden relative group",
      isDragOverlay && "shadow-lg ring-2 ring-indigo-500/30 rotate-2",
    )}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: agent.color || "#71717a" }}
      />
      <CardContent className="p-2.5 pl-4">
        <div className="flex items-start gap-2">
          {/* 드래그 핸들 */}
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors"
            {...dragHandleProps}
          >
            <GripVertical className="size-3.5" />
          </button>

          {/* 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-semibold truncate">{agent.name}</span>
              <Badge variant="outline" className={cn("text-[9px] shrink-0", c.text, c.bg)}>
                {agentState}
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
              {agent.description || "--"}
            </div>
          </div>
        </div>

        {/* 액션 버튼 — 호버 시 표시 */}
        {!isDragOverlay && (
          <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onOpenTerminal && (
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onOpenTerminal}>
                <Terminal className="size-3 text-muted-foreground" />
              </Button>
            )}
            {onEdit && (
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onEdit}>
                <Pencil className="size-3" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onDelete}>
                <Trash2 className="size-3 text-red-400" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ━━━ Agent Edit Dialog (기존 유지) ━━━

function AgentEditDialog({
  open, onOpenChange, agent, onSaved, teams,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agent: AgentFull | null;
  onSaved: () => Promise<void>;
  teams: Record<string, { label: string; description: string }>;
}) {
  const isEdit = !!agent;
  const [id, setId] = useState("");
  const [scope, setScope] = useState<"local" | "global" | "both">("local");
  const [color, setColor] = useState(COLORS[0]);
  const [team, setTeam] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  useEffect(() => {
    if (agent) {
      setId(agent.id);
      setScope(agent.is_global ? "global" : "local");
      setColor(agent.color || COLORS[0]);
      setTeam(agent.team ?? null);
      setContent(agent.content || "");
    } else {
      setId("");
      setScope("local");
      setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
      setTeam(null);
      setContent("");
    }
    setAiPrompt("");
  }, [agent, open]);

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) { toast.warning("역할을 설명하세요"); return; }
    setGenerating(true);
    const r = await api.agentsGenerate(aiPrompt.trim(), id || undefined);
    if (r.ok && r.content) { setContent(r.content as string); toast.success("생성 완료"); }
    else { toast.error("생성 실패", { description: r.error }); }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!id.trim()) { toast.warning("ID를 입력하세요"); return; }
    if (!content.trim()) { toast.warning("내용을 입력하세요"); return; }
    setSaving(true);
    const r = await api.agentsSave({ id: id.trim(), content: content.trim(), scope, color, team });
    if (r.ok) {
      toast.success(isEdit ? "수정됨" : "생성됨", { description: id.trim() });
      onOpenChange(false);
      await onSaved();
    } else { toast.error("저장 실패", { description: r.error }); }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[40vw] max-w-none max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? "에이전트 편집" : "새 에이전트"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-id">ID</Label>
              <Input id="agent-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="backend" disabled={isEdit} />
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={team ?? "__none__"} onValueChange={(v) => setTeam(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">소속 없음</SelectItem>
                  {Object.entries(teams).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "local" | "global" | "both")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-1 flex-wrap pt-1">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={cn("size-5 rounded-full transition-all border-2", color === c ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100")}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>AI Generate</Label>
            <div className="flex gap-2">
              <Input placeholder="역할을 설명하세요 (예: 'Frontend QA engineer')" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleGenerate()} />
              <Button variant="outline" onClick={handleGenerate} disabled={generating}>
                {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate
              </Button>
            </div>
          </div>
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="agent-content">Agent Markdown (.md)</Label>
            <Textarea id="agent-content" rows={14} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-[12px] min-h-[200px]" placeholder="# Role: Agent Name&#10;&#10;You are a ..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isEdit ? "저장" : "생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ━━━ Import Global Dialog (기존 유지) ━━━

function ImportGlobalDialog({
  open, onOpenChange, existingIds, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingIds: Set<string>;
  onImported: () => Promise<void>;
}) {
  const [globals, setGlobals] = useState<GlobalAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.agentsGlobal().then((r) => setGlobals(r.agents ?? [])).catch(() => setGlobals([])).finally(() => setLoading(false));
  }, [open]);

  const handleImport = async (id: string) => {
    setImporting(id);
    const r = await api.agentsImport(id);
    if (r.ok) { toast.success("Import 완료", { description: id }); await onImported(); onOpenChange(false); }
    else { toast.error("Import 실패", { description: r.error }); }
    setImporting(null);
  };

  const available = globals.filter((g) => !existingIds.has(g.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Import from Global Agents</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : available.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">가져올 글로벌 에이전트가 없습니다.</div>
        ) : (
          <ScrollArea className="h-[380px]">
            <div className="space-y-2 pr-3">
              {available.map((g) => (
                <div key={g.id} className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{g.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{g.category} · {g.description || "--"}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleImport(g.id)} disabled={importing === g.id}>
                    {importing === g.id ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} Import
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
