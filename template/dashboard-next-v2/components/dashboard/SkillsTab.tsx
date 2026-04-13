"use client";

import { useState, useEffect, useMemo } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InstalledSkill, SkillUsageAgg } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Package, Settings, Tag, X, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

/* ── Sub-view identifiers ── */
type SubView = "my" | "customize" | "categories";

const SUB_TABS: { key: SubView; label: string; icon: React.ReactNode }[] = [
  { key: "my", label: "내 스킬", icon: <Package className="size-3.5" /> },
  { key: "categories", label: "카테고리 관리", icon: <Tag className="size-3.5" /> },
  { key: "customize", label: "개인화", icon: <Settings className="size-3.5" /> },
];

/* ── 기본 카테고리 (서버에서 커스텀 로드 전 폴백) ── */
const DEFAULT_CATEGORIES = [
  "전체", "개발", "디자인", "QA/테스트", "기획/관리", "배포/인프라", "보안/리뷰", "문서/기타", "기타",
];

/** 카테고리별 뱃지 색상 매핑 (기본값) */
const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  "개발":      "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  "디자인":    "bg-pink-500/15 text-pink-300 border-pink-500/30",
  "QA/테스트": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "기획/관리": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "배포/인프라": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  "보안/리뷰": "bg-red-500/15 text-red-300 border-red-500/30",
  "문서/기타": "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  "기타":      "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

