"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Brain, GitBranch, Play, Square, Loader2 } from "lucide-react";
import type { RunningResponse, WorkflowItem } from "@/lib/types";

interface Props {
  workflows: WorkflowItem[];
  running: RunningResponse | null;
  onRefetch: () => Promise<void>;
}

/**
 * Run 탭.
 * 두 카드:
 * 1) 멀티에이전트 모드: 태스크 입력 + 실행
 * 2) 워크플로우 모드: 워크플로우 선택 그리드 + 입력 + 실행
 * + 실행 상태 바 + 중지 버튼
 */
export function RunTab({ workflows, running, onRefetch }: Props) {
  const isRunning = running?.pid !== null && running?.pid !== undefined;

  return (
    <div className="space-y-6">
      {/* 실행 상태 바 */}
      {isRunning && (
        <RunningStatusBar running={running!} onRefetch={onRefetch} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 멀티에이전트 모드 */}
        <MultiAgentCard disabled={isRunning} onRefetch={onRefetch} />

        {/* 워크플로우 모드 */}
        <WorkflowCard
          workflows={workflows}
          disabled={isRunning}
          onRefetch={onRefetch}
        />
      </div>
    </div>
  );
}

/* ── Running Status Bar ── */

function RunningStatusBar({
  running,
  onRefetch,
}: {
  running: RunningResponse;
  onRefetch: () => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    const r = await api.stop();
    if (r.ok) {
      toast.success("Stopped", { description: "Task has been stopped" });
      await onRefetch();
    } else {
      toast.error("Stop failed", { description: r.error });
    }
    setStopping(false);
  };

  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Loader2 className="size-4 text-violet-400 animate-spin shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Running</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {running.mode ?? "multi"} · {running.task ?? "..."}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {running.started && (
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                since {running.started}
              </span>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}
              Stop
            </Button>
          </div>
        </div>
        <Progress value={100} className="mt-3 h-1 [&>div]:animate-pulse" />
      </CardContent>
    </Card>
  );
}

/* ── Multi-Agent Card ── */

function MultiAgentCard({
  disabled,
  onRefetch,
}: {
  disabled: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [task, setTask] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRun = async () => {
    if (!task.trim()) {
      toast.warning("Task is required");
      return;
    }
    setSubmitting(true);
    const r = await api.run(task.trim());
    if (r.ok) {
      toast.success("Task started", { description: task.trim() });
      setTask("");
      await onRefetch();
    } else {
      toast.error("Run failed", { description: r.error });
    }
    setSubmitting(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="size-4 text-violet-400" />
          Multi-Agent Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Describe a task. The orchestrator will distribute work across all
          active agents.
        </p>
        <Textarea
          placeholder="e.g., Build a user authentication system with JWT..."
          rows={4}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={disabled}
        />
        <Button
          onClick={handleRun}
          disabled={disabled || submitting || !task.trim()}
          className="w-full gap-2"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run Multi-Agent
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Workflow Card ── */

function WorkflowCard({
  workflows,
  disabled,
  onRefetch,
}: {
  workflows: WorkflowItem[];
  disabled: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRun = async () => {
    if (!selected) {
      toast.warning("Select a workflow first");
      return;
    }
    setSubmitting(true);
    const r = await api.workflow(selected, input.trim());
    if (r.ok) {
      toast.success("Workflow started", { description: selected });
      setInput("");
      await onRefetch();
    } else {
      toast.error("Workflow failed", { description: r.error });
    }
    setSubmitting(false);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="size-4 text-emerald-400" />
          Workflow Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Select a workflow template and provide input.
        </p>

        {/* 워크플로우 선택 그리드 */}
        {workflows.length === 0 ? (
          <div className="text-[11px] text-muted-foreground p-4 text-center border border-dashed border-border rounded-md">
            No workflow templates found
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
            {workflows.map((wf) => (
              <button
                key={wf.file}
                type="button"
                disabled={disabled}
                onClick={() => setSelected(wf.file === selected ? null : wf.file)}
                className={cn(
                  "text-left p-2.5 border rounded-md transition-colors",
                  selected === wf.file
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-border hover:border-emerald-500/50 hover:bg-muted/50",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">
                    {wf.title || wf.name}
                  </span>
                  {selected === wf.file && (
                    <Badge
                      variant="outline"
                      className="text-[9px] border-emerald-500/50 text-emerald-400"
                    >
                      selected
                    </Badge>
                  )}
                </div>
                {wf.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                    {wf.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}

        <Input
          placeholder="Input for workflow (optional)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled || !selected}
        />
        <Button
          onClick={handleRun}
          disabled={disabled || submitting || !selected}
          variant="outline"
          className="w-full gap-2"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run Workflow
        </Button>
      </CardContent>
    </Card>
  );
}
