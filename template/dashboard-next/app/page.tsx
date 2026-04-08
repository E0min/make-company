"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { Header } from "@/components/dashboard/Header";
import { StatusBar } from "@/components/dashboard/StatusBar";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { WorkflowsTab } from "@/components/dashboard/WorkflowsTab";
import { AgentsTab } from "@/components/dashboard/AgentsTab";
import { KnowledgeTab } from "@/components/dashboard/KnowledgeTab";
import { ChannelTab } from "@/components/dashboard/ChannelTab";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import type { Agent } from "@/lib/types";

const TABS = ["overview", "workflows", "agents", "knowledge", "channel"] as const;
type TabKey = (typeof TABS)[number];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const stateQ = usePolling(() => api.state(), { interval: 1500 });
  const channelQ = usePolling(() => api.channel(), { interval: 2000 });
  const workflowsQ = usePolling(() => api.workflows(), { interval: 2500 });
  const tasksQ = usePolling(() => api.tasks(), { interval: 3000 });
  const knowledgeQ = usePolling(() => api.knowledge(), { interval: 5000 });

  // Detect agent state changes and emit toasts.
  const prevStates = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const agents = stateQ.data?.agents ?? [];
    const next = new Map<string, string>();
    for (const a of agents) {
      next.set(a.id, a.state);
      const prev = prevStates.current.get(a.id);
      if (prev && prev !== a.state) {
        if (
          a.state === "error" ||
          a.state === "permanently-failed" ||
          a.state === "dead"
        ) {
          toast.error(`${a.label} 오류`, { description: a.state });
        } else if (a.state === "done") {
          toast.success(`${a.label} 완료`);
        } else if (a.state === "rate-limited") {
          toast.warning(`${a.label} rate-limited`);
        }
      }
    }
    prevStates.current = next;
  }, [stateQ.data]);

  // Keyboard shortcuts.
  const lastG = useRef<number>(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const isInput =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isInput) return;

      if (e.key === "?") {
        e.preventDefault();
        toast.info("Shortcuts", {
          description: "g+o/w/a/k/c · n · ⌘K · ESC",
        });
        return;
      }

      if (e.key === "g") {
        lastG.current = Date.now();
        return;
      }
      if (lastG.current && Date.now() - lastG.current < 800) {
        const map: Record<string, TabKey> = {
          o: "overview",
          w: "workflows",
          a: "agents",
          k: "knowledge",
          c: "channel",
        };
        const next = map[e.key];
        if (next) {
          setTab(next);
          lastG.current = 0;
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const jump = useCallback((t: string) => {
    if ((TABS as readonly string[]).includes(t)) {
      setTab(t as TabKey);
    }
  }, []);

  const agents: Agent[] = stateQ.data?.agents ?? [];
  const workingCount = agents.filter((a) => a.state === "working").length;
  const wfActive = workflowsQ.data?.active?.length ?? 0;

  return (
    <>
      <Header state={stateQ.data} onOpenPalette={() => setPaletteOpen(true)} />

      <main className="flex-1 px-5 py-5 pb-12 max-w-[1400px] w-full mx-auto">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="mb-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="workflows" className="gap-1.5">
              Workflows
              {wfActive > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  {wfActive}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-1.5">
              Agents
              {agents.length > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  {agents.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="channel">Channel</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              state={stateQ.data}
              workflows={workflowsQ.data}
              channel={channelQ.data}
              tasks={tasksQ.data}
              onJump={jump}
            />
          </TabsContent>

          <TabsContent value="workflows">
            <WorkflowsTab
              data={workflowsQ.data}
              onRefetch={workflowsQ.refetch}
            />
          </TabsContent>

          <TabsContent value="agents">
            <AgentsTab state={stateQ.data} onRefetch={stateQ.refetch} />
          </TabsContent>

          <TabsContent value="knowledge">
            <KnowledgeTab data={knowledgeQ.data} />
          </TabsContent>

          <TabsContent value="channel">
            <ChannelTab data={channelQ.data} />
          </TabsContent>
        </Tabs>
      </main>

      <StatusBar
        healthy={stateQ.healthy}
        lastUpdated={stateQ.lastUpdated}
        agentCount={agents.length}
        workingCount={workingCount}
        workflowCount={wfActive}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onJump={jump}
        onNewWorkflow={() => jump("workflows")}
        onNewAgent={() => jump("agents")}
        agents={agents}
        workflows={workflowsQ.data?.templates ?? []}
      />
    </>
  );
}
