"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  projectName: string | null;
  sseConnected: boolean;
}

/**
 * 대시보드 헤더.
 * - 좌: VC 로고 + 프로젝트 이름
 * - 중: 연결 상태 배지 (connected / reconnecting)
 * - 우: 현재 시각 (매초 갱신)
 */
export function Header({ projectName, sseConnected }: Props) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    setClock(formatClock());
    const t = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between px-5 py-3 max-w-[1400px] mx-auto w-full">
        {/* 좌: 프로젝트 이름 */}
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm bg-violet-500/15 text-violet-400 border border-violet-500/30 px-2 py-1 rounded-md font-mono">
            VC
          </span>
          <span className="text-sm font-semibold text-foreground">
            {projectName ?? "Virtual Company"}
          </span>
        </div>

        {/* 중: 연결 상태 배지 */}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-mono gap-1.5",
            sseConnected
              ? "border-emerald-500/50 text-emerald-400"
              : "border-amber-500/50 text-amber-400"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              sseConnected
                ? "bg-emerald-500 animate-pulse"
                : "bg-amber-500 animate-pulse"
            )}
          />
          {sseConnected ? "Connected" : "Reconnecting"}
        </Badge>

        {/* 우: 시계 */}
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {clock}
        </span>
      </div>
    </header>
  );
}

function formatClock(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}
