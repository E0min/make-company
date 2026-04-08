"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Wrench, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { parseDefaultSkills, stateColor } from "@/lib/format";
import type {
  Agent,
  LibraryItem,
  LibraryResponse,
  SkillItem,
  StateResponse,
} from "@/lib/types";

interface Props {
  state: StateResponse | null;
  onRefetch: () => void;
}

export function AgentsTab({ state, onRefetch }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [skillsFor, setSkillsFor] = useState<Agent | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const agents = state?.agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Agents</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPresetOpen(true)}>
            <Save className="size-3.5" /> Save as Preset
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Add Agent
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No agents. Add one from the library.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              onEditSkills={() => setSkillsFor(a)}
              onDelete={async () => {
                const r = await api.deleteAgent(a.id);
                if (r.ok) {
                  toast.success("삭제됨", { description: a.id });
                  onRefetch();
                } else toast.error("삭제 실패");
              }}
            />
          ))}
        </div>
      )}

      <AddAgentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existing={agents}
        onAdded={onRefetch}
      />
      <SkillsDialog
        agent={skillsFor}
        onClose={() => setSkillsFor(null)}
        onSaved={onRefetch}
      />
      <ExportPresetDialog open={presetOpen} onOpenChange={setPresetOpen} />
    </div>
  );
}

