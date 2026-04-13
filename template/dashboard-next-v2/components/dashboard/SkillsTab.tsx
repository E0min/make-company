"use client";

import { useState, useEffect, useMemo } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InstalledSkill, SkillUsageAgg } from "@/lib/types";
import { Search, Package, Settings, X } from "lucide-react";

/* ── Sub-view identifiers ── */
type SubView = "my" | "customize";

const SUB_TABS: { key: SubView; label: string; icon: React.ReactNode }[] = [
  { key: "my", label: "내 스킬", icon: <Package className="size-3.5" /> },
  { key: "customize", label: "개인화", icon: <Settings className="size-3.5" /> },
];

/* ── 역할 기반 카테고리 정의 ── */
const ROLE_CATEGORIES = [
  "전체",
  "개발",
  "디자인",
  "QA/테스트",
  "기획/관리",
  "배포/인프라",
  "보안/리뷰",
  "문서/기타",
  "기타",
] as const;

type RoleCategory = (typeof ROLE_CATEGORIES)[number];

/** 카테고리별 뱃지 색상 매핑 */
const CATEGORY_COLORS: Record<string, string> = {
  "개발":      "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  "디자인":    "bg-pink-500/15 text-pink-300 border-pink-500/30",
  "QA/테스트": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "기획/관리": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "배포/인프라": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  "보안/리뷰": "bg-red-500/15 text-red-300 border-red-500/30",
  "문서/기타": "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  "기타":      "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS["기타"];
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
  const [activeCategory, setActiveCategory] = useState<RoleCategory>("전체");

  useEffect(() => {
    if (!getCurrentProject()) { setLoading(false); return; }

    setLoading(true);
    Promise.all([api.skillsInstalled(), api.skillsUsage()])
      .then(([skillsRes, usageRes]) => {
        setSkills(skillsRes.skills ?? []);
        setUsage(usageRes.usage ?? {});
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
        {ROLE_CATEGORIES.map((cat) => {
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
 * 2. 개인화 (Skill Customization)
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
