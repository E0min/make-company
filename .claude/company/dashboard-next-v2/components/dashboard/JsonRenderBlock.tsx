"use client";

/**
 * JsonRenderBlock — 에이전트 출력에서 json-render Spec을 감지하고 렌더링
 *
 * 사용법:
 *   <JsonRenderBlock text={agentOutput} />
 *
 * 텍스트 안에 ```json-render ... ``` 블록이 있으면 파싱해서
 * shadcn/ui 기반 리치 UI로 렌더링하고, 나머지 텍스트는 그대로 표시.
 * json-render 블록이 없으면 전체를 plain text로 표시.
 */

import { useMemo } from "react";
import { Renderer, JSONUIProvider } from "@json-render/react";
import type { Spec } from "@json-render/react";
import { registry } from "@/lib/json-render-registry";
import { AlertCircle } from "lucide-react";

// ━━━ JSON-Render 블록 파서 ━━━

interface ParsedSegment {
  type: "text" | "json-render";
  content: string;
  spec?: Spec;
}

/** 텍스트에서 ```json-render ... ``` 코드 블록을 추출 */
function parseSegments(text: string): ParsedSegment[] {
  const pattern = /```json-render\s*\n([\s\S]*?)```/g;
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // 매치 이전 텍스트
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", content: before });
    }

    // json-render 블록
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw) as Spec;
      if (parsed.root && parsed.elements) {
        segments.push({ type: "json-render", content: raw, spec: parsed });
      } else {
        segments.push({ type: "text", content: raw });
      }
    } catch {
      segments.push({ type: "text", content: raw });
    }

    lastIndex = match.index + match[0].length;
  }

  // 나머지 텍스트
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim();
    if (rest) segments.push({ type: "text", content: rest });
  }

  return segments;
}

/** 전체 텍스트가 json-render Spec JSON인지 확인 (코드 블록 없이 직접 JSON) */
function tryParseDirectSpec(text: string): Spec | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Spec;
    if (parsed.root && parsed.elements) return parsed;
  } catch { /* not valid JSON */ }
  return null;
}

// ━━━ 컴포넌트 ━━━

interface Props {
  /** 에이전트 출력 텍스트 (plain text + json-render 블록 혼합 가능) */
  text: string;
  /** json-render 블록이 없을 때 기본 렌더링 */
  fallbackRender?: (text: string) => React.ReactNode;
}

export function JsonRenderBlock({ text, fallbackRender }: Props) {
  const result = useMemo(() => {
    // 1순위: 전체가 Spec JSON인 경우
    const directSpec = tryParseDirectSpec(text);
    if (directSpec) {
      return { mode: "direct" as const, spec: directSpec, segments: [] };
    }

    // 2순위: ```json-render 코드 블록 파싱
    const segments = parseSegments(text);
    const hasJsonRender = segments.some((s) => s.type === "json-render");
    if (hasJsonRender) {
      return { mode: "mixed" as const, spec: null, segments };
    }

    // 3순위: plain text
    return { mode: "plain" as const, spec: null, segments: [] };
  }, [text]);

  // plain text
  if (result.mode === "plain") {
    if (fallbackRender) return <>{fallbackRender(text)}</>;
    return (
      <pre className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
        {text}
      </pre>
    );
  }

  // 전체가 Spec
  if (result.mode === "direct" && result.spec) {
    return (
      <SpecRenderer spec={result.spec} />
    );
  }

  // 혼합 모드: 텍스트 + json-render 블록
  return (
    <div className="space-y-4">
      {result.segments.map((seg, i) =>
        seg.type === "json-render" && seg.spec ? (
          <SpecRenderer key={i} spec={seg.spec} />
        ) : (
          <pre key={i} className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
            {seg.content}
          </pre>
        )
      )}
    </div>
  );
}

/** Spec 렌더러 (에러 바운더리 포함) */
function SpecRenderer({ spec }: { spec: Spec }) {
  try {
    return (
      <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
        <Renderer
          spec={spec}
          registry={registry}
          fallback={({ element }) => (
            <div className="flex items-center gap-2 text-xs text-amber-400 border border-amber-400/20 rounded p-2">
              <AlertCircle className="size-3.5" />
              Unknown component: {element.type}
            </div>
          )}
        />
      </JSONUIProvider>
    );
  } catch (e) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-400 border border-red-400/20 rounded p-2">
        <AlertCircle className="size-3.5" />
        Render error: {String(e)}
      </div>
    );
  }
}
