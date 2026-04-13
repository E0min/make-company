"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { X, Maximize2, Minimize2, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── xterm.js 다크 테마 (대시보드 색상 시스템과 일치) ── */
const TERMINAL_THEME = {
  background: "#09090b",   /* zinc-950 — 패널 배경 */
  foreground: "#fafafa",   /* zinc-50 — 기본 텍스트 */
  cursor: "#6366f1",       /* indigo-500 — 커서 색상 */
  selectionBackground: "#6366f140", /* indigo-500/25 — 선택 배경 */
  black: "#09090b",        /* zinc-950 */
  red: "#f87171",          /* red-400 — 에러 메시지 */
  green: "#34d399",        /* emerald-400 — 성공 메시지 */
  yellow: "#f59e0b",       /* amber-500 — 경고 메시지 */
  blue: "#60a5fa",         /* blue-400 — 정보 */
  magenta: "#e879f9",      /* fuchsia-400 */
  cyan: "#2dd4bf",         /* teal-400 */
  white: "#fafafa",        /* zinc-50 */
};

interface Props {
  projectId: string | null;
  agentId: string | null;
  onClose: () => void;
}

/**
 * VS Code 스타일 하단 터미널 패널.
 * xterm.js로 에이전트 터미널을 실시간 표시 + 직접 키보드 입력.
 *
 * 라이프사이클:
 * 1. 마운트 → POST /terminal/{agent}/open → tmux pane 크기 수신 → xterm.js가 그 크기에 맞춤
 * 2. 500ms 간격으로 GET /terminal/{agent}/read?since={offset} 폴링
 * 3. xterm onData → POST /terminal/{agent}/write (raw 키 입력 → tmux send-keys -l)
 * 4. 언마운트 → POST /terminal/{agent}/close
 */
