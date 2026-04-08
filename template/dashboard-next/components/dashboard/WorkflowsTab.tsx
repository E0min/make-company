"use client";

import { useState } from "react";
import { Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { WorkflowsResponse } from "@/lib/types";

interface Props {
  data: WorkflowsResponse | null;
  onRefetch: () => void;
}

interface BuilderNode {
  id: string;
  agent: string;
  prompt: string;
  depends_on: string;
}

export function WorkflowsTab({ data, onRefetch }: Props) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [runOpen, setRunOpen] = useState<{ file: string; title: string } | null>(
    null
  );
  const [runText, setRunText] = useState("");

  const [wfId, setWfId] = useState("");
  const [wfTitle, setWfTitle] = useState("");
  const [nodes, setNodes] = useState<BuilderNode[]>([
    { id: "n1", agent: "pm", prompt: "", depends_on: "" },
  ]);

  const addNode = () =>
    setNodes((s) => [
      ...s,
      { id: `n${s.length + 1}`, agent: "", prompt: "", depends_on: "" },
    ]);

  const updateNode = (i: number, patch: Partial<BuilderNode>) =>
    setNodes((s) => s.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));

  const removeNode = (i: number) =>
    setNodes((s) => s.filter((_, idx) => idx !== i));

  const resetBuilder = () => {
    setWfId("");
    setWfTitle("");
    setNodes([{ id: "n1", agent: "pm", prompt: "", depends_on: "" }]);
  };

  const saveWorkflow = async () => {
    if (!wfId.trim() || !wfTitle.trim()) {
      toast.error("ID와 제목 필수");
      return;
    }
    const workflow = {
      workflow_id: wfId.trim(),
      title: wfTitle.trim(),
      nodes: nodes.map((n) => ({
        id: n.id,
        agent: n.agent,
        prompt: n.prompt,
        depends_on: n.depends_on
          ? n.depends_on.split(",").map((x) => x.trim()).filter(Boolean)
          : [],
      })),
    };
    const res = await api.createWorkflow(workflow);
    if (res.ok) {
      toast.success("워크플로 저장됨", { description: wfId });
      setBuilderOpen(false);
      resetBuilder();
      onRefetch();
    } else {
      toast.error("저장 실패", { description: res.error });
    }
  };

  const runWorkflow = async () => {
    if (!runOpen) return;
    const res = await api.runWorkflow(runOpen.file, runText);
    if (res.ok) {
      toast.success("워크플로 실행", { description: runOpen.title });
      setRunOpen(null);
      setRunText("");
      onRefetch();
    } else {
      toast.error("실행 실패");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-3">Active Workflows</h2>
        {data?.active?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {data.active.map((wf) => (
              <Card key={wf.workflow_id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{wf.title ?? wf.workflow_id}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {wf.status ?? "running"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-xs space-y-1.5">
                  {wf.nodes?.map((n) => (
                    <div key={n.id} className="flex items-center gap-2 font-mono">
                      <Badge
                        variant="outline"
                        className="text-[10px] w-16 justify-center"
                      >
                        {n.status ?? "pending"}
                      </Badge>
                      <span className="text-violet-400">{n.agent}</span>
                      <span className="text-muted-foreground truncate">
                        {n.prompt}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active workflows.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Templates</h2>
          <Button
            size="sm"
            onClick={() => {
              resetBuilder();
              setBuilderOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            New Workflow
          </Button>
        </div>
        {data?.templates?.length ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.templates.map((t) => (
              <Card key={t.file}>
                <CardContent className="p-4 space-y-2">
                  <div className="text-sm font-semibold">{t.title}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {t.id}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRunText("");
                        setRunOpen({ file: t.file, title: t.title });
                      }}
                    >
                      <Play className="size-3" />
                      Run
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const r = await api.deleteWorkflow(t.file);
                        if (r.ok) {
                          toast.success("삭제됨");
                          onRefetch();
                        }
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No templates.</p>
        )}
      </div>

      {/* Builder Dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workflow Builder</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wf-id">ID</Label>
              <Input
                id="wf-id"
                value={wfId}
                onChange={(e) => setWfId(e.target.value)}
                placeholder="feature-mobile"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-title">Title</Label>
              <Input
                id="wf-title"
                value={wfTitle}
                onChange={(e) => setWfTitle(e.target.value)}
                placeholder="Add mobile feature"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Nodes</Label>
              <Button size="sm" variant="outline" onClick={addNode}>
                <Plus className="size-3" /> Node
              </Button>
            </div>
            <ScrollArea className="h-64 border border-border rounded-md">
              <div className="p-3 space-y-2">
                {nodes.map((n, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-2 items-start border border-border rounded-md p-2"
                  >
                    <Input
                      className="col-span-2"
                      value={n.id}
                      onChange={(e) => updateNode(i, { id: e.target.value })}
                      placeholder="n1"
                    />
                    <Input
                      className="col-span-2"
                      value={n.agent}
                      onChange={(e) => updateNode(i, { agent: e.target.value })}
                      placeholder="agent"
                    />
                    <Input
                      className="col-span-5"
                      value={n.prompt}
                      onChange={(e) =>
                        updateNode(i, { prompt: e.target.value })
                      }
                      placeholder="prompt"
                    />
                    <Input
                      className="col-span-2"
                      value={n.depends_on}
                      onChange={(e) =>
                        updateNode(i, { depends_on: e.target.value })
                      }
                      placeholder="n1,n2"
                    />
                    <Button
                      className="col-span-1"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeNode(i)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveWorkflow}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Dialog */}
      <Dialog open={!!runOpen} onOpenChange={(o) => !o && setRunOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run · {runOpen?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="run-text">User Request</Label>
            <Input
              id="run-text"
              value={runText}
              onChange={(e) => setRunText(e.target.value)}
              placeholder="describe the task"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(null)}>
              Cancel
            </Button>
            <Button onClick={runWorkflow}>Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
