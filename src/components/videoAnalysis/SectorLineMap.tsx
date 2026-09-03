"use client";

import { videoContentRectInContainer } from "@/lib/manualVideoAnalysis/videoViewCrop";
import { cn } from "@/lib/utils";

/**
 * Every sector line, drawn on the picture, always (driver, 2026-08-29: "all the sectors should be
 * visible on the track at all times — when I'm clicking to view sector two, I wanna know exactly
 * where that is").
 *
 * A sector is the stretch between two lines, so the two that bound the sector being watched are
 * lit and tagged IN/OUT; the rest stay on screen, quiet, so the whole split is readable at a
 * glance. Nothing is drawn between the lines — we know where the boundaries are, not the shape of
 * the track between them, and a straight band across a hairpin would be a lie.
 */

export type MappedSectorLine = {
  lineKey: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Lines whose geometry survived — legacy rows were saved without coordinates. */
export function mappableLines(
  lines: Array<{
    lineKey: string;
    label: string;
    sortOrder?: number;
    x1?: number | null;
    y1?: number | null;
    x2?: number | null;
    y2?: number | null;
  }>
): MappedSectorLine[] {
  return lines
    .filter((l) => l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      x1: l.x1!,
      y1: l.y1!,
      x2: l.x2!,
      y2: l.y2!,
    }));
}

export function SectorLineMap({
  lines,
  fromKey = null,
  toKey = null,
  containerAspect,
  videoAspect,
}: {
  lines: MappedSectorLine[];
  /** The line the watched sector starts at, and the one it ends at. Null: nothing lit. */
  fromKey?: string | null;
  toKey?: string | null;
  /** Shape of the box the video sits in, and of the video itself — line coords are normalised to
   *  the painted picture, so a letterboxed clip needs the overlay pulled in to match. */
  containerAspect: number;
  videoAspect: number;
}) {
  if (lines.length === 0) return null;
  const rect = videoContentRectInContainer(containerAspect, videoAspect);
  const lit = (key: string) => key === fromKey || key === toKey;
  const anyLit = lines.some((l) => lit(l.lineKey));

  return (
    <div
      className="pointer-events-none absolute z-10"
      style={{
        left: `${rect.left * 100}%`,
        top: `${rect.top * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {lines.map((l) => {
          const on = !anyLit || lit(l.lineKey);
          return (
            <g key={l.lineKey}>
              {/* Halo: a hairline is unreadable on dark asphalt, ink alone is unreadable on a
                  white kerb. Both, or the line disappears on half the track. */}
              <line
                x1={l.x1 * 1000}
                y1={l.y1 * 1000}
                x2={l.x2 * 1000}
                y2={l.y2 * 1000}
                stroke="rgba(0,0,0,0.6)"
                strokeWidth={on ? 3 : 2.5}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              <line
                x1={l.x1 * 1000}
                y1={l.y1 * 1000}
                x2={l.x2 * 1000}
                y2={l.y2 * 1000}
                // Full yellow, not the paper ink: over a picture this is a fill, and #8A6A00
                // reads as brown mud on asphalt.
                stroke={on ? "rgb(var(--color-primary))" : "rgba(255,255,255,0.8)"}
                strokeOpacity={on ? 1 : 0.75}
                strokeWidth={on ? 1.5 : 1}
                strokeDasharray={on ? undefined : "5 5"}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
      {lines.map((l) => {
        const on = !anyLit || lit(l.lineKey);
        const tag = !anyLit ? null : l.lineKey === fromKey ? "IN" : l.lineKey === toKey ? "OUT" : null;
        return (
          <span
            key={`lbl-${l.lineKey}`}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-[150%] rounded px-1 py-px text-[9px] leading-tight tracking-[0.08em] backdrop-blur-sm",
              // Same chip the marking flow draws. Yellow stays on the line itself — a solid
              // yellow pill here would read as a button.
              on
                ? "bg-background/85 font-semibold text-foreground"
                : "bg-background/60 font-medium text-foreground/50"
            )}
            style={{ left: `${((l.x1 + l.x2) / 2) * 100}%`, top: `${((l.y1 + l.y2) / 2) * 100}%` }}
          >
            {l.label}
            {tag ? <span className="ml-1 opacity-70">{tag}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
