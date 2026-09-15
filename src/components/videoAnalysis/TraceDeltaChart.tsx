"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeltaCurve } from "@/lib/videoAnalysis/trace/delta";

/**
 * The delta line under the player: how far ahead or behind, at every place on the lap.
 *
 * Same idiom as the Sessions gap graph (`LapGapGraph`): inline SVG in the card's width, clean
 * gridlines, a dashed zero. The sign is the sector board's: positive = you slower, above the
 * line, red; below the line you are gaining, green. The x axis is how far round the lap, with
 * the sector lines as ticks. A hole in either trace is a gap in the line, never a bridge.
 *
 * The hairline follows the player; a press or drag on the chart seeks the player.
 */

const LOSS_COLOR = "rgb(var(--color-destructive))";
const GAIN_COLOR = "rgb(var(--color-gain))";
const CROSS_COLOR = "rgb(var(--color-muted-foreground))";

const HEIGHT = 120;
const PAD_LEFT = 40;
const PAD_RIGHT = 10;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;

function niceTickStep(range: number, targetLines = 3): number {
  const raw = range / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const factor = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return factor * magnitude;
}

function fmtDelta(v: number, decimals: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}s`;
}

export function TraceDeltaChart({
  curve,
  cursorS,
  onSeekS,
  watched,
  note,
  labels,
}: {
  curve: DeltaCurve;
  /** Share of the lap the player is at, for the hairline; null hides it. */
  cursorS: number | null;
  onSeekS?: (s: number) => void;
  /** The sector being watched, as a share of the lap either side. */
  watched?: { fromS: number; toS: number } | null;
  /** A quiet line under the chart: a disagreement with the board, or nothing. */
  note?: string | null;
  /** Names for the tick keys, e.g. s1 → S1. */
  labels?: Record<string, string>;
}) {
  const [width, setWidth] = useState(340);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const values = curve.samples.map((s) => s.delta).filter((v): v is number => v != null);
    if (values.length < 2) return null;
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max - min < 0.3) {
      min -= 0.15;
      max += 0.15;
    }
    const padding = (max - min) * 0.1;
    const lo = min - padding;
    const hi = max + padding;
    const innerW = width - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xAt = (s: number) => PAD_LEFT + s * innerW;
    // Slower (positive) plots up, as losing time reads on a timing screen.
    const yAt = (v: number) => PAD_TOP + ((hi - v) / (hi - lo)) * innerH;
    const step = niceTickStep(hi - lo);
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    const ticks: number[] = [];
    for (let i = Math.ceil(lo / step); i * step <= hi + step * 0.01; i++) if (i !== 0) ticks.push(i * step);
    // Runs of drawn samples, broken at every hole.
    const runs: Array<Array<{ s: number; delta: number }>> = [];
    let cur: Array<{ s: number; delta: number }> = [];
    for (const smp of curve.samples) {
      if (smp.delta == null) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      cur.push({ s: smp.s, delta: smp.delta });
    }
    if (cur.length) runs.push(cur);
    return { xAt, yAt, ticks, decimals, runs, innerW };
  }, [curve, width]);

  if (!geometry) return null;
  const { xAt, yAt, ticks, decimals, runs, innerW } = geometry;

  const segmentColor = (a: number, b: number) =>
    a > 0 && b > 0 ? LOSS_COLOR : a < 0 && b < 0 ? GAIN_COLOR : CROSS_COLOR;

  const seekFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSeekS) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const s = Math.max(0, Math.min(1, (px - PAD_LEFT) / innerW));
    onSeekS(s);
  };

  const total = curve.total;

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block touch-none"
        role="img"
        aria-label={total != null ? `Delta over the lap, finishing ${fmtDelta(total, 2)}` : "Delta over the lap"}
        style={{ cursor: onSeekS ? "ew-resize" : undefined }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekFromEvent(e);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {watched ? (
          <rect
            x={xAt(watched.fromS)}
            y={PAD_TOP}
            width={Math.max(0, xAt(watched.toS) - xAt(watched.fromS))}
            height={HEIGHT - PAD_TOP - PAD_BOTTOM}
            className="fill-foreground/[0.06]"
          />
        ) : null}

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={yAt(tick)} y2={yAt(tick)} className="stroke-border" strokeWidth={1} />
            <text x={PAD_LEFT - 6} y={yAt(tick) + 3} textAnchor="end" className="fill-faint fig-tick">
              {fmtDelta(tick, decimals)}
            </text>
          </g>
        ))}

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={yAt(0)}
          y2={yAt(0)}
          className="stroke-muted-foreground/50"
          strokeWidth={1}
          strokeDasharray="3 3"
        />

        {curve.ticks.map((t) => {
          const x = xAt(t.s);
          const label = labels?.[t.lineKey] ?? t.lineKey.toUpperCase();
          const atEdge = t.s <= 0.001 || t.s >= 0.999;
          return (
            <g key={`${t.lineKey}-${t.s}`}>
              <line x1={x} x2={x} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} className="stroke-border" strokeWidth={1} />
              {!atEdge ? (
                <text x={x} y={HEIGHT - 6} textAnchor="middle" className="fill-faint fig-tick">
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}

        {runs.map((run, k) =>
          run.slice(1).map((p, i) => {
            const prev = run[i]!;
            return (
              <line
                key={`${k}-${i}`}
                x1={xAt(prev.s)}
                y1={yAt(prev.delta)}
                x2={xAt(p.s)}
                y2={yAt(p.delta)}
                stroke={segmentColor(prev.delta, p.delta)}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })
        )}

        {total != null ? (
          <g>
            <circle cx={xAt(1)} cy={yAt(total)} r={3.5} fill={total > 0 ? LOSS_COLOR : total < 0 ? GAIN_COLOR : CROSS_COLOR} className="stroke-card" />
            <text x={xAt(1) - 6} y={yAt(total) + (total >= 0 ? -6 : 12)} textAnchor="end" className="fig-tick fill-foreground">
              {fmtDelta(total, 2)}
            </text>
          </g>
        ) : null}

        {cursorS != null ? (
          <line
            x1={xAt(cursorS)}
            x2={xAt(cursorS)}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOTTOM}
            className="stroke-foreground"
            strokeWidth={1}
          />
        ) : null}
      </svg>
      {note ? <p className="mt-1 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
