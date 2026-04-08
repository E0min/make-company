"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { KnowledgeResponse } from "@/lib/types";

interface Props {
  data: KnowledgeResponse | null;
}

export function KnowledgeTab({ data }: Props) {
  const text = data?.index ?? "";
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold mb-4">Knowledge Base</h2>
        {text ? (
          <div className="prose prose-invert prose-sm max-w-none">
            {renderMiniMarkdown(text)}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No knowledge yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function renderMiniMarkdown(text: string) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 my-2">
        {listBuffer.map((item, i) => (
          <li key={i} className="text-sm text-foreground/90">
            {item}
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  let codeBlock: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (codeBlock) {
        out.push(
          <pre
            key={`code-${out.length}`}
            className="bg-muted border border-border rounded-md p-3 my-2 text-xs font-mono overflow-x-auto"
          >
            {codeBlock.join("\n")}
          </pre>
        );
        codeBlock = null;
      } else {
        flushList();
        codeBlock = [];
      }
      continue;
    }
    if (codeBlock) {
      codeBlock.push(line);
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      out.push(
        <h2
          key={`h2-${out.length}`}
          className="text-lg font-semibold mt-6 mb-2 text-foreground"
        >
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      flushList();
      out.push(
        <h3
          key={`h3-${out.length}`}
          className="text-sm font-semibold mt-4 mb-1.5 text-foreground"
        >
          {line.slice(4)}
        </h3>
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      listBuffer.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line.trim()) {
      flushList();
      out.push(
        <p key={`p-${out.length}`} className="text-sm text-foreground/85 my-2">
          {line}
        </p>
      );
    } else {
      flushList();
    }
  }
  flushList();
  return out;
}
