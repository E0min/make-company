"use client";

/**
 * AgentDetailPopover -- 에이전트 노드 클릭 시 상세 정보 팝오버
 *
 * 노드/카드 클릭 시 absolute positioned 카드로 표시:
 * - 에이전트 이름 + 상태 배지
 * - 팀 라벨
 * - 현재 티켓/품질 (heartbeat)
 * - 최근 이벤트 5건
 * - 터미널 열기 / 닫기 버튼
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
import { api } from "@/lib/api";
import { Terminal, X, Activity, Loader2, AlertCircle, Star } from "lucide-react";
import type { AgentProfile, StructuredEvent } from "@/lib/types";

// ━━━ Props ━━━

interface AgentDetailPopoverProps {
  agentId: string;
  onClose: () => void;
  onOpenTerminal?: (id: string) => void;
  position?: { x: number; y: number };
}

// ━━━ 상태 타입 ━━━

type LoadState = "loading" | "error" | "success";

interface HeartbeatData {
  agent: string;
  ts: string;
  ticket?: string;
  status?: string;
  next_action?: string;
  goal?: string;
  quality?: number;
}

// ━━━ 컴포넌트 ━━━

export function AgentDetailPopover({
  agentId,
  onClose,
  onOpenTerminal,
  position,
}: AgentDetailPopoverProps) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [events, setEvents] = useState<StructuredEvent[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── 데이터 fetch ──

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadState("loading");
      try {
        const [profileRes, heartbeatsRes, eventsRes] = await Promise.all([
          api.agentProfile(agentId).catch(() => null),
          api.heartbeats().catch(() => null),
          api.events({ agent: agentId, limit: 5 }).catch(() => null),
        ]);

        if (cancelled) return;

        if (profileRes) setProfile(profileRes);
        if (heartbeatsRes?.heartbeats?.[agentId]) {
          setHeartbeat(heartbeatsRes.heartbeats[agentId]);
        }
        if (eventsRes?.events) setEvents(eventsRes.events);

        setLoadState("success");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [agentId]);

  // ── Escape 키로 닫기 ──

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── 외부 클릭으로 닫기 ──

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // setTimeout으로 현재 클릭 이벤트 후에 리스너 등록
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // ── 포지션 계산 (뷰포트 밖으로 나가지 않도록) ──

  const style = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: "translate(-50%, 8px)",
      }
    : {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };

  // ── 상태별 색상 ──

  const agentState = profile?.agent
    ? (profile.scores?.trend === "improving" ? "working" : "idle")
    : "idle";
  const stateFromHeartbeat = heartbeat?.status ?? agentState;
  const c = stateColor(stateFromHeartbeat);

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 w-[320px] animate-in fade-in-0 zoom-in-95 duration-150"
      style={style}
      role="dialog"
      aria-label={`${agentId} 상세 정보`}
    >
      <Card className="shadow-lg border-border/60 bg-card/95 backdrop-blur-sm">
        {/* ── 헤더: 이름 + 상태 + 닫기 ── */}
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn("size-2.5 rounded-full shrink-0", c.dot)} />
              <CardTitle className="truncate font-mono text-sm">
                {agentId}
              </CardTitle>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="outline" className={cn("text-[10px] font-mono", c.text, c.bg)}>
                {stateFromHeartbeat}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 text-muted-foreground hover:text-foreground"
                onClick={onClose}
                aria-label="닫기"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-3 space-y-3">
          {/* ── 로딩 상태 ── */}
          {loadState === "loading" && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 text-muted-foreground animate-spin" />
            </div>
          )}

          {/* ── 에러 상태 ── */}
          {loadState === "error" && (
            <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
              <AlertCircle className="size-4 text-red-400" />
              <span>데이터를 불러올 수 없습니다</span>
            </div>
          )}

          {/* ── 성공 상태 ── */}
          {loadState === "success" && (
            <>
              {/* 팀 라벨 */}
              {profile?.agent?.team && (
                <div className="text-[11px] text-muted-foreground">
                  팀: <span className="text-foreground/80">{profile.agent.team}</span>
                </div>
              )}

              {/* 프로필 설명 */}
              {profile?.agent?.description && (
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {profile.agent.description}
                </p>
              )}

              {/* Heartbeat 정보 */}
              {heartbeat && (
                <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 space-y-1">
                  {heartbeat.ticket && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">티켓:</span>
                      <span className="font-mono text-foreground/80">{heartbeat.ticket}</span>
                    </div>
                  )}
                  {heartbeat.status && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">상태:</span>
                      <span className="text-foreground/80">{heartbeat.status}</span>
                    </div>
                  )}
                  {heartbeat.quality != null && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Star className="size-3 text-amber-400" />
                      <span className="text-muted-foreground">품질:</span>
                      <span className="font-mono text-foreground/80 tabular-nums">{heartbeat.quality}/10</span>
                    </div>
                  )}
                  {heartbeat.next_action && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">다음:</span>
                      <span className="text-foreground/80 truncate">{heartbeat.next_action}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 최근 이벤트 */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-semibold">
                  <Activity className="size-3" />
                  최근 이벤트
                </div>
                {events.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 py-1">
                    기록된 이벤트가 없습니다
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {events.map((ev, i) => (
                      <li
                        key={`${ev.ts}-${i}`}
                        className="flex items-start gap-2 text-[10px] leading-relaxed"
                      >
                        <span className="text-muted-foreground/60 font-mono tabular-nums shrink-0 pt-px">
                          {formatEventTime(ev.ts)}
                        </span>
                        <span className="text-foreground/70 truncate">
                          {ev.event}
                          {ev.ticket ? ` [${ev.ticket}]` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 스코어 요약 */}
              {profile?.scores && profile.scores.total_tasks > 0 && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t border-border/30 pt-2">
                  <span>작업 {profile.scores.total_tasks}건</span>
                  <span>품질 {profile.scores.avg_quality.toFixed(1)}</span>
                  <span>에러율 {(profile.scores.error_rate * 100).toFixed(0)}%</span>
                </div>
              )}
            </>
          )}

          {/* ── 액션 버튼 ── */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/30">
            {onOpenTerminal && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-xs gap-1.5 h-8"
                onClick={() => onOpenTerminal(agentId)}
              >
                <Terminal className="size-3" />
                터미널 열기
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs gap-1.5 h-8 text-muted-foreground"
              onClick={onClose}
            >
              <X className="size-3" />
              닫기
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ━━━ 유틸 ━━━

function formatEventTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts.slice(11, 16);
  }
}
