"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Save, Trash2, Play, Plus, FileText, LayoutGrid, ChevronDown, ChevronRight, Wrench, X } from "lucide-react";
import WorkflowCanvas from "./workflow/WorkflowCanvas";
import { WorkflowPromptDialog } from "./WorkflowPromptDialog";
import type { WorkflowDefinition, WorkflowStep, InstalledSkill } from "@/lib/types";

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
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [skillSearch, setSkillSearch] = useState("");

  // 설치된 스킬 목록 로드
  useEffect(() => {
    let cancelled = false;
    api.skillsInstalled().then((res) => {
      if (!cancelled && res.skills) {
        setInstalledSkills(res.skills);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleToggleSkill = useCallback((stepId: string, skillName: string) => {
    if (!definition) return;
    const next = definition.steps.map((s) => {
      if (s.id !== stepId) return s;
      const current = s.skills ?? [];
      const has = current.includes(skillName);
      return { ...s, skills: has ? current.filter((sk) => sk !== skillName) : [...current, skillName] };
    });
    onChange({ ...definition, steps: next });
  }, [definition, onChange]);

  const handleRemoveSkill = useCallback((stepId: string, skillName: string) => {
    if (!definition) return;
    const next = definition.steps.map((s) => {
      if (s.id !== stepId) return s;
      return { ...s, skills: (s.skills ?? []).filter((sk) => sk !== skillName) };
    });
    onChange({ ...definition, steps: next });
  }, [definition, onChange]);

  const filteredSkills = installedSkills.filter((sk) =>
    !skillSearch || sk.name.toLowerCase().includes(skillSearch.toLowerCase())
  );

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

      {/* ── 단계별 스킬 설정 (접이식) ── */}
      {definition.steps.length > 0 && (
        <>
          <Separator />
          <div className="py-2">
            <button
              type="button"
              onClick={() => setSkillsOpen((v) => !v)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left"
            >
              {skillsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <Wrench className="size-3.5 text-indigo-400" />
              <span className="text-xs font-semibold">단계별 스킬</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {definition.steps.reduce((n, s) => n + (s.skills?.length ?? 0), 0)}개 배정
              </span>
            </button>

            {skillsOpen && (
              <div className="mt-2 space-y-3 px-1">
                {/* 스킬 검색 */}
                <Input
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder="스킬 검색..."
                  className="h-7 text-xs"
                />

                {/* 단계별 스킬 배정 */}
                {definition.steps.map((step) => (
                  <div key={step.id} className="rounded-md border border-border/50 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold font-mono">{step.id}</span>
                      <span className="text-xs text-muted-foreground">({step.agent || "미배정"})</span>
                    </div>

                    {/* 현재 배정된 스킬 */}
                    {(step.skills?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {step.skills!.map((sk) => (
                          <Badge
                            key={sk}
                            variant="outline"
                            className="text-xs font-mono gap-1 bg-indigo-400/10 text-indigo-400 border-indigo-400/30"
                          >
                            {sk}
                            <button
                              type="button"
                              onClick={() => handleRemoveSkill(step.id, sk)}
                              className="hover:text-red-400 transition-colors"
                            >
                              <X className="size-2.5" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* 추가 가능한 스킬 (클릭으로 토글) */}
                    <div className="flex flex-wrap gap-1">
                      {filteredSkills
                        .filter((sk) => !(step.skills ?? []).includes(sk.name))
                        .slice(0, 20)
                        .map((sk) => (
                          <button
                            key={sk.name}
                            type="button"
                            onClick={() => handleToggleSkill(step.id, sk.name)}
                            className={cn(
                              "px-1.5 py-0.5 rounded text-xs font-mono",
                              "border border-border/40 text-muted-foreground",
                              "hover:border-indigo-400/50 hover:text-indigo-400 hover:bg-indigo-400/5",
                              "transition-colors"
                            )}
                          >
                            + {sk.name}
                          </button>
                        ))}
                      {filteredSkills.filter((sk) => !(step.skills ?? []).includes(sk.name)).length > 20 && (
                        <span className="text-xs text-muted-foreground py-0.5">
                          +{filteredSkills.filter((sk) => !(step.skills ?? []).includes(sk.name)).length - 20}개 더...
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 하단 toolbar: 스텝 추가 */}
      {definition.steps.length > 0 && (
        <>
          <Separator />
          <div className="py-2">
            <Button variant="outline" size="sm" onClick={handleAddStep} className="w-full gap-1.5">
              <Plus className="size-3.5" /> 스텝 추가
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
