"use client";

import { Search, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatTokens } from "@/lib/format";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { StateResponse } from "@/lib/types";

interface Props {
  state: StateResponse | null;
  onOpenPalette: () => void;
}

export function Header({ state, onOpenPalette }: Props) {
  const total = state?.total_tokens ?? 0;
  const limit = state?.cost_limit ?? 200_000;
  const pct = limit > 0 ? Math.min(100, Math.round((total / limit) * 100)) : 0;
  const danger = pct >= 95;
  const warn = pct >= 80;

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
      <div className="flex items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm bg-violet-500/15 text-violet-400 border border-violet-500/30 px-2 py-1 rounded-md font-mono">
            VC
          </span>
          <span className="text-sm font-semibold text-foreground">
            {state?.project ?? "Virtual Company"}
          </span>
          {state?.session_name ? (
            <span className="text-xs font-mono text-muted-foreground">
              · {state.session_name}
            </span>
          ) : null}
        </div>

        <div className="flex-1 flex items-center justify-center gap-6">
          <div className="flex flex-col gap-1 min-w-[180px]">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide">Tokens</span>
              <span className="font-mono text-foreground tabular-nums">
                {formatTokens(total)}{" "}
                <span className="text-muted-foreground">
                  / {formatTokens(limit)}
                </span>
              </span>
            </div>
            <Progress
              value={pct}
              className={
                danger
                  ? "[&>div]:bg-red-500 h-1"
                  : warn
                    ? "[&>div]:bg-amber-500 h-1"
                    : "h-1"
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPalette}
            className="gap-2 text-muted-foreground"
          >
            <Search className="size-3.5" />
            <span>Search</span>
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const r = await api.pause();
              if (r.ok) toast.success("일시정지", { description: "모든 에이전트 일시정지" });
              else toast.error("일시정지 실패");
            }}
          >
            <Pause className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const r = await api.resume();
              if (r.ok) toast.success("재개", { description: "모든 에이전트 재개됨" });
              else toast.error("재개 실패");
            }}
          >
            <Play className="size-3.5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
