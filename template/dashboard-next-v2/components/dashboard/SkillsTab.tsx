"use client";

import { useState, useEffect } from "react";
import { api, getCurrentProject } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InstalledSkill, SkillUsageAgg, SkillCandidate } from "@/lib/types";
import { Search, Package, Sparkles, Settings, Download, Star, TrendingUp } from "lucide-react";

/* ── Sub-view identifiers ── */
type SubView = "my" | "search" | "workflows" | "customize";

const SUB_TABS: { key: SubView; label: string; icon: React.ReactNode }[] = [
  { key: "my", label: "내 스킬", icon: <Package className="size-3.5" /> },
  { key: "search", label: "검색", icon: <Search className="size-3.5" /> },
  { key: "workflows", label: "워크플로우", icon: <TrendingUp className="size-3.5" /> },
  { key: "customize", label: "개인화", icon: <Settings className="size-3.5" /> },
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SkillsTab – 스킬 관리 허브 (4개 서브뷰)
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
      {view === "search" && <SearchView />}
      {view === "workflows" && <WorkflowsView />}
      {view === "customize" && <CustomizeView />}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. 내 스킬 (My Skills)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function MySkillsView() {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [usage, setUsage] = useState<Record<string, SkillUsageAgg>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

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

  /* 카테고리 목록 추출 */
  const categories = Array.from(new Set(skills.map((s) => s.category).filter(Boolean)));

  /* 필터링 */
  const filtered = skills.filter((s) => {
    const matchesQuery =
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || s.category === categoryFilter;
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
      {/* 검색 + 카테고리 필터 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="이름 또는 설명으로 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="all">모든 카테고리</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
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

            return (
              <Card key={skill.name} className="relative overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  {/* 이름 + 카테고리 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {skill.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {skill.description || "--"}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[9px] shrink-0">
                      {skill.category || "etc"}
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
 * 2. 검색 (Find Skills)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SearchView() {
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .skillsCandidates()
      .then((res) => setCandidates(res.candidates ?? []))
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* 안내 */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Download className="size-4 text-indigo-400" />
            스킬 검색은 터미널에서 실행하세요:
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-xs font-mono text-emerald-400 border border-zinc-800">
                clawhub search &lt;keyword&gt;
              </code>
              <span className="text-[10px] text-muted-foreground shrink-0">
                커뮤니티 스킬 검색
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-xs font-mono text-emerald-400 border border-zinc-800">
                ls ~/.agents/skills/
              </code>
              <span className="text-[10px] text-muted-foreground shrink-0">
                로컬 미설치 스킬
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 후보 스킬 */}
      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          후보 스킬을 불러오는 중...
        </div>
      ) : candidates.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-400" />
            스킬 후보 (자동 감지)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {candidates.map((c, i) => (
              <Card key={`${c.pattern}-${i}`} className="relative overflow-hidden">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {c.pattern}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        감지 에이전트: {c.agent}
                      </div>
                    </div>
                    {c.promoted ? (
                      <Badge variant="default" className="text-[9px] shrink-0 bg-emerald-600">
                        <Star className="size-2.5 mr-0.5" />
                        승격됨
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] shrink-0 text-amber-400 border-amber-400/40">
                        승격
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>빈도: {c.frequency}회</span>
                    <span className="font-mono">
                      {new Date(c.ts).toLocaleDateString("ko-KR")}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-4">
          자동 감지된 스킬 후보가 없습니다.
        </div>
      )}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 3. 워크플로우 (Skill Workflows)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function WorkflowsView() {
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-4">
        <TrendingUp className="size-8 text-indigo-400 mx-auto" />
        <div className="space-y-2">
          <p className="text-sm font-semibold">스킬 워크플로우</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            기존 Workflows 탭에서 스킬 노드를 추가하여 워크플로우를 구성하세요.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            /* Workflows 탭으로 전환: 부모 탭 상태를 직접 제어할 수 없으므로
               커스텀 이벤트를 디스패치하여 부모가 감지하도록 합니다. */
            window.dispatchEvent(
              new CustomEvent("vc:switch-tab", { detail: "workflows" })
            );
          }}
        >
          <TrendingUp className="size-3.5" />
          Workflows 탭으로 이동
        </Button>
      </CardContent>
    </Card>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 4. 개인화 (Skill Customization)
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

        return (
          <Card key={skill.name} className="relative overflow-hidden">
            <CardContent className="p-4 space-y-3">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold truncate">
                  {skill.name}
                </div>
                <Badge variant="secondary" className="text-[9px] shrink-0">
                  {skill.category || "etc"}
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
