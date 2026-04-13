"use client";

import { useState, useEffect, useCallback } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FileText,
  Users,
  Bot,
  ScrollText,
  Pencil,
  Save,
  X,
  Loader2,
} from "lucide-react";

/* ── Types ── */

interface Doc {
  type: string;
  id: string;
  path: string;
  label: string;
  updated_at: string;
}

interface DocContent {
  type: string;
  id: string;
  path: string;
  content: string;
  updated_at: string;
}

/* ── Category definitions ── */

type Category = "project" | "team" | "agent" | "rules";

const CATEGORIES: { key: Category; label: string; icon: React.ReactNode }[] = [
  { key: "project", label: "전체", icon: <FileText className="size-3.5" /> },
  { key: "team", label: "팀별", icon: <Users className="size-3.5" /> },
  { key: "agent", label: "에이전트", icon: <Bot className="size-3.5" /> },
  { key: "rules", label: "규칙", icon: <ScrollText className="size-3.5" /> },
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DocsTab -- 문서 관리 탭 (카테고리 + 사이드바 + 뷰어/에디터)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export function DocsTab() {
  /* ── State ── */
  const [category, setCategory] = useState<Category>("project");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [content, setContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Fetch document list ── */
  useEffect(() => {
    if (!getCurrentProject()) {
      setLoadingDocs(false);
      return;
    }

    setLoadingDocs(true);
    setError(null);
    api
      .docs()
      .then((res) => {
        setDocs(res.docs ?? []);
      })
      .catch((err) => {
        setDocs([]);
        setError(String(err));
      })
      .finally(() => setLoadingDocs(false));
  }, []);

  /* ── Filter docs by category ── */
  const filteredDocs = docs.filter((d) => d.type === category);

  /* ── Select document ── */
  const handleSelect = useCallback(
    async (doc: Doc) => {
      setSelected(doc);
      setEditMode(false);
      setLoadingContent(true);
      setContent("");
      try {
        const res: DocContent = await api.docContent(doc.type, doc.id);
        setContent(res.content ?? "");
      } catch (err) {
        setContent("");
        toast.error("문서를 불러올 수 없습니다");
      } finally {
        setLoadingContent(false);
      }
    },
    []
  );

  /* ── Enter edit mode ── */
  const handleEdit = useCallback(() => {
    setEditContent(content);
    setEditMode(true);
  }, [content]);

  /* ── Cancel edit ── */
  const handleCancel = useCallback(() => {
    setEditMode(false);
    setEditContent("");
  }, []);

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.docSave(selected.type, selected.id, editContent);
      if (res.ok) {
        setContent(editContent);
        setEditMode(false);
        toast.success("저장 완료");
        // Update the timestamp in the sidebar
        const newTs = res.updated_at as string | undefined;
        if (newTs) {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === selected.id && d.type === selected.type
                ? { ...d, updated_at: newTs }
                : d
            )
          );
        }
      } else {
        toast.error(res.error || "저장에 실패했습니다");
      }
    } catch {
      toast.error("저장 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }, [selected, editContent]);

  /* ── Reset selected when category changes ── */
  useEffect(() => {
    setSelected(null);
    setContent("");
    setEditMode(false);
    setEditContent("");
  }, [category]);

  /* ── Loading state ── */
  if (loadingDocs) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        문서 목록을 불러오는 중...
      </div>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          문서를 불러올 수 없습니다. 프로젝트를 확인해주세요.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Category pill tabs (top bar) ── */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-900/60 p-1 w-fit">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setCategory(cat.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              category === cat.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── 3-panel layout: sidebar + content ── */}
      <div className="flex gap-4 min-h-[calc(100vh-260px)]">
        {/* ── Sidebar (left, 180px) ── */}
        <Card className="w-[180px] shrink-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-0.5">
              {filteredDocs.length === 0 ? (
                <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                  문서가 없습니다
                </div>
              ) : (
                filteredDocs.map((doc) => {
                  const isSelected =
                    selected?.id === doc.id && selected?.type === doc.type;
                  return (
                    <button
                      key={`${doc.type}-${doc.id}`}
                      type="button"
                      onClick={() => handleSelect(doc)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-md transition-colors",
                        isSelected
                          ? "bg-indigo-600/10 border-l-2 border-indigo-500"
                          : "hover:bg-zinc-800/60 border-l-2 border-transparent"
                      )}
                    >
                      <div
                        className={cn(
                          "text-xs truncate",
                          isSelected
                            ? "text-foreground font-medium"
                            : "text-zinc-400"
                        )}
                      >
                        {doc.label}
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5 font-mono tabular-nums">
                        {formatTimestamp(doc.updated_at)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* ── Content area (right) ── */}
        <Card className="flex-1 min-w-0">
          {!selected ? (
            /* ── Empty state ── */
            <CardContent className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground">
              <FileText className="size-8 mb-3 opacity-40" />
              <p className="text-sm">사이드바에서 문서를 선택하세요</p>
            </CardContent>
          ) : loadingContent ? (
            /* ── Loading content ── */
            <CardContent className="flex items-center justify-center h-full py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" />
              내용을 불러오는 중...
            </CardContent>
          ) : (
            <div className="flex flex-col h-full">
              {/* ── Content header ── */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <CategoryIcon type={selected.type as Category} />
                  <span className="text-sm font-semibold truncate">
                    {selected.label}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[9px] shrink-0"
                  >
                    {selected.type}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {editMode ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={handleCancel}
                        disabled={saving}
                      >
                        <X className="size-3" />
                        취소
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Save className="size-3" />
                        )}
                        {saving ? "저장 중..." : "저장"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1"
                      onClick={handleEdit}
                    >
                      <Pencil className="size-3" />
                      편집
                    </Button>
                  )}
                </div>
              </div>

              {/* ── Content body ── */}
              <div className="flex-1 min-h-0">
                {editMode ? (
                  /* ── Edit mode: textarea ── */
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full bg-zinc-950/50 text-zinc-300 font-mono text-xs leading-relaxed p-4 outline-none resize-none border-none"
                    spellCheck={false}
                    autoFocus
                  />
                ) : (
                  /* ── View mode: monospace rendered markdown ── */
                  <ScrollArea className="h-full">
                    <pre className="p-4 text-xs leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
                      {content || "(빈 문서)"}
                    </pre>
                  </ScrollArea>
                )}
              </div>

              {/* ── Content footer ── */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-muted-foreground shrink-0">
                <span className="font-mono truncate" title={selected.path}>
                  {selected.path}
                </span>
                <span className="font-mono tabular-nums shrink-0">
                  {formatTimestamp(selected.updated_at)}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function CategoryIcon({ type }: { type: Category }) {
  switch (type) {
    case "project":
      return <FileText className="size-3.5 text-indigo-400 shrink-0" />;
    case "team":
      return <Users className="size-3.5 text-emerald-400 shrink-0" />;
    case "agent":
      return <Bot className="size-3.5 text-amber-400 shrink-0" />;
    case "rules":
      return <ScrollText className="size-3.5 text-rose-400 shrink-0" />;
    default:
      return <FileText className="size-3.5 text-zinc-400 shrink-0" />;
  }
}

function formatTimestamp(ts: string): string {
  if (!ts) return "--";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}
