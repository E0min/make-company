"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Play, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Project {
  id: string;
  path: string;
  registered_at: string;
  active?: boolean;
}

interface Props {
  currentProject: string | null;
  onProjectChange: (id: string) => void;
  onStartRequest?: (id: string) => void;
}

/**
 * Discord 서버 목록 스타일의 세로 프로젝트 선택 바.
 * 왼쪽 끝에 위치하며, 각 프로젝트를 이니셜 + 해시 색상 원형 버튼으로 표시.
 */
export function ProjectBar({ currentProject, onProjectChange, onStartRequest }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  const handleStart = async (id: string) => {
    setLoading(id);
    const res = await api.companyStart(id);
    if (res.ok) toast.success(`${id} 시작됨`);
    else toast.error(res.error || "시작 실패");
    setLoading(null);
    // 상태 즉시 갱신
    api.projects().then((r) => { if (r.projects) setProjects(r.projects); });
  };

  const handleStop = async (id: string) => {
    if (!confirm(`"${id}" 회사를 종료하시겠습니까?`)) return;
    setLoading(id);
    const res = await api.companyStop(id);
    if (res.ok) toast.success(`${id} 종료됨`);
    else toast.error(res.error || "종료 실패");
    setLoading(null);
    // 상태 즉시 갱신
    api.projects().then((r) => { if (r.projects) setProjects(r.projects); });
  };

  useEffect(() => {
    // 초기 로드
    api.projects().then((res) => {
      if (res.projects) setProjects(res.projects);
    });

    // 10초마다 갱신 (새 프로젝트 등록 감지)
    const t = setInterval(() => {
      api.projects().then((res) => {
        if (res.projects) setProjects(res.projects);
      });
    }, 10_000);

    return () => clearInterval(t);
  }, []);

  return (
    <div
      className={cn(
        /* 고정 폭 세로 바 */
        "w-[52px] shrink-0 flex flex-col items-center py-3 gap-2",
        /* 디스코드 스타일 짙은 배경 */
        "bg-[oklch(0.08_0.005_285)]",
        /* 우측 테두리 */
        "border-r border-sidebar-border",
        /* 프로젝트 많을 때 스크롤 */
        "overflow-y-auto"
      )}
    >
      {projects.map((p) => {
        const active = currentProject === p.id;
        // 프로젝트 ID 앞 2글자를 이니셜로 사용
        const initials = p.id.slice(0, 2).toUpperCase();

        // 해시 기반 hue 계산 — 프로젝트마다 고유 색상
        let h = 0;
        for (let i = 0; i < p.id.length; i++) {
          h = p.id.charCodeAt(i) + ((h << 5) - h);
        }
        const hue = Math.abs(h) % 360;

        const isOnline = p.active !== false;

        const isLoading = loading === p.id;

        return (
          <button
            key={p.id}
            title={`${p.id}${isOnline ? "" : " (offline)"}`}
            onClick={() => {
              onProjectChange(p.id);
              if (!isOnline && onStartRequest) onStartRequest(p.id);
            }}
            className={cn(
              /* group으로 감싸서 호버 시 자식 오버레이 제어 */
              "group",
              "relative w-10 h-10 rounded-[20px] flex items-center justify-center",
              "text-[11px] font-bold transition-all duration-200",
              active
                ? "rounded-[12px] text-white"
                : "text-muted-foreground hover:rounded-[12px] hover:brightness-125",
              !isOnline && !active && "opacity-40"
            )}
            style={{
              backgroundColor: active
                ? `hsl(${hue}, 50%, 40%)`
                : isOnline
                  ? `hsl(${hue}, 30%, 20%)`
                  : `hsl(${hue}, 10%, 15%)`,
            }}
          >
            {/* 왼쪽 활성 인디케이터 (디스코드 pill) */}
            {active && (
              <span
                className={cn(
                  "absolute left-[-6px] top-1/2 -translate-y-1/2",
                  "w-[4px] h-5 rounded-r-full bg-white"
                )}
              />
            )}
            {/* 온라인/오프라인 dot */}
            <span
              className={cn(
                "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-[oklch(0.08_0.005_285)]",
                isOnline ? "bg-vc-green" : "bg-muted-foreground/50"
              )}
            />
            {/* 호버 시 Start/Stop 오버레이 */}
            <span
              className={cn(
                "absolute -bottom-1 -right-1 size-4 rounded-full flex items-center justify-center",
                "opacity-0 group-hover:opacity-100 transition-opacity z-10",
                "text-[8px] cursor-pointer",
                isOnline ? "bg-vc-red text-white" : "bg-vc-green text-white"
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (isLoading) return;
                isOnline ? handleStop(p.id) : handleStart(p.id);
              }}
              title={isOnline ? "회사 종료" : "회사 시작"}
            >
              {isLoading ? (
                <Loader2 className="size-2 animate-spin" />
              ) : isOnline ? (
                <Square className="size-2" />
              ) : (
                <Play className="size-2" />
              )}
            </span>
            {initials}
          </button>
        );
      })}

      {/* 구분선 */}
      {projects.length > 0 && (
        <div className="w-6 h-px bg-sidebar-border" />
      )}

      {/* 새 프로젝트 추가 버튼 */}
      <button
        title="새 프로젝트에서 /company dashboard 실행"
        className={cn(
          "w-10 h-10 rounded-[20px] flex items-center justify-center",
          "text-muted-foreground",
          "hover:text-vc-green hover:bg-vc-green/10 hover:rounded-[12px]",
          "transition-all duration-200"
        )}
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