function AgentCard({
  agent,
  onEditSkills,
  onDelete,
}: {
  agent: Agent;
  onEditSkills: () => void;
  onDelete: () => void;
}) {
  const c = stateColor(agent.state);
  return (
    <Card className="overflow-hidden relative">
      <div className={cn("absolute left-0 top-0 bottom-0 w-[3px]", c.bar)} />
      <CardContent className="p-4 pl-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">{agent.label}</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {agent.id} · {agent.engine}
              {agent.protected ? " · protected" : ""}
            </div>
          </div>
          <Badge variant="outline" className={cn("text-[10px]", c.text, c.bg)}>
            {agent.state}
          </Badge>
        </div>
        {agent.assigned_skills?.length ? (
          <div className="flex flex-wrap gap-1">
            {agent.assigned_skills.slice(0, 4).map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="text-[9px] font-mono"
              >
                {s}
              </Badge>
            ))}
            {agent.assigned_skills.length > 4 ? (
              <Badge variant="secondary" className="text-[9px]">
                +{agent.assigned_skills.length - 4}
              </Badge>
            ) : null}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">no skills</p>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onEditSkills}>
            <Wrench className="size-3" /> Skills
          </Button>
          {!agent.protected && (
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AddAgentDialog({
  open,
  onOpenChange,
  existing,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: Agent[];
  onAdded: () => void;
}) {
  const [lib, setLib] = useState<LibraryResponse | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // custom mode state
  const [cId, setCId] = useState("");
  const [cLabel, setCLabel] = useState("");
  const [cEngine, setCEngine] = useState<"claude" | "gemini">("claude");
  const [cDesc, setCDesc] = useState("");
  const [cBody, setCBody] = useState("");
  const [cSkills, setCSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    api.library().then(setLib).catch(() => setLib({ library: [], categories: [] }));
    api.skills().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
    setSelectedPath(null);
  }, [open]);

  const activeFiles = useMemo(
    () => new Set(existing.map((a) => a.agent_file)),
    [existing]
  );

  const groups = useMemo(() => {
    const items = (lib?.library ?? []).filter(
      (it) => category === "all" || it.category === category
    );
    const g: Record<string, LibraryItem[]> = {};
    for (const it of items) {
      (g[it.category] = g[it.category] ?? []).push(it);
    }
    return g;
  }, [lib, category]);

  const addFromLibrary = async () => {
    if (!selectedPath) {
      toast.warning("에이전트를 선택하세요");
      return;
    }
    const r = await api.addAgentFromLibrary(selectedPath);
    if (r.ok) {
      toast.success("에이전트 추가됨", { description: selectedPath });
      onOpenChange(false);
      onAdded();
    } else {
      toast.error("추가 실패", { description: r.error });
    }
  };

  const createCustom = async () => {
    if (!cId.trim() || !cLabel.trim()) {
      toast.warning("id, label 필수");
      return;
    }
    const r = await api.createAgent({
      id: cId.trim(),
      label: cLabel.trim(),
      engine: cEngine,
      agent_file: cId.trim(),
      description: cDesc.trim(),
      role_body: cBody.trim(),
      skills: Array.from(cSkills),
    });
    if (r.ok) {
      toast.success("에이전트 생성됨");
      onOpenChange(false);
      onAdded();
    } else {
      toast.error("생성 실패");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">From Library</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "all")}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(lib?.categories ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-[420px] border border-border rounded-md p-3">
              <div className="space-y-5">
                {Object.keys(groups)
                  .sort()
                  .map((cat) => (
                    <div key={cat} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                          {cat}
                        </span>
                        <Badge variant="outline" className="text-[9px]">
                          {groups[cat].length}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {groups[cat].map((it) => {
                          const isActive = activeFiles.has(
                            it.library_path.split("/").pop() ?? ""
                          );
                          const skills = parseDefaultSkills(it.default_skills);
                          const isSelected = selectedPath === it.library_path;
                          return (
                            <button
                              key={it.library_path}
                              type="button"
                              disabled={isActive}
                              onClick={() =>
                                !isActive && setSelectedPath(it.library_path)
                              }
                              className={cn(
                                "text-left p-3 border rounded-md transition-colors",
                                isActive
                                  ? "opacity-40 cursor-not-allowed border-border"
                                  : isSelected
                                    ? "border-violet-500 bg-violet-500/10"
                                    : "border-border hover:border-violet-500/50 hover:bg-muted/50"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="text-xs font-semibold">
                                  {it.name}
                                </div>
                                {isActive && (
                                  <span className="text-[9px] uppercase text-emerald-400">
                                    active
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground line-clamp-2">
                                {it.description || "—"}
                              </div>
                              {skills.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {skills.slice(0, 4).map((s) => (
                                    <span
                                      key={s}
                                      className="text-[9px] font-mono bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5"
                                    >
                                      {s}
                                    </span>
                                  ))}
                                  {skills.length > 4 && (
                                    <span className="text-[9px] italic text-muted-foreground">
                                      +{skills.length - 4}
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={addFromLibrary} disabled={!selectedPath}>
                Add
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="custom" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cid">ID</Label>
                <Input
                  id="cid"
                  value={cId}
                  onChange={(e) => setCId(e.target.value)}
                  placeholder="tester"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clabel">Label</Label>
                <Input
                  id="clabel"
                  value={cLabel}
                  onChange={(e) => setCLabel(e.target.value)}
                  placeholder="Tester"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Engine</Label>
                <Select
                  value={cEngine}
                  onValueChange={(v) => v && setCEngine(v as "claude" | "gemini")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cdesc">Description</Label>
                <Input
                  id="cdesc"
                  value={cDesc}
                  onChange={(e) => setCDesc(e.target.value)}
                  placeholder="QA automation"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cbody">Role body (Markdown)</Label>
              <Textarea
                id="cbody"
                rows={5}
                value={cBody}
                onChange={(e) => setCBody(e.target.value)}
                placeholder="- Write unit tests..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Skills (optional)</Label>
              <ScrollArea className="h-32 border border-border rounded-md p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {skills.map((s) => (
                    <label
                      key={s.name}
                      className="flex items-center gap-2 text-xs font-mono"
                    >
                      <Checkbox
                        checked={cSkills.has(s.name)}
                        onCheckedChange={(v) => {
                          setCSkills((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(s.name);
                            else next.delete(s.name);
                            return next;
                          });
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={createCustom}>Create</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SkillsDialog({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!agent) return;
    api.skills().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
    setSelected(new Set(agent.assigned_skills ?? []));
  }, [agent]);

  const save = async () => {
    if (!agent) return;
    const r = await api.setAgentSkills(agent.id, Array.from(selected));
    if (r.ok) {
      toast.success("스킬 저장됨", { description: agent.id });
      onClose();
      onSaved();
    } else {
      toast.error("저장 실패");
    }
  };

  return (
    <Dialog open={!!agent} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skills · {agent?.label}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-72 border border-border rounded-md p-3">
          <div className="space-y-1.5">
            {skills.map((s) => (
              <label
                key={s.name}
                className="flex items-start gap-2 text-xs font-mono"
              >
                <Checkbox
                  checked={selected.has(s.name)}
                  onCheckedChange={(v) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(s.name);
                      else next.delete(s.name);
                      return next;
                    })
                  }
                />
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground font-sans">
                    {s.desc}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportPresetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [icon, setIcon] = useState("🏢");

  const save = async () => {
    if (!id.trim() || !name.trim()) {
      toast.warning("ID와 이름 필수");
      return;
    }
    const r = await api.exportPreset({ id, name, description: desc, icon });
    if (r.ok) {
      const result = r.result as { file?: string } | undefined;
      toast.success("프리셋 저장됨", { description: result?.file });
      onOpenChange(false);
      setId("");
      setName("");
      setDesc("");
    } else {
      toast.error("저장 실패");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Current as Preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pid">Preset ID</Label>
            <Input
              id="pid"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-team"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pname">Name</Label>
            <Input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdesc">Description</Label>
            <Input
              id="pdesc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Standard team setup"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="picon">Icon</Label>
            <Input
              id="picon"
              value={icon}
              maxLength={2}
              onChange={(e) => setIcon(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
