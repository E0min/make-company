"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Plus, Loader2 } from "lucide-react";
import type { WorkflowItem, RunningResponse } from "@/lib/types";

// ━━━ Props ━━━

interface Props {
  workflows: WorkflowItem[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  running: RunningResponse | null;
  projectActive: boolean;
}

// ━━━ Component ━━━

/**
 * 워크플로우 목록 (좌측 패널).
 * - 워크플로우 리스트 (ScrollArea)
 * - New Workflow 버튼 (빈 템플릿)
 * - 실행 상태 뱃지 표시
 */
export function WorkflowList({
  workflows,
  selectedName,
  onSelect,
  onCreate,
  running,
  projectActive,
}: Props) {
  const isRunning = running?.pid !== null && running?.pid !== undefined;

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

      {/* ── 새 워크플로우 (빈 템플릿만) ── */}
      <Button
        variant="outline"
        size="sm"
        onClick={onCreate}
        className="w-full gap-1.5"
      >
        <Plus className="size-3.5" />
        새 워크플로우
      </Button>
    </div>
  );
}
