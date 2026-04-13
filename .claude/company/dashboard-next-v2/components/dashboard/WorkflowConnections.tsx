"use client";

import { useLayoutEffect, useState, useCallback } from "react";
import type { WorkflowStep } from "@/lib/types";

// ━━━ Props ━━━

interface Props {
  steps: WorkflowStep[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// ━━━ Topology Sort → Layer 계산 ━━━

/**
 * 토폴로지 소트로 DAG 레이어를 계산한다.
 * - Layer 0: depends_on이 빈 스텝
 * - Layer N: 모든 deps가 Layer 0~N-1에 있는 스텝
 *
 * 순환 의존성이 있으면 나머지를 마지막 레이어에 몰아넣는다.
 */
export function computeLayers(steps: WorkflowStep[]): WorkflowStep[][] {
  if (steps.length === 0) return [];

  /* stepId → step 맵 */
  const stepMap = new Map<string, WorkflowStep>();
  for (const s of steps) stepMap.set(s.id, s);

  /* 이미 레이어에 배치된 id 집합 */
  const placed = new Set<string>();
  const layers: WorkflowStep[][] = [];

  /* 남은 스텝이 있는 한 반복 */
  let remaining = [...steps];

  while (remaining.length > 0) {
    /* 이번 레이어에 들어갈 수 있는 스텝: 모든 deps가 이미 placed */
    const layer = remaining.filter((s) =>
      s.depends_on.every((dep) => placed.has(dep))
    );

    /* 진행이 없으면(순환) 남은 것 전부 마지막 레이어에 넣고 종료 */
    if (layer.length === 0) {
      layers.push(remaining);
      break;
    }

    layers.push(layer);
    for (const s of layer) placed.add(s.id);
    remaining = remaining.filter((s) => !placed.has(s.id));
  }

  return layers;
}

// ━━━ 연결선 데이터 ━━━

interface Line {
  /** 고유 키 */
  key: string;
  /** 수직선: 부모 하단 → 자식 상단 y 좌표 사이 */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

// ━━━ 컴포넌트 ━━━

/**
 * DAG 연결선을 CSS div로 그리는 오버레이 컴포넌트.
 * - 부모 카드 하단 중앙 → 자식 카드 상단 중앙
 * - 수직선 + 수평선 + 화살표(▼)로 구성
 * - position: absolute, pointer-events: none
 */
export function WorkflowConnections({ steps, containerRef }: Props) {
  const [lines, setLines] = useState<Line[]>([]);

  /**
   * 카드 위치를 측정하고 연결선 좌표를 계산한다.
   * data-step-id 어트리뷰트로 각 카드 DOM을 찾는다.
   */
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const newLines: Line[] = [];

    for (const step of steps) {
      /* 현재 스텝 카드 (자식) */
      const childEl = container.querySelector(
        `[data-step-id="${step.id}"]`
      ) as HTMLElement | null;
      if (!childEl) continue;

      const childRect = childEl.getBoundingClientRect();
      /* 자식 카드 상단 중앙 (컨테이너 기준 상대좌표) */
      const toX = childRect.left + childRect.width / 2 - containerRect.left;
      const toY = childRect.top - containerRect.top;

      for (const depId of step.depends_on) {
        /* 부모 카드 */
        const parentEl = container.querySelector(
          `[data-step-id="${depId}"]`
        ) as HTMLElement | null;
        if (!parentEl) continue;

        const parentRect = parentEl.getBoundingClientRect();
        /* 부모 카드 하단 중앙 */
        const fromX =
          parentRect.left + parentRect.width / 2 - containerRect.left;
        const fromY = parentRect.bottom - containerRect.top;

        newLines.push({
          key: `${depId}->${step.id}`,
          fromX,
          fromY,
          toX,
          toY,
        });
      }
    }

    setLines(newLines);
  }, [steps, containerRef]);

  /* 레이아웃 변경 시 재측정 */
  useLayoutEffect(() => {
    measure();

    /* ResizeObserver로 컨테이너 크기 변경 감지 */
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(container);

    return () => ro.disconnect();
  }, [measure, containerRef]);

  if (lines.length === 0) return null;

  return (
    /* 오버레이: 컨테이너 전체를 덮고, 포인터 이벤트 무시 */
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    >
      {lines.map((line) => {
        /* 수직 구간의 중간 Y (꺾이는 지점) */
        const midY = (line.fromY + line.toY) / 2;

        /* 수평 이동이 필요한지 여부 */
        const dx = line.toX - line.fromX;
        const needsHorizontal = Math.abs(dx) > 2;

        /* 화살표 크기 */
        const arrowSize = 6;

        return (
          <div key={line.key}>
            {/* 1) 부모 하단 → 중간 Y: 수직선 */}
            <div
              className="absolute border-l border-border"
              style={{
                left: line.fromX,
                top: line.fromY,
                height: midY - line.fromY,
              }}
            />

            {/* 2) 수평선 (from.x → to.x at midY) */}
            {needsHorizontal && (
              <div
                className="absolute border-t border-border"
                style={{
                  left: Math.min(line.fromX, line.toX),
                  top: midY,
                  width: Math.abs(dx),
                }}
              />
            )}

            {/* 3) 중간 Y → 자식 상단: 수직선 */}
            <div
              className="absolute border-l border-border"
              style={{
                left: line.toX,
                top: midY,
                height: line.toY - midY - arrowSize,
              }}
            />

            {/* 4) 화살표 (▼) — CSS border trick */}
            <div
              className="absolute"
              style={{
                left: line.toX - arrowSize,
                top: line.toY - arrowSize * 2,
                width: 0,
                height: 0,
                borderLeft: `${arrowSize}px solid transparent`,
                borderRight: `${arrowSize}px solid transparent`,
                borderTop: `${arrowSize}px solid var(--border)`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
