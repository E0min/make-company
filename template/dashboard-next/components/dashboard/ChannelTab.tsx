"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelLines } from "./OverviewTab";
import type { ChannelResponse } from "@/lib/types";

interface Props {
  data: ChannelResponse | null;
}

export function ChannelTab({ data }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const lines = data?.lines ?? [];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolled.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || userScrolled.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold mb-4">Team Channel</h2>
        <div
          ref={ref}
          className="h-[60vh] overflow-y-auto bg-muted/30 border border-border rounded-md p-4"
        >
          <ChannelLines lines={lines} />
        </div>
      </CardContent>
    </Card>
  );
}
