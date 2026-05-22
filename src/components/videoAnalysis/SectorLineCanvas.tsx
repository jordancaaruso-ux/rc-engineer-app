"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SectorLineNorm = {
  lineKey: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sortOrder: number;
};

type Props = {
  imageUrl: string | null;
  lines: SectorLineNorm[];
  activeLineKey: string | null;
  onLinesChange: (lines: SectorLineNorm[]) => void;
  onActiveLineKey: (key: string | null) => void;
  /** Optional second image for alignment preview (lines warped visually via CSS scale only in v1) */
  overlayOpacity?: number;
};

type DragTarget = { lineKey: string; end: "a" | "b" } | null;

export function SectorLineCanvas({
  imageUrl,
  lines,
  activeLineKey,
  onLinesChange,
  onActiveLineKey,
  overlayOpacity = 1,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragTarget>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(180, r.width * (9 / 16)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toNorm = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
      };
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const { x, y } = toNorm(e.clientX, e.clientY);
      onLinesChange(
        lines.map((ln) => {
          if (ln.lineKey !== drag.lineKey) return ln;
          if (drag.end === "a") return { ...ln, x1: x, y1: y };
          return { ...ln, x2: x, y2: y };
        })
      );
    },
    [drag, lines, onLinesChange, toNorm]
  );

  const onPointerUp = () => setDrag(null);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-black/40"
      style={{ aspectRatio: "16 / 9" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Track reference"
          className="absolute inset-0 h-full w-full object-contain"
          style={{ opacity: overlayOpacity }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Upload a reference still (frame 0 of golden video)
        </div>
      )}
      <svg
        className="absolute inset-0 h-full w-full touch-none"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
      >
        {lines.map((ln) => {
          const active = ln.lineKey === activeLineKey;
          const color = ln.lineKey === "sf" ? "#22c55e" : active ? "#f97316" : "#60a5fa";
          const x1 = ln.x1 * size.w;
          const y1 = ln.y1 * size.h;
          const x2 = ln.x2 * size.w;
          const y2 = ln.y2 * size.h;
          return (
            <g key={ln.lineKey}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={active ? 3 : 2}
                strokeDasharray={ln.lineKey === "sf" ? undefined : "6 4"}
              />
              <circle
                cx={x1}
                cy={y1}
                r={8}
                fill={color}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDrag({ lineKey: ln.lineKey, end: "a" });
                  onActiveLineKey(ln.lineKey);
                }}
              />
              <circle
                cx={x2}
                cy={y2}
                r={8}
                fill={color}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDrag({ lineKey: ln.lineKey, end: "b" });
                  onActiveLineKey(ln.lineKey);
                }}
              />
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 6}
                fill={color}
                fontSize={11}
                textAnchor="middle"
              >
                {ln.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