export function TerminalPanel({ projectId, agentId, onClose }: Props) {
  /* ── refs ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<InstanceType<typeof import("@xterm/xterm").Terminal> | null>(null);
  const fitAddonRef = useRef<InstanceType<typeof import("@xterm/addon-fit").FitAddon> | null>(null);
  const offsetRef = useRef<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /* ── state ── */
  const [maximized, setMaximized] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [panelHeight, setPanelHeight] = useState(280);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  /* ── xterm 초기화 (dynamic import로 CSS 포함) ── */
  useEffect(() => {
    if (!agentId || !containerRef.current) return;

    /* agentId를 로컬 변수로 캡처 (closure 안에서 non-null 보장) */
    const agent = agentId;
    let cancelled = false;
    let term: InstanceType<typeof import("@xterm/xterm").Terminal> | null = null;
    let fitAddon: InstanceType<typeof import("@xterm/addon-fit").FitAddon> | null = null;

    async function init() {
      /* CSS와 모듈을 dynamic import (static export 호환) */
      await import("@xterm/xterm/css/xterm.css");
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { CanvasAddon } = await import("@xterm/addon-canvas");

      if (cancelled || !containerRef.current) return;

      /* 터미널 인스턴스 생성 — stdin 활성화 (실제 터미널처럼 직접 입력) */
      fitAddon = new FitAddon();
      term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 5000,
        convertEol: true,       /* \n → \r\n 자동 변환 */
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      /* Canvas 렌더러 로드 (xterm v6에서 필수 — write 전에 로드해야 렌더링됨) */
      try {
        const canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch {
        /* WebGL/Canvas 미지원 환경에서는 DOM 폴백 */
      }
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      setTerminalReady(true);

      /* Canvas addon 로드 후 여러 타이밍에 fit 재시도 (레이아웃 안정화 대기) */
      [50, 150, 300].forEach((ms) =>
        setTimeout(() => {
          if (!cancelled && fitAddonRef.current) {
            try { fitAddonRef.current.fit(); } catch { /* ignore */ }
          }
        }, ms)
      );

      /* ── 키보드 입력 → tmux send-keys (실제 터미널처럼 동작) ── */
      term.onData((data) => {
        if (!cancelled) {
          api.terminalWrite(agent, data).catch(() => { /* 전송 실패 무시 */ });
        }
      });

      /* 터미널 클릭 시 포커스 (키보드 입력 받기 위해) */
      term.focus();

      /* 터미널 세션 열기 — tmux pane 크기를 읽어서 xterm.js가 맞춤 (tmux를 리사이즈하지 않음) */
      try {
        const res = await api.terminalOpen(agent);
        if (cancelled) return;

        if (res.ok) {
          setConnected(true);
          setError(null);

          /* ── tmux pane 크기에 xterm.js 맞추기 ── */
          const tmuxCols = (res as { cols?: number }).cols;
          const tmuxRows = (res as { rows?: number }).rows;
          if (tmuxCols && tmuxRows && term) {
            term.resize(tmuxCols, tmuxRows);
          }

          /* 스크롤백이 있으면 출력 */
          const scrollback = (res as { scrollback?: string }).scrollback;
          const offset = (res as { offset?: number }).offset;
          offsetRef.current = offset ?? 0;
          if (scrollback) {
            /* Canvas addon은 여러 rAF 사이클 후에야 렌더링 가능.
               rAF 3회 대기 후 reset → write로 확실하게 렌더링 */
            const waitFrames = (n: number, cb: () => void) => {
              if (n <= 0) { cb(); return; }
              requestAnimationFrame(() => waitFrames(n - 1, cb));
            };
            waitFrames(3, () => {
              if (cancelled || !termRef.current) return;
              termRef.current.reset();
              /* tmux 크기 재적용 후 스크롤백 렌더 */
              if (tmuxCols && tmuxRows) {
                termRef.current.resize(tmuxCols, tmuxRows);
              }
              termRef.current.write(scrollback, () => {
                if (termRef.current) termRef.current.scrollToBottom();
              });
            });
          }

          /* 폴링 시작: 500ms 간격으로 새 데이터 읽기 */
          pollingRef.current = setInterval(async () => {
            if (cancelled) return;
            try {
              const readRes = await api.terminalRead(agent, offsetRef.current);
              if (readRes.data && readRes.data.length > 0 && termRef.current) {
                termRef.current.write(readRes.data);
                offsetRef.current = readRes.offset;
              }
            } catch {
              /* 폴링 에러는 무시 (재시도) */
            }
          }, 500);
        } else {
          const errMsg = (res as { error?: string }).error ?? "터미널을 열 수 없습니다";
          setError(errMsg);
          term.writeln(`\x1b[31m${errMsg}\x1b[0m`);
          toast.error(errMsg);
          onCloseRef.current();
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        term?.writeln(`\x1b[31mConnection error: ${msg}\x1b[0m`);
        toast.error(msg || "터미널 연결 실패");
        onCloseRef.current();
      }
    }

    init();

    /* 클린업 */
    return () => {
      cancelled = true;
      setTerminalReady(false);

      /* 폴링 중지 */
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }

      /* 터미널 세션 닫기 (fire-and-forget) */
      api.terminalClose(agent).catch(() => {});

      /* xterm 인스턴스 정리 (Canvas addon dispose가 크래시할 수 있음) */
      if (termRef.current) {
        try { termRef.current.dispose(); } catch { /* ignore */ }
        termRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [agentId]);

  /* maximized 상태 변경 시 fit 재조정 */
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          /* ignore */
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [maximized]);

  /* ResizeObserver로 컨테이너 크기 변경 감지 → fit 재조정 */
  useEffect(() => {
    if (!containerRef.current || !terminalReady) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          /* fit() 실패 무시 */
        }
      }
    });
    observer.observe(containerRef.current);

    /* 초기 fit — 여러 타이밍에 시도 (CSS 로드 + 레이아웃 안정화) */
    const timers = [100, 300, 500, 1000].map((ms) =>
      setTimeout(() => {
        if (fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch {
            /* ignore */
          }
        }
      }, ms)
    );

    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [terminalReady]);

  /* ── 드래그 리사이즈 핸들러 ── */
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const newH = Math.max(120, Math.min(window.innerHeight * 0.85, dragRef.current.startH + delta));
      setPanelHeight(newH);
    };
    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      // 리사이즈 완료 후 xterm fit
      setTimeout(() => { try { fitAddonRef.current?.fit(); } catch {} }, 50);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  if (!agentId) return null;

  return (
    <div
      className={cn(
        /* 패널 기본: 하단 고정, 가로 전폭 */
        "flex flex-col border-t border-border bg-[#09090b] shrink-0 w-full overflow-hidden",
        maximized && "!h-[70vh]"
      )}
      style={maximized ? undefined : { height: panelHeight }}
    >
      {/* ── 리사이즈 핸들 (상단 드래그 바) ── */}
      <div
        className="h-1.5 w-full cursor-ns-resize hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors shrink-0 flex items-center justify-center"
        onMouseDown={handleDragStart}
      >
        <div className="w-8 h-0.5 rounded-full bg-zinc-600" />
      </div>
      {/* ── 헤더 바 ── */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border/50 shrink-0 select-none">
        {/* 좌측: 아이콘 + 에이전트 이름 */}
        <div className="flex items-center gap-2">
          <TerminalIcon className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-mono font-semibold text-foreground">
            {agentId}
          </span>
          {/* 연결 상태 표시 */}
          <span
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-vc-green" : error ? "bg-vc-red" : "bg-vc-amber animate-pulse"
            )}
          />
          {error && (
            <span className="text-[10px] text-vc-red font-mono truncate max-w-48">
              {error}
            </span>
          )}
        </div>

        {/* 우측: 최대화/최소화 + 닫기 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setMaximized((v) => !v)}
            title={maximized ? "Minimize" : "Maximize"}
          >
            {maximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title="Close terminal"
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>

      {/* ── xterm.js 렌더링 영역 (직접 키보드 입력 지원) ── */}
      <style>{`
        .xterm-terminal-panel .xterm { width: 100% !important; height: 100% !important; }
        .xterm-terminal-panel .xterm-viewport {
          width: 100% !important;
          overflow-y: auto !important;
          scrollbar-width: thin;
          scrollbar-color: #333 transparent;
        }
        .xterm-terminal-panel .xterm-viewport::-webkit-scrollbar { width: 6px; }
        .xterm-terminal-panel .xterm-viewport::-webkit-scrollbar-thumb {
          background: #444; border-radius: 3px;
        }
        .xterm-terminal-panel .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
        .xterm-terminal-panel .xterm-screen { width: 100% !important; }
      `}</style>
      <div
        ref={containerRef}
        className="xterm-terminal-panel flex-1 min-h-0 overflow-hidden"
        style={{ width: "100%", padding: 0 }}
      />
    </div>
  );
}
