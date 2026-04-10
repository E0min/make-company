"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Trash2, Radio } from "lucide-react";
import type { ActivityEntry } from "@/lib/types";

interface Props {
  entries: ActivityEntry[];
  onClear: () => void;
}

/**
 * Activity 탭.
 * SSE 실시간 로그를 표시한다.
 * - 각 줄: timestamp, [agent], message
 * - 자동 스크롤
 * - 빈 상태 메시지
 */
export function ActivityTab({ entries, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 새 엔트리가 추가되면 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Activity Log</h2>
          <Badge variant="outline" className="text-[10px] font-mono gap-1">
            <Radio className="size-2.5 text-emerald-400 animate-pulse" />
            Live
          </Badge>
          <Badge variant="secondary" className="text-[10px] font-mono">
            {entries.length} events
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={entries.length === 0}
          className="text-muted-foreground"
        >
          <Trash2 className="size-3.5" />
          Clear
        </Button>
      </div>

      {/* 로그 영역 */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-280px)] min-h-[400px]">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <Radio className="size-8 mb-3 opacity-30" />
                <p className="text-sm">No activity yet</p>
                <p className="text-[11px] mt-1">
                  Events will appear here in real-time when agents are running.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-0.5 font-mono text-[11px]">
                {entries.map((entry, i) => (
                  <ActivityLine key={i} entry={entry} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Single activity line ── */

function ActivityLine({ entry }: { entry: ActivityEntry }) {
  // 에이전트별 색상 (해시 기반)
  const agentColor = getAgentColor(entry.agent);

  return (
    <div className="flex gap-2 py-0.5 hover:bg-muted/50 rounded px-1 transition-colors">
      {/* timestamp */}
      <span className="text-muted-foreground/60 shrink-0 tabular-nums w-[60px] text-right">
        {formatShortTime(entry.timestamp)}
      </span>

      {/* agent badge */}
      <span
        className="shrink-0 font-semibold min-w-[60px] text-right"
        style={{ color: agentColor }}
      >
        [{entry.agent}]
      </span>

      {/* message */}
      <span className="text-foreground/90 break-all">{entry.message}</span>
    </div>
  );
}

/* ── Helpers ── */

const AGENT_COLORS = [
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f59e0b", // amber
  "#f87171", // red
  "#60a5fa", // blue
  "#fb923c", // orange
  "#a3e635", // lime
  "#e879f9", // fuchsia
  "#2dd4bf", // teal
  "#fbbf24", // yellow
];

function getAgentColor(agent: string): string {
  let hash = 0;
  for (let i = 0; i < agent.length; i++) {
    hash = (hash << 5) - hash + agent.charCodeAt(i);
    hash |= 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

function formatShortTime(ts: string): string {
  // "2024-01-01 12:34:56" → "12:34:56"
  // 또는 이미 짧은 형식이면 그대로 반환
  const timeMatch = ts.match(/(\d{2}:\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : ts;
}