/** 색상 이름 → CSS 클래스 매핑 (카테고리 관리 UI에서 사용) */
const COLOR_PRESETS: Record<string, string> = {
  indigo:  "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  pink:    "bg-pink-500/15 text-pink-300 border-pink-500/30",
  amber:   "bg-amber-500/15 text-amber-300 border-amber-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cyan:    "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  red:     "bg-red-500/15 text-red-300 border-red-500/30",
  violet:  "bg-violet-500/15 text-violet-300 border-violet-500/30",
  orange:  "bg-orange-500/15 text-orange-300 border-orange-500/30",
  zinc:    "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

const CATEGORY_COLORS: Record<string, string> = { ...DEFAULT_CATEGORY_COLORS };

function getCategoryColor(category: string, customColors?: Record<string, string>): string {
  if (customColors?.[category]) {
    return COLOR_PRESETS[customColors[category]] ?? DEFAULT_CATEGORY_COLORS["기타"];
  }
  return CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLORS["기타"];
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SkillsTab – 스킬 관리 허브 (2개 서브뷰)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export function SkillsTab() {
  const [view, setView] = useState<SubView>("my");

  return (
    <div className="space-y-4">
      {/* ── 서브뷰 pill 탭 ── */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-900/60 p-1 w-fit">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === tab.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 서브뷰 렌더 ── */}
      {view === "my" && <MySkillsView />}
      {view === "categories" && <CategoriesView />}
      {view === "customize" && <CustomizeView />}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. 내 스킬 (My Skills) — 역할 기반 카테고리 필터
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function MySkillsView() {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [usage, setUsage] = useState<Record<string, SkillUsageAgg>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("전체");
  const [categoryNames, setCategoryNames] = useState<string[]>(DEFAULT_CATEGORIES);

  useEffect(() => {
    if (!getCurrentProject()) { setLoading(false); return; }

    setLoading(true);
    Promise.all([api.skillsInstalled(), api.skillsUsage(), api.skillCategories().catch(() => null)])
      .then(([skillsRes, usageRes, catRes]) => {
        setSkills(skillsRes.skills ?? []);
        setUsage(usageRes.usage ?? {});
        if (catRes?.categories) {
          const names = ["전체", ...Object.keys(catRes.categories), "기타"];
          setCategoryNames([...new Set(names)]);
        }
      })
      .catch(() => {
        setSkills([]);
        setUsage({});
      })
      .finally(() => setLoading(false));
  }, []);

  /* 카테고리별 스킬 수 집계 */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of skills) {
      const cat = s.category || "기타";
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [skills]);

  /* 필터링: 텍스트 검색 + 역할 카테고리 (키워드도 텍스트 검색에 포함) */
  const filtered = skills.filter((s) => {
    const lowerQuery = query.toLowerCase();
    const matchesQuery =
      !query ||
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      (s.keywords ?? []).some((kw) => kw.toLowerCase().includes(lowerQuery));
    const matchesCategory =
      activeCategory === "전체" || s.category === activeCategory;
    return matchesQuery && matchesCategory;
  });

  /* 사용량 최대값 (바 비율 계산용) */
  const maxCount = Math.max(
    1,
    ...Object.values(usage).map((u) => u.count)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        스킬을 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 검색 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          placeholder="이름, 설명 또는 키워드로 검색..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* 역할 카테고리 필터 pills */}
      <div className="flex flex-wrap gap-1.5">
        {categoryNames.map((cat) => {
          const count = cat === "전체"
            ? skills.length
            : (categoryCounts[cat] ?? 0);
          /* 해당 카테고리에 스킬이 없으면 pill을 숨김 (전체는 항상 표시) */
          if (cat !== "전체" && count === 0) return null;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer",
                isActive
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                  : "bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
              )}
            >
              {cat}
              <span className={cn(
                "text-[10px] font-mono",
                isActive ? "text-indigo-400" : "text-zinc-600"
              )}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* 스킬 그리드 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {skills.length === 0
              ? "설치된 스킬이 없습니다."
              : "검색 결과가 없습니다."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((skill) => {
            const u = usage[skill.name];
            const count = u?.count ?? 0;
            const agents = u?.agents ?? [];
            const barWidth = (count / maxCount) * 100;
            const category = skill.category || "기타";

            return (
              <Card key={skill.name} className="relative overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  {/* 이름 + 역할 카테고리 뱃지 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {skill.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {skill.description || "--"}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] shrink-0 border",
                        getCategoryColor(category)
                      )}
                    >
                      {category}
                    </Badge>
                  </div>

                  {/* 사용량 바 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>사용량</span>
                      <span className="font-mono">{count}회</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>

                  {/* 사용 에이전트 */}
                  {agents.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agents.map((agent) => (
                        <Badge
                          key={agent}
                          variant="outline"
                          className="text-[9px] font-mono"
                        >
                          {agent}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* 심링크 표시 */}
                  {skill.is_symlink && (
                    <div className="text-[9px] text-zinc-500 truncate" title={skill.path}>
                      symlink: {skill.path}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 2. 카테고리 관리 — CRUD + 스킬 배정
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function CategoriesView() {
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editDialog, setEditDialog] = useState<{ mode: "add" | "edit"; name: string; color: string } | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("indigo");
  const [assignDialog, setAssignDialog] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([api.skillCategories(), api.skillsInstalled()])
      .then(([catRes, skillsRes]) => {
        if (catRes.categories) setCategories(catRes.categories);
        if (catRes.colors) setColors(catRes.colors);
        setSkills(skillsRes.skills ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await api.skillCategoriesSave(categories, colors);
      toast.success("카테고리 저장 완료");
    } catch {
      toast.error("저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = () => {
    setEditDialog({ mode: "add", name: "", color: "indigo" });
    setEditName("");
    setEditColor("indigo");
  };

  const handleEditCategory = (name: string) => {
    setEditDialog({ mode: "edit", name, color: colors[name] ?? "zinc" });
    setEditName(name);
    setEditColor(colors[name] ?? "zinc");
  };

  const handleSaveDialog = () => {
    if (!editDialog || !editName.trim()) return;
    const trimmed = editName.trim();

    if (editDialog.mode === "add") {
      if (categories[trimmed]) { toast.warning("이미 존재하는 카테고리입니다"); return; }
      setCategories((prev) => ({ ...prev, [trimmed]: [] }));
    } else if (editDialog.mode === "edit" && editDialog.name !== trimmed) {
      // 이름 변경
      const newCats = { ...categories };
      newCats[trimmed] = newCats[editDialog.name] ?? [];
      delete newCats[editDialog.name];
      setCategories(newCats);
      const newColors = { ...colors };
      delete newColors[editDialog.name];
      newColors[trimmed] = editColor;
      setColors(newColors);
      setEditDialog(null);
      return;
    }
    setColors((prev) => ({ ...prev, [trimmed]: editColor }));
    setEditDialog(null);
  };

  const handleDeleteCategory = (name: string) => {
    const newCats = { ...categories };
    delete newCats[name];
    setCategories(newCats);
    const newColors = { ...colors };
    delete newColors[name];
    setColors(newColors);
  };

  const handleAssignSkill = (skill: string, category: string) => {
    // 다른 카테고리에서 제거
    const newCats = { ...categories };
    for (const [cat, names] of Object.entries(newCats)) {
      newCats[cat] = names.filter((n) => n !== skill);
    }
    // 대상 카테고리에 추가
    if (!newCats[category]) newCats[category] = [];
    if (!newCats[category].includes(skill)) {
      newCats[category] = [...newCats[category], skill];
    }
    setCategories(newCats);
  };

  const handleRemoveSkill = (skill: string, category: string) => {
    setCategories((prev) => ({
      ...prev,
      [category]: (prev[category] ?? []).filter((n) => n !== skill),
    }));
  };

  // 카테고리에 배정되지 않은 스킬
  const assignedSkills = new Set(Object.values(categories).flat());
  const unassignedSkills = skills.filter((s) => !assignedSkills.has(s.name));

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">카테고리 불러오는 중...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          카테고리를 추가/수정/삭제하고, 스킬을 원하는 카테고리에 배정하세요. 변경 후 저장을 눌러야 적용됩니다.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAddCategory} className="gap-1.5">
            <Plus className="size-3" /> 카테고리 추가
          </Button>
          <Button variant="default" size="sm" onClick={handleSaveAll} disabled={saving} className="gap-1.5">
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>

      {/* 카테고리 목록 */}
      <div className="space-y-3">
        {Object.entries(categories).map(([catName, catSkills]) => {
          const colorClass = COLOR_PRESETS[colors[catName] ?? "zinc"] ?? COLOR_PRESETS["zinc"];
          return (
            <Card key={catName}>
              <CardContent className="p-4 space-y-2">
                {/* 카테고리 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs border", colorClass)}>
                      {catName}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{catSkills.length}개 스킬</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => handleEditCategory(catName)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="size-7 p-0 text-red-400 hover:text-red-300" onClick={() => handleDeleteCategory(catName)}>
                      <Trash2 className="size-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => { setAssignDialog(catName); setSkillSearch(""); }}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* 배정된 스킬 뱃지 */}
                {catSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {catSkills.map((sk) => (
                      <Badge key={sk} variant="outline" className={cn("text-xs font-mono gap-1 border", colorClass)}>
                        {sk}
                        <button type="button" onClick={() => handleRemoveSkill(sk, catName)} className="hover:text-red-400">
                          <X className="size-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">배정된 스킬 없음</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 미배정 스킬 */}
      {unassignedSkills.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border bg-zinc-500/15 text-zinc-300 border-zinc-500/30">미배정</Badge>
              <span className="text-xs text-muted-foreground">{unassignedSkills.length}개 스킬</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {unassignedSkills.map((sk) => (
                <Badge key={sk.name} variant="outline" className="text-xs font-mono text-zinc-500 border-zinc-700">
                  {sk.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 카테고리 추가/수정 다이얼로그 */}
      <Dialog open={!!editDialog} onOpenChange={(open) => { if (!open) setEditDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDialog?.mode === "add" ? "카테고리 추가" : "카테고리 수정"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">이름</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="카테고리 이름" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">색상</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(COLOR_PRESETS).map(([name, cls]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setEditColor(name)}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs border transition-all",
                      cls,
                      editColor === name ? "ring-2 ring-white/30 scale-105" : "opacity-60 hover:opacity-100"
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDialog(null)}>취소</Button>
            <Button onClick={handleSaveDialog} disabled={!editName.trim()}>
              {editDialog?.mode === "add" ? "추가" : "수정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 스킬 배정 다이얼로그 */}
      <Dialog open={!!assignDialog} onOpenChange={(open) => { if (!open) setAssignDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{assignDialog} 카테고리에 스킬 추가</DialogTitle>
          </DialogHeader>
          <Input
            value={skillSearch}
            onChange={(e) => setSkillSearch(e.target.value)}
            placeholder="스킬 검색..."
            className="mb-3"
          />
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {skills
              .filter((sk) => {
                if (assignDialog && (categories[assignDialog] ?? []).includes(sk.name)) return false;
                if (skillSearch && !sk.name.toLowerCase().includes(skillSearch.toLowerCase())) return false;
                return true;
              })
              .map((sk) => (
                <button
                  key={sk.name}
                  type="button"
                  onClick={() => {
                    if (assignDialog) handleAssignSkill(sk.name, assignDialog);
                  }}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 transition-colors flex items-center justify-between"
                >
                  <span className="text-xs font-mono">{sk.name}</span>
                  <span className="text-xs text-muted-foreground truncate ml-2 max-w-[200px]">{sk.description}</span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 3. 개인화 (Skill Customization)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function CustomizeView() {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [editBuffers, setEditBuffers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .skillsInstalled()
      .then(async (res) => {
        const installedSkills = res.skills ?? [];
        setSkills(installedSkills);

        /* 각 스킬의 config를 병렬로 fetch */
        const configEntries = await Promise.all(
          installedSkills.map(async (s) => {
            try {
              const c = await api.skillConfig(s.name);
              return [s.name, c.overrides ?? {}] as const;
            } catch {
              return [s.name, {}] as const;
            }
          })
        );

        const configMap = Object.fromEntries(configEntries);
        setConfigs(configMap);

        /* 편집 버퍼 초기화 (JSON 문자열) */
        const buffers = Object.fromEntries(
          configEntries.map(([name, overrides]) => [
            name,
            JSON.stringify(overrides, null, 2),
          ])
        );
        setEditBuffers(buffers);
      })
      .catch(() => {
        setSkills([]);
        setConfigs({});
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (skillName: string) => {
    const raw = editBuffers[skillName] ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; /* 유효하지 않은 JSON이면 무시 */
    }

    setSaving(skillName);
    try {
      await api.skillConfigSave(skillName, parsed);
      setConfigs((prev) => ({ ...prev, [skillName]: parsed }));
    } catch {
      /* 에러 무시 (toast 없이 조용히 처리) */
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        스킬 설정을 불러오는 중...
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          설치된 스킬이 없어 개인화할 항목이 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {skills.map((skill) => {
        const buffer = editBuffers[skill.name] ?? "{}";
        const isModified =
          buffer !== JSON.stringify(configs[skill.name] ?? {}, null, 2);

        /* JSON 유효성 검사 */
        let isValid = true;
        try {
          JSON.parse(buffer);
        } catch {
          isValid = false;
        }

        const category = skill.category || "기타";

        return (
          <Card key={skill.name} className="relative overflow-hidden">
            <CardContent className="p-4 space-y-3">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold truncate">
                  {skill.name}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] shrink-0 border",
                    getCategoryColor(category)
                  )}
                >
                  {category}
                </Badge>
              </div>

              {/* JSON 에디터 */}
              <textarea
                value={buffer}
                onChange={(e) =>
                  setEditBuffers((prev) => ({
                    ...prev,
                    [skill.name]: e.target.value,
                  }))
                }
                rows={6}
                className={cn(
                  "w-full rounded-md bg-zinc-900 border px-3 py-2 text-[11px] font-mono text-zinc-300 outline-none resize-y transition-colors",
                  isValid
                    ? "border-zinc-800 focus:border-indigo-500"
                    : "border-red-500/60 focus:border-red-500"
                )}
                spellCheck={false}
              />

              {/* 유효성 에러 표시 */}
              {!isValid && (
                <div className="text-[10px] text-red-400">
                  유효하지 않은 JSON 형식입니다.
                </div>
              )}

              {/* 저장 버튼 */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isModified || !isValid || saving === skill.name}
                  onClick={() => handleSave(skill.name)}
                  className="text-xs"
                >
                  <Settings className="size-3" />
                  {saving === skill.name ? "저장 중..." : "저장"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
