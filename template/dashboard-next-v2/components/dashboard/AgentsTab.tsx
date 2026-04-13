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
  Search,
  AlertTriangle,
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
  InstalledSkill,
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "agent" | "team"; id: string; label: string } | null>(null);

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

  const handleDelete = (id: string) => {
    setDeleteConfirm({ type: "agent", id, label: id });
  };

  const executeDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "agent") {
      const r = await api.agentsDelete(deleteConfirm.id);
      if (r.ok) {
        toast.success("삭제됨", { description: deleteConfirm.id });
        await onRefetch();
      } else {
        toast.error("삭제 실패", { description: r.error });
      }
    } else {
      const r = await api.teamsDelete(deleteConfirm.id);
      if (r.ok) {
        toast.success("팀 삭제됨", { description: deleteConfirm.id });
        await onRefetch();
      } else {
        toast.error("팀 삭제 실패", { description: r.error });
      }
    }
    setDeleteConfirm(null);
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

  const handleDeleteTeam = (teamId: string) => {
    setDeleteConfirm({ type: "team", id: teamId, label: teams[teamId]?.label ?? teamId });
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

      {/* 삭제 확인 배너 */}
      {deleteConfirm && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5">
          <span className="text-xs text-foreground">
            {deleteConfirm.type === "agent"
              ? `에이전트 '${deleteConfirm.label}'를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
              : `팀 '${deleteConfirm.label}'를 삭제하시겠습니까? 소속 에이전트는 미소속으로 변경됩니다.`}
          </span>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDeleteConfirm(null)}>
              취소
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={executeDelete}>
              삭제
            </Button>
          </div>
        </div>
      )}

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
                className="w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-2 rounded-xl border border-border/40 bg-muted/5 text-muted-foreground/40 hover:text-muted-foreground hover:border-border transition-all"
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
          <Badge variant="secondary" className="text-xs h-4 px-1">{agents.length}</Badge>
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
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/30">
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
      isDragOverlay && "ring-2 ring-indigo-500/30 rotate-2",
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
              <Badge variant="outline" className={cn("text-xs shrink-0", c.text, c.bg)}>
                {agentState}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {agent.description || "--"}
            </div>
          </div>
        </div>

        {/* 액션 버튼 — 호버 시 표시 */}
        {!isDragOverlay && (
          <div className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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

// ━━━ Agent Edit Dialog (스킬 할당 섹션 추가) ━━━

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
  const [previewMode, setPreviewMode] = useState(false);

  // ── 스킬 할당 상태 ──
  const [assignedSkills, setAssignedSkills] = useState<string[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [skillEnforcement, setSkillEnforcement] = useState<string>("advisory");
  const [stepSkillsMap, setStepSkillsMap] = useState<Record<string, Record<string, string[]>>>({});
  const [removalWarning, setRemovalWarning] = useState<string | null>(null);

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
      setContent(`---
name:
description:
category: engineering
default_label:
default_skills: []
---

# Role:

당신은 Virtual Company의 에이전트입니다.

## 프로젝트 컨텍스트
{{project_context}}

## 누적 기억
{{agent_memory}}

---

## 핵심 원칙

1.

## 작업 방식

1.
`);
    }
    setAiPrompt("");
    setPreviewMode(false);
    setAssignedSkills([]);
    setInstalledSkills([]);
    setSkillSearch("");
    setRemovalWarning(null);
  }, [agent, open]);

  // 다이얼로그 열릴 때 스킬 데이터 로드
  useEffect(() => {
    if (!open) return;
    setSkillsLoading(true);

    const promises: Promise<unknown>[] = [api.skillsInstalled()];
    if (isEdit && agent) {
      promises.push(api.agentSkills(agent.id));
    }
    promises.push(api.harnessSummary());

    Promise.all(promises)
      .then((results) => {
        const skillsRes = results[0] as { skills: InstalledSkill[] };
        setInstalledSkills(skillsRes.skills ?? []);

        if (isEdit && results.length >= 2) {
          const agentSkillsRes = results[1] as { skills: string[] };
          setAssignedSkills(agentSkillsRes.skills ?? []);
        }

        // harness summary for enforcement + step_skills
        const harnessIdx = isEdit ? 2 : 1;
        if (results[harnessIdx]) {
          const harness = results[harnessIdx] as {
            workflow?: { skill_enforcement?: string; step_skills?: Record<string, Record<string, string[]>> };
          };
          setSkillEnforcement(harness.workflow?.skill_enforcement ?? "advisory");
          setStepSkillsMap(harness.workflow?.step_skills ?? {});
        }
      })
      .catch(() => {
        setInstalledSkills([]);
        setAssignedSkills([]);
      })
      .finally(() => setSkillsLoading(false));
  }, [open, agent, isEdit]);

  // 스킬 필터링: 할당되지 않은 스킬 중 검색어 매칭
  const assignedSet = new Set(assignedSkills);
  const availableSkills = installedSkills.filter(
    (s) => !assignedSet.has(s.name) && (!skillSearch || s.name.toLowerCase().includes(skillSearch.toLowerCase()))
  );

  // strict 모드에서 step_skills 필수 스킬 확인
  const getRequiredSkills = (): string[] => {
    const required = new Set<string>();
    for (const workflow of Object.values(stepSkillsMap)) {
      for (const skills of Object.values(workflow)) {
        for (const sk of skills) {
          required.add(sk);
        }
      }
    }
    return Array.from(required);
  };

  const addSkill = (name: string) => {
    setAssignedSkills((prev) => [...prev, name]);
    setRemovalWarning(null);
  };

  const removeSkill = (name: string) => {
    if (skillEnforcement === "strict") {
      const requiredSkills = getRequiredSkills();
      if (requiredSkills.includes(name)) {
        setRemovalWarning(`"${name}" 스킬은 step_skills에서 필수로 지정되어 있습니다. 제거 시 워크플로우가 실패할 수 있습니다.`);
      }
    }
    setAssignedSkills((prev) => prev.filter((s) => s !== name));
  };

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
    // 필수 플레이스홀더 검증
    const missing: string[] = [];
    if (!content.includes("{{project_context}}")) missing.push("{{project_context}}");
    if (!content.includes("{{agent_memory}}")) missing.push("{{agent_memory}}");
    if (missing.length > 0) {
      toast.warning("필수 플레이스홀더 누락", {
        description: `${missing.join(", ")}이(가) 없으면 프로젝트 컨텍스트와 학습 기억이 주입되지 않습니다.`,
        duration: 5000,
      });
    }
    setSaving(true);

    // 에이전트 저장
    const r = await api.agentsSave({ id: id.trim(), content: content.trim(), scope, color, team });
    if (!r.ok) {
      toast.error("저장 실패", { description: r.error });
      setSaving(false);
      return;
    }

    // 스킬 할당 저장 (편집 모드에서만, 또는 신규 생성 시에도 할당된 스킬이 있으면)
    if (assignedSkills.length > 0 || isEdit) {
      const sr = await api.agentSkillsUpdate(id.trim(), assignedSkills);
      if (!sr.ok) {
        toast.error("스킬 할당 실패", { description: sr.error });
        // 에이전트 자체는 저장됐으므로 다이얼로그는 닫음
      }
    }

    toast.success(isEdit ? "수정됨" : "생성됨", { description: id.trim() });
    onOpenChange(false);
    await onSaved();
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

          {/* ── 스킬 할당 섹션 ── */}
          <div className="space-y-3 rounded-lg border border-border/50 bg-muted/10 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">할당된 스킬</Label>
              <span className="text-[10px] text-muted-foreground font-mono">{assignedSkills.length} 스킬 할당됨</span>
            </div>

            {/* removal warning for strict mode */}
            {removalWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[10px] text-amber-300">{removalWarning}</span>
                <button type="button" onClick={() => setRemovalWarning(null)} className="ml-auto shrink-0">
                  <X className="size-3 text-muted-foreground" />
                </button>
              </div>
            )}

            {/* 할당된 스킬 칩 */}
            {skillsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="size-3 animate-spin" />
                스킬 로딩 중...
              </div>
            ) : assignedSkills.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/50 py-1">할당된 스킬이 없습니다.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {assignedSkills.map((sk) => (
                  <span
                    key={sk}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600/15 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
                  >
                    {sk}
                    <button
                      type="button"
                      onClick={() => removeSkill(sk)}
                      className="hover:text-red-400 transition-colors"
                      aria-label={`${sk} 스킬 제거`}
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 사용 가능한 스킬 */}
            {!skillsLoading && installedSkills.length > 0 && (
              <>
                <div className="border-t border-border/30 pt-3 mt-2">
                  <Label className="text-xs font-semibold text-muted-foreground">사용 가능한 스킬</Label>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                  <Input
                    placeholder="스킬 검색..."
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    className="pl-7 h-7 text-xs"
                  />
                </div>
                {availableSkills.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground/40 py-1">
                    {skillSearch ? "검색 결과 없음" : "모든 스킬이 할당되었습니다."}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                    {availableSkills.map((sk) => (
                      <button
                        key={sk.name}
                        type="button"
                        onClick={() => addSkill(sk.name)}
                        className="inline-flex items-center rounded-md bg-zinc-900/50 border border-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors cursor-pointer"
                        title={sk.description}
                      >
                        {sk.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
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
            <div className="flex items-center justify-between">
              <Label htmlFor="agent-content">Agent Markdown (.md)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setPreviewMode((p) => !p)}
              >
                {previewMode ? "편집" : "미리보기"}
              </Button>
            </div>
            {previewMode ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 min-h-[200px] max-h-[340px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed text-foreground">{content || "(비어 있음)"}</pre>
              </div>
            ) : (
              <Textarea id="agent-content" rows={14} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-xs min-h-[200px]" placeholder="# Role: Agent Name&#10;&#10;You are a ..." />
            )}
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
                    <div className="text-xs text-muted-foreground truncate">{g.category} · {g.description || "--"}</div>
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
