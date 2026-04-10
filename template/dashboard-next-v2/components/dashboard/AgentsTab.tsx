"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Download,
  Sparkles,
  Loader2,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f59e0b", // amber
  "#f87171", // red
  "#60a5fa", // blue
  "#fb923c", // orange
  "#a3e635", // lime
  "#e879f9", // fuchsia
  "#2dd4bf", // teal
  "#fbbf24", // yellow
];

/**
 * Agents 탭 (v2 CRUD).
 * - 에이전트 목록 (color dot, name, description, state, 편집/삭제 버튼)
 * - "새 에이전트" 버튼 → Dialog
 * - "글로벌에서 가져오기" 버튼 → Dialog
 * - 편집 → 같은 Dialog (내용 로드)
 */
export function AgentsTab({ state, agents, onRefetch, onOpenTerminal }: Props) {
  const [editAgent, setEditAgent] = useState<AgentFull | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const agentList = agents?.agents ?? [];
  const stateMap = new Map(
    (state?.agents ?? []).map((a) => [a.id, a.state])
  );

  const handleDelete = async (id: string) => {
    const r = await api.agentsDelete(id);
    if (r.ok) {
      toast.success("Agent deleted", { description: id });
      await onRefetch();
    } else {
      toast.error("Delete failed", { description: r.error });
    }
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Agents</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Download className="size-3.5" />
            Import Global
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New Agent
          </Button>
        </div>
      </div>

      {/* 에이전트 목록 */}
      {agentList.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No agents. Add one or import from global agents.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {agentList.map((agent) => {
            const agentState = stateMap.get(agent.id) ?? "idle";
            const c = stateColor(agentState);
            return (
              <Card key={agent.id} className="overflow-hidden relative">
                <div
                  className="absolute left-0 top-0 bottom-0 w-[3px]"
                  style={{ backgroundColor: agent.color || "#71717a" }}
                />
                <CardContent className="p-3.5 pl-5">
                  <div className="flex items-center justify-between gap-3">
                    {/* 좌: 이름 + 설명 */}
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="size-3 rounded-full shrink-0"
                        style={{ backgroundColor: agent.color || "#71717a" }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {agent.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {agent.description || "--"}
                        </div>
                      </div>
                    </div>

                    {/* 우: 상태 + 버튼 */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-mono", c.text, c.bg)}
                      >
                        {agentState}
                      </Badge>
                      {agent.is_global && (
                        <Badge variant="secondary" className="text-[9px]">
                          global
                        </Badge>
                      )}
                      {onOpenTerminal && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenTerminal(agent.id)}
                          title={`Open ${agent.id} terminal`}
                        >
                          <Terminal className="size-3 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditAgent(agent)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(agent.id)}
                      >
                        <Trash2 className="size-3 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 새 에이전트 Dialog */}
      <AgentEditDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agent={null}
        onSaved={onRefetch}
      />

      {/* 편집 Dialog */}
      <AgentEditDialog
        open={!!editAgent}
        onOpenChange={(o) => !o && setEditAgent(null)}
        agent={editAgent}
        onSaved={onRefetch}
      />

      {/* 글로벌 가져오기 Dialog */}
      <ImportGlobalDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingIds={new Set(agentList.map((a) => a.id))}
        onImported={onRefetch}
      />
    </div>
  );
}

/* ── Agent Edit/Create Dialog ── */

function AgentEditDialog({
  open,
  onOpenChange,
  agent,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agent: AgentFull | null;
  onSaved: () => Promise<void>;
}) {
  const isEdit = !!agent;

  const [id, setId] = useState("");
  const [scope, setScope] = useState<"local" | "global" | "both">("local");
  const [color, setColor] = useState(COLORS[0]);
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  // agent가 바뀔 때 폼 초기화
  useEffect(() => {
    if (agent) {
      setId(agent.id);
      setScope(agent.is_global ? "global" : "local");
      setColor(agent.color || COLORS[0]);
      setContent(agent.content || "");
    } else {
      setId("");
      setScope("local");
      setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
      setContent("");
    }
    setAiPrompt("");
  }, [agent, open]);

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.warning("Describe the agent role");
      return;
    }
    setGenerating(true);
    const r = await api.agentsGenerate(aiPrompt.trim(), id || undefined);
    if (r.ok && r.content) {
      setContent(r.content as string);
      toast.success("Agent content generated");
    } else {
      toast.error("Generation failed", { description: r.error });
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!id.trim()) {
      toast.warning("Agent ID is required");
      return;
    }
    if (!content.trim()) {
      toast.warning("Agent content is required");
      return;
    }
    setSaving(true);
    const r = await api.agentsSave({
      id: id.trim(),
      content: content.trim(),
      scope,
      color,
    });
    if (r.ok) {
      toast.success(isEdit ? "Agent updated" : "Agent created", {
        description: id.trim(),
      });
      onOpenChange(false);
      await onSaved();
    } else {
      toast.error("Save failed", { description: r.error });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Agent" : "New Agent"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ID + Scope + Color */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="agent-id">ID</Label>
              <Input
                id="agent-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="backend"
                disabled={isEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) =>
                  setScope(v as "local" | "global" | "both")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-1.5 flex-wrap pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      "size-6 rounded-full transition-all border-2",
                      color === c
                        ? "border-white scale-110"
                        : "border-transparent opacity-60 hover:opacity-100"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* AI 생성 */}
          <div className="space-y-1.5">
            <Label>AI Generate</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Describe agent role (e.g., 'Frontend QA engineer')"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Generate
              </Button>
            </div>
          </div>

          {/* .md 에디터 */}
          <div className="space-y-1.5">
            <Label htmlFor="agent-content">Agent Markdown (.md)</Label>
            <Textarea
              id="agent-content"
              rows={12}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-[12px]"
              placeholder="# Role: Agent Name&#10;&#10;You are a ..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Import Global Dialog ── */

function ImportGlobalDialog({
  open,
  onOpenChange,
  existingIds,
  onImported,
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
    api
      .agentsGlobal()
      .then((r) => setGlobals(r.agents ?? []))
      .catch(() => setGlobals([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleImport = async (id: string) => {
    setImporting(id);
    const r = await api.agentsImport(id);
    if (r.ok) {
      toast.success("Imported", { description: id });
      await onImported();
      onOpenChange(false);
    } else {
      toast.error("Import failed", { description: r.error });
    }
    setImporting(null);
  };

  const available = globals.filter((g) => !existingIds.has(g.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Global Agents</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : available.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No available global agents to import.
          </div>
        ) : (
          <ScrollArea className="h-[380px]">
            <div className="space-y-2 pr-3">
              {available.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{g.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {g.category} · {g.description || "--"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleImport(g.id)}
                    disabled={importing === g.id}
                  >
                    {importing === g.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    Import
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
