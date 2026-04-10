"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { parseWorkflowYaml, serializeWorkflowYaml } from "@/lib/workflow-yaml";
import { WorkflowList } from "./WorkflowList";
import { WorkflowEditor } from "./WorkflowEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Square, Loader2 } from "lucide-react";
import type {
  WorkflowItem,
  WorkflowDefinition,
  RunningResponse,
} from "@/lib/types";

interface Props {
  workflows: WorkflowItem[];
  running: RunningResponse | null;
  onRefetch: () => Promise<void>;
}

export function WorkflowsTab({ workflows, running, onRefetch }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Load workflow YAML ──
  const loadWorkflow = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const res = await api.workflowContent(name);
      if (res.ok && res.content) {
        const def = parseWorkflowYaml(res.content);
        setDefinition(def);
        setSelectedName(name);
        setIsDirty(false);
        setIsNew(false);
      } else {
        toast.error("워크플로우를 불러올 수 없습니다");
      }
    } catch {
      toast.error("워크플로우 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Create new (blank) ──
  const handleCreate = useCallback(() => {
    const def: WorkflowDefinition = {
      name: "새 워크플로우",
      description: "",
      steps: [],
    };
    setDefinition(def);
    setSelectedName(null);
    setIsDirty(true);
    setIsNew(true);
  }, []);

  // ── Create via AI ──
  const handleGenerate = useCallback(async (description: string) => {
    setLoading(true);
    try {
      const res = await api.workflowsGenerate(description);
      if (res.ok && typeof res.content === "string") {
        const def = parseWorkflowYaml(res.content);
        setDefinition(def);
        setSelectedName(null);
        setIsDirty(true);
        setIsNew(true);
        toast.success("워크플로우 생성 완료");
      } else {
        toast.error(res.error ?? "AI 생성 실패");
      }
    } catch {
      toast.error("AI 생성 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Select existing ──
  const handleSelect = useCallback(
    (name: string) => {
      if (isDirty && !confirm("저장하지 않은 변경사항이 있습니다. 계속할까요?")) return;
      loadWorkflow(name);
    },
    [isDirty, loadWorkflow]
  );

  // ── Edit ──
  const handleChange = useCallback((def: WorkflowDefinition) => {
    setDefinition(def);
    setIsDirty(true);
  }, []);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!definition) return;
    // derive file name from definition name
    const derived = definition.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = selectedName ?? (derived || "untitled");

    const yaml = serializeWorkflowYaml(definition);
    try {
      const res = await api.workflowsSave(fileName, yaml);
      if (res.ok) {
        toast.success("워크플로우 저장됨");
        setSelectedName(fileName);
        setIsDirty(false);
        setIsNew(false);
        await onRefetch();
      } else {
        toast.error(res.error ?? "저장 실패");
      }
    } catch {
      toast.error("저장 실패");
    }
  }, [definition, selectedName, onRefetch]);

  // ── Delete ──
  const handleDelete = useCallback(async () => {
    if (!selectedName) return;
    if (!confirm(`"${selectedName}" 워크플로우를 삭제하시겠습니까?`)) return;
    try {
      const res = await api.workflowsDelete(selectedName);
      if (res.ok) {
        toast.success("워크플로우 삭제됨");
        setDefinition(null);
        setSelectedName(null);
        setIsDirty(false);
        await onRefetch();
      } else {
        toast.error(res.error ?? "삭제 실패");
      }
    } catch {
      toast.error("삭제 실패");
    }
  }, [selectedName, onRefetch]);

  // ── Run ──
  const handleRun = useCallback(async () => {
    const name = selectedName;
    if (!name) {
      toast.error("먼저 워크플로우를 저장하세요");
      return;
    }
    const input = prompt("워크플로우에 전달할 입력을 입력하세요:") ?? "";
    try {
      const res = await api.workflow(name, input);
      if (res.ok) {
        toast.success("워크플로우 실행 시작");
        await onRefetch();
      } else {
        toast.error(res.error ?? "실행 실패");
      }
    } catch {
      toast.error("실행 실패");
    }
  }, [selectedName, onRefetch]);

  // ── Quick run (multi-agent) ──
  const handleRunTask = useCallback(
    async (task: string) => {
      try {
        const res = await api.run(task);
        if (res.ok) {
          toast.success("멀티에이전트 실행 시작");
          await onRefetch();
        } else {
          toast.error(res.error ?? "실행 실패");
        }
      } catch {
        toast.error("실행 실패");
      }
    },
    [onRefetch]
  );

  // ── Stop ──
  const handleStop = useCallback(async () => {
    try {
      await api.stop();
      toast.success("중지 요청됨");
      await onRefetch();
    } catch {
      toast.error("중지 실패");
    }
  }, [onRefetch]);

  const isRunning = running?.pid != null;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Running status bar */}
      {isRunning && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-vc-indigo/30 bg-vc-indigo-muted">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin text-vc-indigo" />
            <span className="font-medium text-vc-indigo">실행중</span>
            <span className="text-muted-foreground font-mono text-xs truncate max-w-[300px]">
              {running?.task}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {running?.started && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {running.started}
              </Badge>
            )}
            <Button variant="destructive" size="xs" onClick={handleStop}>
              <Square className="size-3 mr-1" />
              중지
            </Button>
          </div>
        </div>
      )}

      {/* Main split layout */}
      <div className="grid grid-cols-[280px_1fr] gap-4 flex-1 min-h-0">
        <WorkflowList
          workflows={workflows}
          selectedName={selectedName}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onGenerate={handleGenerate}
          running={running}
          onRunTask={handleRunTask}
        />

        {loading ? (
          <div className="flex items-center justify-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            로딩중...
          </div>
        ) : (
          <WorkflowEditor
            definition={definition}
            onChange={handleChange}
            onSave={handleSave}
            onDelete={handleDelete}
            onRun={handleRun}
            isDirty={isDirty}
            isNew={isNew}
          />
        )}
      </div>
    </div>
  );
}
