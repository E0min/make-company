"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api, setCurrentProject } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { useSSE } from "@/hooks/useSSE";
import { StatusBar } from "@/components/dashboard/StatusBar";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { WorkflowsTab } from "@/components/dashboard/WorkflowsTab";
import { ActivityTab } from "@/components/dashboard/ActivityTab";
import { AgentsTab } from "@/components/dashboard/AgentsTab";
import { ProjectBar } from "@/components/dashboard/ProjectBar";
import { TerminalPanel } from "@/components/dashboard/TerminalPanel";
import { SkillsTab } from "@/components/dashboard/SkillsTab";
import { HealthTab } from "@/components/dashboard/HealthTab";
import { RetroTab } from "@/components/dashboard/RetroTab";
import { AgentProfileTab } from "@/components/dashboard/AgentProfileTab";
import { TicketsTab } from "@/components/dashboard/TicketsTab";
import {
  LayoutDashboard,
  GitBranch,
  ScrollText,
  Users,
  Circle,
  Play,
  Terminal,
  AlertTriangle,
  Package,
  Activity,
  History,
  UserCircle,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/types";

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, shortcut: "g o" },
  { key: "tickets", label: "Tickets", icon: Ticket, shortcut: "g k" },
  { key: "run", label: "Workflows", icon: GitBranch, shortcut: "g r" },
  { key: "activity", label: "Activity", icon: ScrollText, shortcut: "g a" },
  { key: "agents", label: "Agents", icon: Users, shortcut: "g g" },
  { key: "skills", label: "Skills", icon: Package, shortcut: "g s" },
  { key: "health", label: "Health", icon: Activity, shortcut: "g h" },
  { key: "retro", label: "Retro", icon: History, shortcut: "g t" },
  { key: "profile", label: "Profile", icon: UserCircle, shortcut: "g p" },
] as const;

type ViewKey = (typeof NAV_ITEMS)[number]["key"];

