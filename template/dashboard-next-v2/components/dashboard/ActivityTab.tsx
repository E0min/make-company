"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Radio, ArrowDown } from "lucide-react";
import type { ActivityEntry } from "@/lib/types";

interface Props {
  entries: ActivityEntry[];
  onClear: () => void;
}

/**
 * Activity 탭.
 * SSE 실시간 로그를 표시한다.
 * - 각 줄: timestamp, [agent], message
 * - 스크롤 인식 자동 스크롤 (하단 50px 이내일 때만)
 * - 유저가 위로 스크롤하면 "새 메시지" pill 표시
 * - 에이전트 필터 칩
 * - 빈 상태 메시지
 */
export function ActivityTab({ entries, onClear }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  /* ── 에이전트 목록 추출 ── */
  const uniqueAgents = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.agent && e.agent !== "system") set.add(e.agent);
    }
    return Array.from(set).sort();
  }, [entries]);

  /* ── 에이전트 필터 토글 ── */
  const toggleAgent = useCallback((agent: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agent) ? prev.filter((a) => a !== agent) : [...prev, agent]
    );
  }, []);

  /* ── 필터링된 엔트리 ── */
  const filteredEntries = useMemo(() => {
    if (selectedAgents.length === 0) return entries;
    return entries.filter((e) => selectedAgents.includes(e.agent));
  }, [entries, selectedAgents]);

  /* ── 스크롤 위치 감지 ── */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 50;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= threshold;
    if (isNearBottomRef.current) {
      setShowNewMessage(false);
    }
  }, []);

  /* ── 새 엔트리가 추가되면 스크롤 인식 자동 스크롤 ── */
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowNewMessage(true);
    }
  }, [filteredEntries.length]);

  /* ── pill 클릭 시 하단으로 이동 ── */
  const jumpToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    isNearBottomRef.current = true;
    setShowNewMessage(false);
  }, []);

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
            {filteredEntries.length} events
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

      {/* 에이전트 필터 칩 */}
      {uniqueAgents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {uniqueAgents.map((agent) => {
            const isActive = selectedAgents.includes(agent);
            return (
              <button
                key={agent}
                type="button"
                onClick={() => toggleAgent(agent)}
                className={
                  isActive
                    ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium bg-indigo-600 text-white border border-indigo-500 transition-colors"
                    : "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
                }
              >
                <span
                  className="size-1.5 rounded-full mr-1.5 shrink-0"
                  style={{ backgroundColor: getAgentColor(agent) }}
                />
                {agent}
              </button>
            );
          })}
          {selectedAgents.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedAgents([])}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* 로그 영역 */}
      <Card>
        <CardContent className="p-0 relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[calc(100vh-320px)] min-h-[400px] overflow-y-auto"
          >
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <Radio className="size-8 mb-3 opacity-30" />
                <p className="text-sm">No activity yet</p>
                <p className="text-[11px] mt-1">
                  Events will appear here in real-time when agents are running.
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-0.5 font-mono text-[11px]">
                {filteredEntries.map((entry, i) => (
                  <ActivityLine key={i} entry={entry} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* 새 메시지 pill */}
          {showNewMessage && (
            <button
              type="button"
              onClick={jumpToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-indigo-500 transition-colors z-10"
            >
              <ArrowDown className="size-3" />
              새 메시지
            </button>
          )}
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
