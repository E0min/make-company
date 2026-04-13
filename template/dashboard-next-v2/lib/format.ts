import type { ReactNode } from "react";
import type { AgentState } from "./types";

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatElapsed(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function formatTime(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("ko-KR", { hour12: false });
}

export const STATE_RANK: Record<string, number> = {
  working: 0,
  compacting: 1,
  error: 2,
  "rate-limited": 3,
  "permanently-failed": 4,
  dead: 5,
  paused: 6,
  idle: 7,
  done: 8,
  stopped: 9,
  unknown: 10,
};

/** Unified state color/style — single source of truth for all views */
export interface StateColorResult {
  bar: string;
  text: string;
  bg: string;
  dot: string;
  border: string;
  icon: ReactNode | null;
}

export function stateColor(state: AgentState | string): StateColorResult {
  switch (state) {
    case "working":
      return {
        bar: "bg-indigo-500",
        text: "text-indigo-400",
        bg: "bg-indigo-500/10",
        dot: "bg-indigo-500",
        border: "border-indigo-500 ring-1 ring-indigo-500/30",
        icon: null, // icon rendered by consumer (needs JSX import)
      };
    case "active":
      return {
        bar: "bg-indigo-400",
        text: "text-indigo-400",
        bg: "bg-indigo-400/10",
        dot: "bg-indigo-400",
        border: "border-indigo-400/50",
        icon: null,
      };
    case "compacting":
      return {
        bar: "bg-amber-500",
        text: "text-amber-400",
        bg: "bg-amber-500/10",
        dot: "bg-amber-500",
        border: "border-amber-500",
        icon: null,
      };
    case "error":
    case "permanently-failed":
    case "dead":
      return {
        bar: "bg-red-500",
        text: "text-red-400",
        bg: "bg-red-500/10",
        dot: "bg-red-500",
        border: "border-red-500",
        icon: null,
      };
    case "rate-limited":
      return {
        bar: "bg-orange-500",
        text: "text-orange-400",
        bg: "bg-orange-500/10",
        dot: "bg-orange-500",
        border: "border-orange-500",
        icon: null,
      };
    case "paused":
      return {
        bar: "bg-yellow-500",
        text: "text-yellow-400",
        bg: "bg-yellow-500/10",
        dot: "bg-yellow-500",
        border: "border-yellow-500",
        icon: null,
      };
    case "done":
      return {
        bar: "bg-emerald-500",
        text: "text-emerald-400",
        bg: "bg-emerald-500/10",
        dot: "bg-emerald-500",
        border: "border-emerald-500",
        icon: null,
      };
    case "stopped":
    case "offline":
      return {
        bar: "bg-zinc-700",
        text: "text-zinc-500",
        bg: "bg-zinc-500/5",
        dot: "bg-zinc-700",
        border: "border-border",
        icon: null,
      };
    case "idle":
    default:
      return {
        bar: "bg-zinc-500",
        text: "text-zinc-400",
        bg: "bg-zinc-500/5",
        dot: "bg-zinc-500",
        border: "border-border",
        icon: null,
      };
  }
}

export function parseDefaultSkills(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map(String);
  } catch {}
  return s
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
