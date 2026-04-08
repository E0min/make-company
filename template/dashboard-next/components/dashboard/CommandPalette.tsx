"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutGrid,
  Workflow,
  Users,
  BookOpen,
  MessageSquare,
  Plus,
  UserPlus,
} from "lucide-react";
import type { Agent, WorkflowTemplate } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onJump: (tab: string) => void;
  onNewWorkflow: () => void;
  onNewAgent: () => void;
  agents: Agent[];
  workflows: WorkflowTemplate[];
}

export function CommandPalette({
  open,
  onOpenChange,
  onJump,
  onNewWorkflow,
  onNewAgent,
  agents,
  workflows,
}: Props) {
  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => onJump("overview"))}>
            <LayoutGrid className="size-3.5" />
            <span>Go to Overview</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">g o</kbd>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onJump("workflows"))}>
            <Workflow className="size-3.5" />
            <span>Go to Workflows</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">g w</kbd>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onJump("agents"))}>
            <Users className="size-3.5" />
            <span>Go to Agents</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">g a</kbd>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onJump("knowledge"))}>
            <BookOpen className="size-3.5" />
            <span>Go to Knowledge</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">g k</kbd>
          </CommandItem>
          <CommandItem onSelect={() => run(() => onJump("channel"))}>
            <MessageSquare className="size-3.5" />
            <span>Go to Channel</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">g c</kbd>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onNewWorkflow)}>
            <Plus className="size-3.5" />
            <span>New Workflow</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">n</kbd>
          </CommandItem>
          <CommandItem onSelect={() => run(onNewAgent)}>
            <UserPlus className="size-3.5" />
            <span>Add Agent</span>
            <kbd className="ml-auto text-[10px] text-muted-foreground">N</kbd>
          </CommandItem>
        </CommandGroup>

        {agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Agents">
              {agents.map((a) => (
                <CommandItem
                  key={a.id}
                  onSelect={() => run(() => onJump("agents"))}
                >
                  <Users className="size-3.5" />
                  <span>{a.label}</span>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {a.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {workflows.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Workflows">
              {workflows.map((w) => (
                <CommandItem
                  key={w.file}
                  onSelect={() => run(() => onJump("workflows"))}
                >
                  <Workflow className="size-3.5" />
                  <span>{w.title}</span>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {w.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
