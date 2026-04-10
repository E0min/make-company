"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { X, Plus, Pencil } from "lucide-react";
import type { WorkflowStep } from "@/lib/types";
import { AVAILABLE_AGENTS } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  에이전트 id → 해시 기반 왼쪽 border 색상                              */
/* ------------------------------------------------------------------ */

/** 간단한 문자열 해시 → HSL 색상 (채도 고정, 밝기 고정) */
function agentBorderColor(agent: string): string {
  let hash = 0;
  for (let i = 0; i < agent.length; i++) {
    hash = agent.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/* ------------------------------------------------------------------ */
/*  순환 의존성 검사: step → target 경로가 존재하면 true                   */
/* ------------------------------------------------------------------ */

function wouldCreateCycle(
  allSteps: WorkflowStep[],
  stepId: string,
  candidateDepId: string
): boolean {
  const graph = new Map<string, string[]>();
  for (const s of allSteps) {
    graph.set(s.id, [...s.depends_on]);
  }
  // 가상으로 stepId → candidateDepId 간선 추가
  const deps = graph.get(stepId) ?? [];
  graph.set(stepId, [...deps, candidateDepId]);

  // BFS: candidateDepId에서 출발해 stepId에 도달 가능한지 확인
  const visited = new Set<string>();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of graph.get(current) ?? []) {
      if (dep === stepId) return true;
      queue.push(dep);
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  onChange: (updated: WorkflowStep) => void;
  onDelete: () => void;
  onEditPrompt: () => void;
  hasError?: boolean;
}

/* ------------------------------------------------------------------ */
/*  WorkflowStepCard                                                   */
/* ------------------------------------------------------------------ */

export function WorkflowStepCard({
  step,
  allSteps,
  onChange,
  onDelete,
  onEditPrompt,
  hasError = false,
}: Props) {
  /* 의존성 추가 후보: 자기 자신 제외 + 이미 추가된 것 제외 + 순환 방지 */
  const addableDeps = allSteps.filter(
    (s) =>
      s.id !== step.id &&
      !step.depends_on.includes(s.id) &&
      !wouldCreateCycle(allSteps, step.id, s.id)
  );

  /* --- 핸들러 --- */

  function handleIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...step, id: e.target.value });
  }

  function handleAgentChange(value: string | null) {
    if (value) onChange({ ...step, agent: value });
  }

  function handleOutputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...step, output: e.target.value });
  }

  function handleRemoveDep(depId: string) {
    onChange({
      ...step,
      depends_on: step.depends_on.filter((d) => d !== depId),
    });
  }

  function handleAddDep(depId: string) {
    onChange({
      ...step,
      depends_on: [...step.depends_on, depId],
    });
  }

  return (
    <Card
      size="sm"
      className={cn(
        "relative transition-colors",
        hasError && "border-destructive"
      )}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: agentBorderColor(step.agent),
      }}
    >
      <CardContent className="space-y-2">
        {/* Row 1: step id + agent select + delete */}
        <div className="flex items-center gap-2">
          {/* 상태 표시 점 */}
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: agentBorderColor(step.agent) }}
          />

          {/* step.id 입력 */}
          <Input
            value={step.id}
            onChange={handleIdChange}
            placeholder="step-id"
            className="h-6 flex-1 min-w-0 px-1.5 text-xs font-mono"
          />

          {/* 에이전트 선택 */}
          <Select value={step.agent} onValueChange={handleAgentChange}>
            <SelectTrigger size="sm" className="w-auto max-w-[140px]">
              <SelectValue placeholder="agent" />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_AGENTS.map((agentId) => (
                <SelectItem key={agentId} value={agentId}>
                  {agentId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 삭제 버튼 */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            aria-label="스텝 삭제"
          >
            <X />
          </Button>
        </div>

        {/* Row 2: dependencies */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground shrink-0">deps:</span>
          {step.depends_on.length === 0 && (
            <span className="text-xs text-muted-foreground italic">none</span>
          )}
          {step.depends_on.map((depId) => (
            <Badge key={depId} variant="secondary" className="gap-0.5 pr-1">
              <span className="font-mono text-[10px]">{depId}</span>
              <button
                type="button"
                onClick={() => handleRemoveDep(depId)}
                className="ml-0.5 rounded-full hover:bg-foreground/10 p-0.5"
                aria-label={`의존성 ${depId} 제거`}
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}

          {/* + add 드롭다운 */}
          {addableDeps.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-xs" aria-label="의존성 추가" />
                }
              >
                <Plus />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {addableDeps.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => handleAddDep(s.id)}
                  >
                    <span className="font-mono text-xs">{s.id}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {s.agent}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Row 3: output variable */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">
            output:
          </span>
          <Input
            value={step.output}
            onChange={handleOutputChange}
            placeholder="output_var"
            className="h-6 flex-1 min-w-0 px-1.5 text-xs font-mono"
          />
        </div>

        {/* Row 4: edit prompt */}
        <Button
          variant="ghost"
          size="xs"
          onClick={onEditPrompt}
          className="w-full justify-start text-muted-foreground"
        >
          <Pencil data-icon="inline-start" />
          Edit prompt
        </Button>
      </CardContent>
    </Card>
  );
}
