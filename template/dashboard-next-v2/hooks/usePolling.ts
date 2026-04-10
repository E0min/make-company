"use client";

import { useEffect, useRef, useState } from "react";

interface Options {
  interval?: number; // ms
  enabled?: boolean;
}

interface Result<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  healthy: boolean;
  lastUpdated: number | null;
  refetch: () => Promise<void>;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  { interval = 1500, enabled = true }: Options = {}
): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [healthy, setHealthy] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = async () => {
    try {
      const result = await fetcher();
      if (cancelled.current) return;
      setData(result);
      setError(null);
      setHealthy(true);
      setLastUpdated(Date.now());
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setHealthy(false);
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  };

  useEffect(() => {
    cancelled.current = false;
    if (!enabled) return;

    const tick = async () => {
      await run();
      if (!cancelled.current) {
        timer.current = setTimeout(tick, interval);
      }
    };
    tick();

    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, enabled]);

  return { data, error, loading, healthy, lastUpdated, refetch: run };
}
