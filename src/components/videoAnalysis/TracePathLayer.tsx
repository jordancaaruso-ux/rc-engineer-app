"use client";

import { useMemo } from "react";
import type { ManualLapTrace, TracePoint } from "@/lib/manualVideoAnalysis/types";
import { videoContentRectInContainer } from "@/lib/manualVideoAnalysis/videoViewCrop";
import { RUN_BREAK_SEC, smoothForDisplay } from "@/lib/videoAnalysis/trace/smooth";
import { segmentUnverified } from "@/lib/videoAnalysis/trace/stitch";

/**
 * A traced lap's path, drawn on the picture the way the sector lines are, with a dot riding it
 * at the player's moment. The solid lap is a solid line, the ghost a dashed one, in the
 * player's own solid/ghost language; the line is never green or red, because it is not a delta.
 *
 * A hole in the trace is a break in the line, and the dot goes out inside one, and so is a
 * stretch whose path came near neither of the crossings it runs between (`segmentUnverified`):
 * that is something else moving, and drawing it puts a rival's line on the picture and calls it
 * yours. The line is the smoothed path (`smoothForDisplay`); the delta chart reads the raw points.
 *
 * The dot is HTML, not SVG: the viewBox is stretched to the video's shape and an SVG circle in
 * it stretches with it (the pace-chart lesson).
 */

export type TraceLayerLap = {
  trace: ManualLapTrace;
  kind: "solid" | "ghost";
  /** Video time to put the dot at; null hides it. */
  atSec: number | null;
};

/** Where the lap's path was at video time `t`, or null inside a hole or off either end. */
export function pointAt(points: TracePoint[], t: number): { x: number; y: number } | null {
  const n = points.length;
  if (n === 0 || t < points[0]![0] || t > points[n - 1]![0]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (b[0] - a[0] > RUN_BREAK_SEC) return null;
  const k = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k };
}

export function TracePathLayer({
  laps,
  containerAspect,
  videoAspect,
}: {
  laps: TraceLayerLap[];
  containerAspect: number;
  videoAspect: number;
}) {
  const runs = useMemo(
    () =>
      laps.map((l) => {
        const unverified = l.trace.segments.filter(segmentUnverified);
        const points = unverified.length
          ? l.trace.points.filter((p) => !unverified.some((seg) => p[0] > seg.fromT && p[0] < seg.toT))
          : l.trace.points;
        return smoothForDisplay(points).map((run) =>
          run.map((p) => `${(p[1] * 1000).toFixed(1)},${(p[2] * 1000).toFixed(1)}`).join(" ")
        );
      }),
    [laps]
  );
  if (laps.length === 0) return null;
  const rect = videoContentRectInContainer(containerAspect, videoAspect);

  return (
    <div
      className="pointer-events-none absolute z-[11]"
      style={{
        left: `${rect.left * 100}%`,
        top: `${rect.top * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
      }}
    >
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {laps.map((l, i) =>
          runs[i]!.map((d, k) => (
            <g key={`${l.kind}-${k}`}>
              {/* Halo under the ink, as the sector lines do: readable on kerb and on asphalt. */}
              <polyline
                points={d}
                fill="none"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={l.kind === "solid" ? 4 : 3}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={d}
                fill="none"
                stroke={l.kind === "solid" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)"}
                strokeWidth={l.kind === "solid" ? 2 : 1.5}
                strokeDasharray={l.kind === "solid" ? undefined : "6 5"}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))
        )}
      </svg>
      {laps.map((l) => {
        const at = l.atSec == null ? null : pointAt(l.trace.points, l.atSec);
        if (!at) return null;
        return (
          <span
            key={`dot-${l.kind}`}
            aria-hidden
            className={
              l.kind === "solid"
                ? "absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black/70 bg-white shadow"
                : "absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/60 bg-white/70"
            }
            style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
          />
        );
      })}
    </div>
  );
}
