"use client";

/**
 * json-render 레지스트리 — shadcn/ui 컴포넌트 매핑
 *
 * 에이전트가 출력하는 json-render Spec JSON을 대시보드의
 * 기존 디자인 시스템(shadcn/ui + Tailwind)으로 렌더링합니다.
 */

import type { ReactNode } from "react";
import type { ComponentRegistry } from "@json-render/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  AlertTriangle,
} from "lucide-react";

// ━━━ 헬퍼 ━━━

function p(element: { props?: Record<string, unknown> }) {
  return (element.props ?? {}) as Record<string, string | number | boolean | undefined>;
}

// ━━━ 레지스트리 정의 ━━━

export const registry: ComponentRegistry = {
  // ── 레이아웃 ──

  Stack: ({ element, children }) => {
    const props = p(element);
    const direction = props.direction ?? "vertical";
    const gap = Number(props.gap ?? 3);
    return (
      <div
        className={cn(
          "flex",
          direction === "horizontal" ? "flex-row" : "flex-col",
        )}
        style={{ gap: `${gap * 4}px` }}
      >
        {children}
      </div>
    );
  },

  Grid: ({ element, children }) => {
    const { columns = 2, gap = 3 } = p(element);
    return (
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Number(columns)}, minmax(0, 1fr))`,
          gap: `${Number(gap) * 4}px`,
        }}
      >
        {children}
      </div>
    );
  },

  // ── 데이터 표시 ──

  Card: ({ element, children }) => {
    const props = p(element);
    const title = props.title ? String(props.title) : null;
    const description = props.description ? String(props.description) : null;
    return (
      <Card>
        {(title || description) ? (
          <CardHeader>
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
        ) : null}
        <CardContent>{children}</CardContent>
      </Card>
    );
  },

  Metric: ({ element }) => {
    const props = p(element);
    const trendColor =
      props.trend === "up" ? "text-emerald-400" :
      props.trend === "down" ? "text-red-400" :
      "text-muted-foreground";
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
        <div className="text-2xl font-bold tabular-nums">{String(props.value ?? "—")}</div>
        <div className="text-xs text-muted-foreground mt-1">{String(props.label ?? "")}</div>
        {props.trendLabel ? (
          <div className={cn("text-[10px] mt-1 font-medium", trendColor)}>
            {String(props.trendLabel)}
          </div>
        ) : null}
      </div>
    );
  },

  Badge: ({ element }) => {
    const { label, variant = "outline" } = p(element);
    return (
      <Badge variant={variant as "default" | "outline" | "secondary" | "destructive"}>
        {String(label ?? "")}
      </Badge>
    );
  },

  Table: ({ element }) => {
    const { columns = [], rows = [] } = p(element) as {
      columns?: { key: string; label: string }[];
      rows?: Record<string, unknown>[];
    };
    if (!columns.length) return null;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 tabular-nums">
                    {String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },

  Progress: ({ element }) => {
    const props = p(element);
    const value = Number(props.value ?? 0);
    const label = props.label ? String(props.label) : null;
    return (
      <div className="space-y-1">
        {label ? (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}%</span>
          </div>
        ) : null}
        <Progress value={value} />
      </div>
    );
  },

  // ── 피드백 ──

  Alert: ({ element, children }) => {
    const props = p(element);
    const variant = String(props.variant ?? "info");
    const title = props.title ? String(props.title) : null;
    const message = props.message ? String(props.message) : null;
    const styleMap = {
      info: { icon: <Info className="size-4" />, border: "border-blue-500/30", bg: "bg-blue-500/5", text: "text-blue-400" },
      success: { icon: <CheckCircle2 className="size-4" />, border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-400" },
      warning: { icon: <AlertTriangle className="size-4" />, border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400" },
      error: { icon: <AlertCircle className="size-4" />, border: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-400" },
    };
    const s = styleMap[variant as keyof typeof styleMap] ?? styleMap.info;
    return (
      <div className={cn("flex items-start gap-3 rounded-lg border p-3", s.border, s.bg)}>
        <span className={cn("mt-0.5 shrink-0", s.text)}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          {title ? <div className={cn("text-sm font-medium", s.text)}>{title}</div> : null}
          {message ? <div className="text-xs text-muted-foreground mt-0.5">{message}</div> : null}
          {children}
        </div>
      </div>
    );
  },

  // ── 인터랙션 ──

  Button: ({ element, emit }) => {
    const { label, variant = "outline", size = "sm" } = p(element);
    return (
      <Button
        variant={variant as "default" | "outline" | "secondary" | "destructive" | "ghost"}
        size={size as "default" | "sm" | "lg" | "icon"}
        onClick={() => emit("press")}
      >
        {String(label ?? "")}
      </Button>
    );
  },

  Separator: () => <Separator />,

  // ── 텍스트 ──

  Text: ({ element }) => {
    const { content, size = "sm", weight, color } = p(element);
    return (
      <p
        className={cn(
          `text-${size}`,
          weight === "bold" && "font-bold",
          weight === "medium" && "font-medium",
          color ? `text-${color}` : "text-muted-foreground",
        )}
      >
        {String(content ?? "")}
      </p>
    );
  },

  Heading: ({ element }) => {
    const props = p(element);
    const level = Number(props.level ?? 3);
    const text = String(props.content ?? "");
    const cls = cn("font-bold tracking-tight", level <= 2 ? "text-lg" : "text-sm");
    if (level <= 1) return <h1 className={cls}>{text}</h1>;
    if (level === 2) return <h2 className={cls}>{text}</h2>;
    if (level === 3) return <h3 className={cls}>{text}</h3>;
    return <h4 className={cls}>{text}</h4>;
  },

  // ── 바 차트 (CSS 기반, 의존성 0) ──

  BarGraph: ({ element }) => {
    const { data = [], xKey = "label", yKey = "value", height = 120 } = p(element) as {
      data?: Record<string, unknown>[];
      xKey?: string;
      yKey?: string;
      height?: number;
    };
    if (!data.length) return null;
    const max = Math.max(...data.map((d) => Number(d[yKey] ?? 0)), 1);
    return (
      <div className="flex items-end gap-1" style={{ height: `${Number(height)}px` }}>
        {data.map((d, i) => {
          const val = Number(d[yKey] ?? 0);
          const pct = (val / max) * 100;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">{val}</span>
              <div
                className="w-full rounded-t bg-indigo-500/80 transition-all"
                style={{ height: `${pct}%`, minHeight: val > 0 ? "2px" : "0" }}
              />
              <span className="text-[9px] text-muted-foreground truncate max-w-full">
                {String(d[xKey] ?? "")}
              </span>
            </div>
          );
        })}
      </div>
    );
  },

  // ── 코드 블록 ──

  Code: ({ element }) => {
    const { content, language } = p(element);
    return (
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <code>{String(content ?? "")}</code>
      </pre>
    );
  },
};
