"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { WorkflowStep } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stepId: string;
  prompt: string;
  allSteps: WorkflowStep[];
  onSave: (prompt: string) => void;
}

/* ------------------------------------------------------------------ */
/*  WorkflowPromptDialog                                               */
/* ------------------------------------------------------------------ */

export function WorkflowPromptDialog({
  open,
  onOpenChange,
  stepId,
  prompt,
  allSteps,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(prompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* dialog가 열릴 때마다 draft를 외부 prompt로 리셋 */
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setDraft(prompt);
      }
      onOpenChange(nextOpen);
    },
    [prompt, onOpenChange]
  );

  /* 변수 Badge 클릭 → 커서 위치에 삽입 */
  function insertAtCursor(variable: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((prev) => prev + variable);
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = draft.slice(0, start);
    const after = draft.slice(end);
    const next = before + variable + after;
    setDraft(next);

    /* 삽입 직후 커서를 변수 뒤로 이동 */
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + variable.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleSave() {
    onSave(draft);
    onOpenChange(false);
  }

  /* 사용 가능한 변수 목록 생성 */
  const variables: { label: string; value: string }[] = [
    { label: "{{input}}", value: "{{input}}" },
    ...allSteps
      .filter((s) => s.id !== stepId && s.output)
      .map((s) => ({
        label: `{{steps.${s.id}.output}}`,
        value: `{{steps.${s.id}.output}}`,
      })),
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            프롬프트 편집 &mdash; {stepId}
          </DialogTitle>
          <DialogDescription>
            프롬프트 템플릿을 작성하세요. 아래 변수 Badge를 클릭하면 커서 위치에 삽입됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* Textarea */}
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          placeholder="이 스텝에서 에이전트가 수행할 작업을 설명하세요..."
          className="font-mono text-xs leading-relaxed"
        />

        {/* 변수 힌트 영역 */}
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">
            사용 가능한 변수:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => insertAtCursor(v.value)}
                className="inline-flex"
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer font-mono text-[10px] hover:bg-muted transition-colors"
                >
                  {v.label}
                </Badge>
              </button>
            ))}
            {variables.length <= 1 && (
              <span className="text-xs text-muted-foreground italic">
                다른 스텝의 output이 정의되면 여기에 표시됩니다.
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
