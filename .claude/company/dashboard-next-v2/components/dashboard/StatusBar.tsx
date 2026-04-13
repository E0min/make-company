"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  healthy: boolean;
  lastUpdated: number | null;
}

export function StatusBar({ healthy, lastUpdated }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ago = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000))
    : null;

  return (
    <footer className="flex items-center justify-between px-6 h-7 border-t border-border text-[11px] text-muted-foreground font-mono shrink-0 bg-background">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-1.5 rounded-full",
            healthy ? "bg-vc-green" : "bg-muted-foreground/40"
          )}
        />
        <span>{healthy ? "Live" : "Offline"}</span>
        <span className="opacity-40">·</span>
        <span className="tabular-nums">
          {ago !== null ? (ago < 2 ? "just now" : `${ago}s ago`) : "--"}
        </span>
      </div>
      <div className="flex items-center gap-3 tabular-nums">
        <kbd className="text-[10px] text-muted-foreground/50">g+key nav</kbd>
      </div>
    </footer>
  );
}
