"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  healthy: boolean;
  lastUpdated: number | null;
  agentCount: number;
  workingCount: number;
  workflowCount: number;
}

export function StatusBar({
  healthy,
  lastUpdated,
  agentCount,
  workingCount,
  workflowCount,
}: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ago = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000))
    : null;

  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/90 backdrop-blur px-5 h-7 flex items-center justify-between text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-1.5 rounded-full",
            healthy ? "bg-emerald-500 animate-pulse" : "bg-red-500"
          )}
        />
        <span>{healthy ? "Live" : "Offline"}</span>
        <span className="opacity-50">·</span>
        <span className="font-mono tabular-nums">
          updated {ago !== null ? `${ago}s ago` : "—"}
        </span>
      </div>
      <div className="font-mono tabular-nums">
        {agentCount} agents · {workingCount} working · {workflowCount} workflows
      </div>
      <div className="flex items-center gap-2">
        <kbd className="inline-flex h-4 select-none items-center rounded border border-border bg-muted px-1 font-mono text-[10px]">
          ⌘K
        </kbd>
        <span>palette</span>
        <span className="opacity-50">·</span>
        <kbd className="inline-flex h-4 select-none items-center rounded border border-border bg-muted px-1 font-mono text-[10px]">
          ?
        </kbd>
        <span>shortcuts</span>
      </div>
    </footer>
  );
}
