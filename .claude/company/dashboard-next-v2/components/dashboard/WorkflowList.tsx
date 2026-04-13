"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Play, Loader2, Zap, Sparkles, FileText } from "lucide-react";
import type { WorkflowItem, RunningResponse } from "@/lib/types";

// ━━━ Props ━━━

interface Props {
  workflows: WorkflowItem[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onGenerate: (description: string) => Promise<void>;
  running: RunningResponse | null;
  onRunTask: (task: string) => void;
}

// ━━━ Component ━━━

/**
 * 워크플로우 목록 (좌측 패널).
 * - 워크플로우 리스트 (ScrollArea)
 * - New Workflow 버튼
 * - Quick Run (태스크 입력 + 실행)
 * - 실행 상태 뱃지 표시
 */
export function WorkflowList({
  workflows,
  selectedName,
  onSelect,
  onCreate,
  onGenerate,
  running,
  onRunTask,
}: Props) {
  const [task, setTask] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createMode, setCreateMode] = useState<null | "template" | "ai">(null);
  const [aiDesc, setAiDesc] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const isRunning = running?.pid !== null && running?.pid !== undefined;

  /** Quick Run 핸들러 */
  const handleQuickRun = async () => {
    const trimmed = task.trim();
    if (!trimmed) {
      toast.warning("Task is required");
      return;
    }

    setSubmitting(true);
    try {
      const r = await api.run(trimmed);
      if (r.ok) {
        toast.success("Task started", { description: trimmed });
        setTask("");
        onRunTask(trimmed);
      } else {
        toast.error("Run failed", { description: r.error });
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Enter 키로 Quick Run 실행 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !submitting && !isRunning) {
      handleQuickRun();
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">Workflows</h3>
        {isRunning && (
          <Badge variant="default" className="text-[9px] gap-1">
            <Loader2 className="size-2.5 animate-spin" />
            running
          </Badge>
        )}
      </div>

      <Separator />

      {/* ── 워크플로우 리스트 ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 pr-2">
          {workflows.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-6">
              No workflows yet
            </div>
          ) : (
            workflows.map((wf) => {
              const isSelected = wf.name === selectedName;
              return (
                <button
                  key={wf.name}
                  type="button"
                  onClick={() => onSelect(wf.name)}
                  className={cn(
                    "text-left w-full rounded-md px-2.5 py-2 transition-colors",
                    /* 선택 상태 */
                    isSelected
                      ? "bg-primary/5 border border-primary/40"
                      : "border border-transparent hover:bg-muted/50 hover:border-border"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* 선택 인디케이터 */}
                    <span
                      className={cn(
                        "size-1.5 rounded-full shrink-0",
                        isSelected ? "bg-primary" : "bg-transparent"
                      )}
                    />
                    <span className="text-xs font-semibold truncate">
                      {wf.title || wf.name}
                    </span>
                  </div>
                  {wf.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 ml-3.5 line-clamp-1">
                      {wf.description}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* ── New Workflow 영역 ── */}
      {createMode === null ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreateMode("ai")}
          className="w-full gap-1.5"
        >
          <Plus className="size-3.5" />
          New Workflow
        </Button>
      ) : (
        <div className="flex flex-col gap-2 p-2.5 rounded-lg border border-border bg-card">
          {/* 모드 선택 탭 */}
          <div className="flex gap-1">
            <button
              onClick={() => setCreateMode("ai")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                createMode === "ai"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Sparkles className="size-3" />
              AI 생성
            </button>
            <button
              onClick={() => { setCreateMode("template"); onCreate(); setCreateMode(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                createMode === "template"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <FileText className="size-3" />
              빈 템플릿
            </button>
          </div>

          {/* AI 생성 모드 */}
          {createMode === "ai" && (
            <>
              <Textarea
                value={aiDesc}
                onChange={(e) => setAiDesc(e.target.value)}
                placeholder={"워크플로우를 설명하세요\n예: PM이 기획하고 디자이너가 디자인하고 프론트가 구현하는 흐름"}
                rows={3}
                className="text-xs resize-none"
                disabled={aiGenerating}
              />
              <div className="flex gap-1.5">
                <Button
                  variant="default"
                  size="xs"
                  className="flex-1 gap-1"
                  disabled={!aiDesc.trim() || aiGenerating}
                  onClick={async () => {
                    setAiGenerating(true);
                    try {
                      await onGenerate(aiDesc.trim());
                      setAiDesc("");
                      setCreateMode(null);
                    } finally {
                      setAiGenerating(false);
                    }
                  }}
                >
                  {aiGenerating ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Sparkles className="size-3" />
                  )}
                  {aiGenerating ? "생성중..." : "AI 생성"}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => { setCreateMode(null); setAiDesc(""); }}
                  disabled={aiGenerating}
                >
                  취소
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <Separator />

      {/* ── Quick Run ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 px-1">
          <Zap className="size-3.5 text-amber-400" />
          <span className="text-xs font-semibold">Quick Run</span>
        </div>

        <Input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task..."
          disabled={isRunning || submitting}
          className="text-xs"
        />

        <Button
          variant="default"
          size="sm"
          onClick={handleQuickRun}
          disabled={isRunning || submitting || !task.trim()}
          className="w-full gap-1.5"
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run
        </Button>
      </div>
    </div>
  );
}