export default function DashboardPage() {
  const [view, setView] = useState<ViewKey>("overview");
  const [sidebarHover, setSidebarHover] = useState(false);

  // ── 터미널 패널 상태 ──
  const [terminalAgent, setTerminalAgent] = useState<string | null>(null);

  const closeTerminal = useCallback(() => {
    setTerminalAgent(null);
  }, []);

  // ── 프로젝트 선택 상태 ──
  const [currentProject, setProject] = useState<string | null>(null);
  const [projectActive, setProjectActive] = useState(false);
  const [startModal, setStartModal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const openTerminal = useCallback((agentId: string) => {
    if (!currentProject) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    setTerminalAgent(agentId);
  }, [currentProject]);

  // URL ?project= 파라미터에서 초기 프로젝트 읽기, 없으면 첫 프로젝트 자동 선택
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("project");
    if (p) {
      setProject(p);
      setCurrentProject(p);
    } else {
      api.projects().then((res) => {
        if (res.projects?.length) {
          const first = res.projects[0].id;
          setProject(first);
          setCurrentProject(first);
        }
      });
    }
  }, []);

  // 프로젝트 active 상태 추적 (5초마다)
  useEffect(() => {
    if (!currentProject) return;
    const check = () => {
      api.companyStatus(currentProject).then((res) => {
        setProjectActive(res.active ?? false);
      }).catch(() => setProjectActive(false));
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [currentProject]);

  // 시작 모달 핸들러
  const handleStartFromModal = useCallback(async () => {
    if (!startModal) return;
    setStarting(true);
    const res = await api.companyStart(startModal);
    if (res.ok) {
      toast.success(`${startModal} 시작됨`);
      setProjectActive(true);
    } else {
      toast.error(res.error || "시작 실패");
    }
    setStarting(false);
    setStartModal(null);
  }, [startModal]);

  const handleProjectChange = useCallback(
    (id: string) => {
      setProject(id);
      setCurrentProject(id);
      // URL 업데이트 (히스토리 교체)
      window.history.replaceState({}, "", `?project=${id}`);
      // 기존 activity 초기화 (새 프로젝트 스트림으로 전환)
      setActivityEntries([]);
      // 데이터 즉시 refetch
      refetchAll();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Polling ──
  const stateQ = usePolling(() => api.state(), { interval: 1500 });
  const agentsQ = usePolling(() => api.agents(), { interval: 3000 });
  const workflowsQ = usePolling(() => api.workflows(), { interval: 5000 });
  const runningQ = usePolling(() => api.running(), { interval: 2000 });

  // ── SSE (project가 바뀌면 자동 재연결) ──
  const [sseConnected, setSseConnected] = useState(false);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);

  const handleActivity = useCallback((line: string) => {
    setSseConnected(true);
    const match = line.match(
      /^\[(\d{4}-\d{2}-\d{2}\s[\d:]+)\]\s*(?:\[([^\]]+)\])?\s*(.*)$/
    );
    const entry: ActivityEntry = match
      ? { timestamp: match[1], agent: match[2] ?? "system", message: match[3], raw: line }
      : { timestamp: new Date().toLocaleTimeString("ko-KR", { hour12: false }), agent: "system", message: line, raw: line };

    setActivityEntries((prev) => {
      const next = [...prev, entry];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  const handleAgentOutput = useCallback((_a: string, _d: string) => {}, []);
  useSSE(handleActivity, handleAgentOutput, { project: currentProject });

  // ── Agent state -> toast ──
  const prevStates = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const agents = stateQ.data?.agents ?? [];
    const next = new Map<string, string>();
    for (const a of agents) {
      next.set(a.id, a.state);
      const prev = prevStates.current.get(a.id);
      if (prev && prev !== a.state) {
        if (a.state === "error") toast.error(`${a.id} error`, { description: a.last_message });
        else if (a.state === "done") toast.success(`${a.id} done`);
      }
    }
    prevStates.current = next;
  }, [stateQ.data]);

  // ── Keyboard ──
  const lastG = useRef(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "g") { lastG.current = Date.now(); return; }
      if (lastG.current && Date.now() - lastG.current < 800) {
        const map: Record<string, ViewKey> = { o: "overview", r: "run", a: "activity", g: "agents" };
        const next = map[e.key];
        if (next) { setView(next); lastG.current = 0; }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const refetchAll = useCallback(async () => {
    await Promise.all([stateQ.refetch(), agentsQ.refetch(), runningQ.refetch()]);
  }, [stateQ, agentsQ, runningQ]);

  const clearActivity = useCallback(() => setActivityEntries([]), []);

  // ── Derived ──
  const agentStatuses = stateQ.data?.agents ?? [];
  const workingCount = agentStatuses.filter((a) => a.state === "working").length;
  const isRunning = runningQ.data?.pid != null;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Project Bar (디스코드 스타일) ── */}
      <ProjectBar
        currentProject={currentProject}
        onProjectChange={handleProjectChange}
        onStartRequest={(id) => setStartModal(id)}
      />

      {/* ── Sidebar ── */}
      <aside
        onMouseEnter={() => setSidebarHover(true)}
        onMouseLeave={() => setSidebarHover(false)}
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ease-out shrink-0",
          sidebarHover ? "w-[200px]" : "w-[56px]"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-sidebar-border shrink-0">
          <span className="font-bold text-[11px] bg-primary/15 text-primary border border-primary/30 px-1.5 py-0.5 rounded font-mono shrink-0">
            VC
          </span>
          <span className={cn(
            "text-sm font-semibold text-sidebar-accent-foreground truncate transition-opacity duration-150",
            sidebarHover ? "opacity-100" : "opacity-0 w-0"
          )}>
            {stateQ.data?.project ?? "Company"}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const active = view === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                title={!sidebarHover ? `${item.label} (${item.shortcut})` : undefined}
                onClick={() => setView(item.key)}
                className={cn(
                  "flex items-center gap-3 px-2.5 py-2 rounded-md text-sm transition-colors duration-100 relative",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-primary" />
                )}
                <Icon className="size-4 shrink-0" />
                <span className={cn(
                  "truncate transition-opacity duration-150",
                  sidebarHover ? "opacity-100" : "opacity-0 w-0"
                )}>
                  {item.label}
                </span>
                {item.key === "run" && isRunning && (
                  <span className="size-1.5 rounded-full bg-vc-green animate-pulse ml-auto shrink-0" />
                )}
                {item.key === "activity" && activityEntries.length > 0 && sidebarHover && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto shrink-0">
                    {activityEntries.length}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar footer: agent mini status */}
        <div className="border-t border-sidebar-border px-2 py-3 flex flex-col gap-1">
          {/* Connection dot */}
          <div className="flex items-center gap-2.5 px-2.5 py-1">
            <Circle className={cn("size-2 fill-current shrink-0", sseConnected ? "text-vc-green" : "text-vc-amber")} />
            <span className={cn(
              "text-[11px] text-sidebar-foreground truncate transition-opacity duration-150",
              sidebarHover ? "opacity-100" : "opacity-0 w-0"
            )}>
              {sseConnected ? "Connected" : "Reconnecting"}
            </span>
          </div>

          {/* Mini agent list */}
          {agentStatuses.slice(0, 6).map((a) => (
            <div
              key={a.id}
              title={`${a.id} — ${a.state}`}
              className="flex items-center gap-2.5 px-2.5 py-0.5"
            >
              <Circle
                className={cn(
                  "size-2 fill-current shrink-0",
                  a.state === "working" ? "text-vc-indigo animate-pulse" :
                  a.state === "done" ? "text-vc-green" :
                  a.state === "error" ? "text-vc-red" :
                  "text-muted-foreground/40"
                )}
              />
              <span className={cn(
                "text-[11px] font-mono text-sidebar-foreground truncate transition-opacity duration-150",
                sidebarHover ? "opacity-100" : "opacity-0 w-0"
              )}>
                {a.id.split("-").map((s) => s[0]?.toUpperCase()).join("")}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0 bg-background">
          <h1 className="text-sm font-semibold">
            {NAV_ITEMS.find((n) => n.key === view)?.label}
            {view === "run" && isRunning && (
              <Badge variant="outline" className="ml-2 text-[10px] border-vc-green/50 text-vc-green">
                running
              </Badge>
            )}
            {view === "agents" && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                {agentsQ.data?.agents?.length ?? 0} agents
              </span>
            )}
          </h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono tabular-nums">
            {workingCount > 0 && (
              <span className="text-vc-indigo">{workingCount} working</span>
            )}
            <Clock />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Inactive 배너 */}
          {currentProject && !projectActive && (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg border border-vc-amber/30 bg-vc-amber-muted">
              <AlertTriangle className="size-4 text-vc-amber shrink-0" />
              <div className="flex-1 text-sm">
                <span className="font-medium text-vc-amber">{currentProject}</span>
                <span className="text-muted-foreground"> 회사가 실행중이지 않습니다</span>
              </div>
              <Button
                variant="outline"
                size="xs"
                className="gap-1.5 border-vc-amber/30 text-vc-amber hover:bg-vc-amber/10"
                onClick={() => setStartModal(currentProject)}
              >
                <Play className="size-3" />
                시작
              </Button>
              <span className="text-[10px] text-muted-foreground font-mono">
                tmux attach -t vc-{currentProject}
              </span>
            </div>
          )}

          {view === "overview" && (
            <OverviewTab state={stateQ.data} agents={agentsQ.data} activityEntries={activityEntries} onOpenTerminal={openTerminal} projectActive={projectActive} />
          )}
          {view === "run" && (
            <WorkflowsTab workflows={workflowsQ.data?.workflows ?? []} running={runningQ.data} onRefetch={refetchAll} />
          )}
          {view === "activity" && (
            <ActivityTab entries={activityEntries} onClear={clearActivity} />
          )}
          {view === "tickets" && (
            <TicketsTab state={stateQ.data} agents={agentsQ.data} />
          )}
          {view === "agents" && (
            <AgentsTab state={stateQ.data} agents={agentsQ.data} onRefetch={refetchAll} onOpenTerminal={openTerminal} />
          )}
          {view === "skills" && <SkillsTab />}
          {view === "health" && <HealthTab />}
          {view === "retro" && <RetroTab />}
          {view === "profile" && <AgentProfileTab agents={agentsQ.data?.agents ?? null} />}
        </main>

        {/* 시작 모달 */}
        {startModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !starting && setStartModal(null)}>
            <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold mb-3">회사 시작</h3>
              <p className="text-sm text-muted-foreground mb-4">
                <span className="font-medium text-foreground">{startModal}</span> 프로젝트의 가상 회사를 시작하시겠습니까?
              </p>
              <p className="text-xs text-muted-foreground mb-4 bg-muted/50 p-3 rounded font-mono">
                tmux 세션이 생성되고 에이전트별 Claude 인스턴스가 실행됩니다.
                <br /><br />
                터미널에서 직접 확인하려면:
                <br />
                <span className="text-foreground">tmux attach -t vc-{startModal}</span>
                <br /><br />
                세션 목록 확인:
                <br />
                <span className="text-foreground">tmux list-sessions</span>
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStartModal(null)} disabled={starting}>
                  취소
                </Button>
                <Button variant="default" size="sm" className="gap-1.5" onClick={handleStartFromModal} disabled={starting}>
                  {starting ? <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="size-3" />}
                  시작
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 터미널 패널 — 에이전트 선택 시 하단에 표시 */}
        {terminalAgent && (
          <TerminalPanel
            projectId={currentProject}
            agentId={terminalAgent}
            onClose={closeTerminal}
          />
        )}

        <StatusBar healthy={stateQ.healthy} lastUpdated={stateQ.lastUpdated} />
      </div>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
    setTime(fmt());
    const t = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{time}</span>;
}
