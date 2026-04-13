"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Save, Trash2, Play, Plus, FileText, LayoutGrid } from "lucide-react";
import WorkflowCanvas from "./workflow/WorkflowCanvas";
import { WorkflowPromptDialog } from "./WorkflowPromptDialog";
import type { WorkflowDefinition, WorkflowStep } from "@/lib/types";

interface Props {
  definition: WorkflowDefinition | null;
  onChange: (def: WorkflowDefinition) => void;
  onSave: () => void;
  onDelete: () => void;
  onRun: () => void;
  isDirty: boolean;
  isNew: boolean;
  projectActive: boolean;
}

export function WorkflowEditor({
  definition,
  onChange,
  onSave,
  onDelete,
  onRun,
  isDirty,
  isNew,
  projectActive,
}: Props) {
  const [promptStep, setPromptStep] = useState<string | null>(null);

  // 빈 상태
  if (!definition) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center gap-3">
        <FileText className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          좌측에서 워크플로우를 선택하거나 새로 만드세요
        </p>
      </div>
    );
  }

  const handleAddStep = () => {
    const idx = definition.steps.length + 1;
    const newStep: WorkflowStep = {
      id: `step-${idx}`,
      agent: "",
      prompt: "",
      depends_on: [],
      output: `step-${idx}`,
    };
    onChange({ ...definition, steps: [...definition.steps, newStep] });
  };

  const handleEditPrompt = useCallback((stepId: string) => {
    setPromptStep(stepId);
  }, []);

  const currentPromptStep = definition.steps.find((s) => s.id === promptStep);

  const handleSavePrompt = useCallback(
    (prompt: string) => {
      if (!promptStep) return;
      const next = definition.steps.map((s) =>
        s.id === promptStep ? { ...s, prompt } : s
      );
      onChange({ ...definition, steps: next });
      setPromptStep(null);
    },
    [promptStep, definition, onChange]
  );

  return (
    <div className="flex flex-col h-full">
      {/* 상단 toolbar */}
      <div className="flex flex-wrap items-end gap-3 pb-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-[11px] font-medium text-muted-foreground">Name</label>
          <Input
            value={definition.name}
            onChange={(e) => onChange({ ...definition, name: e.target.value })}
            placeholder="workflow-name"
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1 flex-[2] min-w-[200px]">
          <label className="text-[11px] font-medium text-muted-foreground">Description</label>
          <Input
            value={definition.description}
            onChange={(e) => onChange({ ...definition, description: e.target.value })}
            placeholder="What does this workflow do?"
            className="text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onSave} disabled={!isDirty && !isNew} className="gap-1.5">
            <Save className="size-3.5" /> Save
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={isNew} className="gap-1.5">
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" size="sm" onClick={onRun} disabled={!projectActive || definition.steps.length === 0} className="gap-1.5">
                    <Play className="size-3.5" /> Run
                  </Button>
                }
              />
              {!projectActive && (
                <TooltipContent>회사 실행 필요</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <Separator />

      {/* React Flow 캔버스 */}
      <div className="flex-1 min-h-[300px] relative">
        {definition.steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <LayoutGrid className="size-8 opacity-40" />
            <p className="text-sm">스텝을 추가하여 워크플로우를 구성하세요</p>
            <Button variant="outline" size="sm" onClick={handleAddStep} className="gap-1.5">
              <Plus className="size-3.5" /> Add First Step
            </Button>
          </div>
        ) : (
          <WorkflowCanvas
            definition={definition}
            onChange={onChange}
            onEditPrompt={handleEditPrompt}
          />
        )}
      </div>

      {/* 하단 toolbar */}
      {definition.steps.length > 0 && (
        <>
          <Separator />
          <div className="py-2">
            <Button variant="outline" size="sm" onClick={handleAddStep} className="w-full gap-1.5">
              <Plus className="size-3.5" /> Add Step
            </Button>
          </div>
        </>
      )}

      {/* 프롬프트 편집 Dialog */}
      <WorkflowPromptDialog
        open={promptStep !== null}
        onOpenChange={(open) => { if (!open) setPromptStep(null); }}
        stepId={promptStep ?? ""}
        prompt={currentPromptStep?.prompt ?? ""}
        allSteps={definition.steps}
        onSave={handleSavePrompt}
      />
    </div>
  );
}
