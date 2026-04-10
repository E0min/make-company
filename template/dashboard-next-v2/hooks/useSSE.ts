"use client";

import { useEffect, useRef } from "react";
import { connectSSE } from "../lib/api";
import type { SSEEvent } from "../lib/types";

interface UseSSEOptions {
  /** false로 설정하면 SSE 연결을 맺지 않음 */
  enabled?: boolean;
  /** 재연결 간격(ms). 기본 3000 */
  reconnectInterval?: number;
  /** 프로젝트 ID — 바뀌면 SSE 자동 재연결 */
  project?: string | null;
}

/**
 * /api/sse (또는 /api/{project}/sse) Server-Sent Events 스트림을 구독하는 훅.
 *
 * @param onActivity  - activity.log 새 줄이 들어올 때 호출 (raw line)
 * @param onAgentOutput - agent-output 새 내용이 들어올 때 호출 (agent id, data)
 * @param options - enabled, reconnectInterval, project
 */
export function useSSE(
  onActivity: (line: string) => void,
  onAgentOutput: (agent: string, data: string) => void,
  options: UseSSEOptions = {}
): void {
  const { enabled = true, reconnectInterval = 3000, project } = options;

  // 최신 콜백을 ref로 유지 (리렌더 시 재연결 방지)
  const onActivityRef = useRef(onActivity);
  const onAgentOutputRef = useRef(onAgentOutput);
  onActivityRef.current = onActivity;
  onAgentOutputRef.current = onAgentOutput;

  useEffect(() => {
    if (!enabled) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      // project가 있으면 /api/{project}/sse, 없으면 /api/sse
      es = connectSSE(
        (event: SSEEvent) => {
          if (event.type === "activity") {
            onActivityRef.current(event.data);
          } else if (event.type === "agent_output") {
            onAgentOutputRef.current(event.agent, event.data);
          }
        },
        () => {
          // 에러 시 자동 재연결
          if (disposed) return;
          es?.close();
          es = null;
          reconnectTimer = setTimeout(connect, reconnectInterval);
        },
        project
      );
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
    // project가 변경되면 SSE 재연결
  }, [enabled, reconnectInterval, project]);
}
