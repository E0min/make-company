"use client";

import { useCallback } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  Circle,
  Ticket as TicketIcon,
  Plus,
  Terminal,
  LayoutDashboard,
  GitBranch,
  ScrollText,
  Users,
  Package,
  Activity,
  History,
  UserCircle,
  FileText,
  Shield,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/format";
import type { Ticket as TicketType, AgentStatus } from "@/lib/types";

// ━━━ 티켓 상태별 색상 매핑 ━━━

const STATUS_COLOR: Record<string, string> = {
  backlog: "text-zinc-500",
  todo: "text-blue-400",
  in_progress: "text-indigo-400",
  review: "text-amber-400",
  done: "text-emerald-400",
};

// ━━━ Navigation items ━━━

const NAV_COMMANDS: { key: string; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="size-4 text-muted-foreground" />, shortcut: "g o" },
  { key: "tickets", label: "Tickets", icon: <Ticket className="size-4 text-muted-foreground" />, shortcut: "g k" },
  { key: "run", label: "Workflows", icon: <GitBranch className="size-4 text-muted-foreground" />, shortcut: "g r" },
  { key: "activity", label: "Activity", icon: <ScrollText className="size-4 text-muted-foreground" />, shortcut: "g a" },
  { key: "agents", label: "Agents", icon: <Users className="size-4 text-muted-foreground" />, shortcut: "g g" },
  { key: "health", label: "Health", icon: <Activity className="size-4 text-muted-foreground" />, shortcut: "g h" },
  { key: "harness", label: "Harness", icon: <Shield className="size-4 text-muted-foreground" />, shortcut: "g n" },
  { key: "audit", label: "Audit", icon: <ShieldCheck className="size-4 text-muted-foreground" />, shortcut: "g u" },
  { key: "retro", label: "Retro", icon: <History className="size-4 text-muted-foreground" />, shortcut: "g t" },
  { key: "skills", label: "Skills", icon: <Package className="size-4 text-muted-foreground" />, shortcut: "g s" },
  { key: "profile", label: "Profile", icon: <UserCircle className="size-4 text-muted-foreground" />, shortcut: "g p" },
  { key: "docs", label: "Docs", icon: <FileText className="size-4 text-muted-foreground" />, shortcut: "g d" },
];

// ━━━ Props ━━━

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tickets: TicketType[];
  agents: AgentStatus[];
  onSelectTicket: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onCreateTicket: () => void;
  onCreateGoal?: () => void;
  onNavigate?: (tab: string) => void;
}

// ━━━ 메인 컴포넌트 ━━━

export function CommandPalette({
  open,
  onOpenChange,
  tickets,
  agents,
  onSelectTicket,
  onSelectAgent,
  onCreateTicket,
  onCreateGoal,
  onNavigate,
}: CommandPaletteProps) {
  const handleSelect = useCallback(
    (value: string) => {
      if (value.startsWith("ticket:")) {
        onSelectTicket(value.replace("ticket:", ""));
        onOpenChange(false);
      } else if (value.startsWith("agent:")) {
        onSelectAgent(value.replace("agent:", ""));
        onOpenChange(false);
      } else if (value.startsWith("nav:")) {
        onNavigate?.(value.replace("nav:", ""));
        onOpenChange(false);
      } else if (value === "action:create-ticket") {
        onCreateTicket();
        onOpenChange(false);
      } else if (value === "action:create-goal" && onCreateGoal) {
        onCreateGoal();
        onOpenChange(false);
      }
    },
    [onSelectTicket, onSelectAgent, onCreateTicket, onCreateGoal, onNavigate, onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="티켓, 에이전트, 액션을 검색하세요"
    >
      <CommandInput placeholder="검색..." />
      <CommandList>
        <CommandEmpty>결과가 없습니다</CommandEmpty>

        {/* 빠른 액션 */}
        <CommandGroup heading="액션">
          <CommandItem
            value="action:create-ticket"
            onSelect={handleSelect}
          >
            <Plus className="size-4 text-muted-foreground" />
            <span>새 티켓 만들기</span>
            <CommandShortcut>c</CommandShortcut>
          </CommandItem>
          {onCreateGoal && (
            <CommandItem
              value="action:create-goal"
              onSelect={handleSelect}
            >
              <Plus className="size-4 text-muted-foreground" />
              <span>새 목표 만들기</span>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* 네비게이션 */}
        <CommandGroup heading="네비게이션">
          {NAV_COMMANDS.map((nav) => (
            <CommandItem
              key={nav.key}
              value={`nav:${nav.key}`}
              keywords={[nav.label, nav.key]}
              onSelect={handleSelect}
            >
              {nav.icon}
              <span>{nav.label}</span>
              <CommandShortcut>{nav.shortcut}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* 티켓 */}
        {tickets.length > 0 && (
          <CommandGroup heading="티켓">
            {tickets.slice(0, 20).map((t) => (
              <CommandItem
                key={t.id}
                value={`ticket:${t.id}`}
                keywords={[t.id, t.title, t.status, t.assignee ?? ""]}
                onSelect={handleSelect}
              >
                <TicketIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    STATUS_COLOR[t.status] ?? "text-muted-foreground",
                  )}
                />
                <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                  {t.id}
                </span>
                <span className="truncate">{t.title}</span>
                <Badge
                  variant="outline"
                  className="ml-auto text-[9px] h-4 px-1 shrink-0"
                >
                  {t.status.replace("_", " ")}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* 에이전트 */}
        {agents.length > 0 && (
          <CommandGroup heading="에이전트">
            {agents.map((a) => {
              const c = stateColor(a.state);
              return (
                <CommandItem
                  key={a.id}
                  value={`agent:${a.id}`}
                  keywords={[a.id, a.state]}
                  onSelect={handleSelect}
                >
                  <Circle
                    className={cn(
                      "size-2.5 fill-current shrink-0",
                      c.text,
                    )}
                  />
                  <span className="truncate">{a.id}</span>
                  <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0">
                    <Terminal className="size-3" />
                    {a.state}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
