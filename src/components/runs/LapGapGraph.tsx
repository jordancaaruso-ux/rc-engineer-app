"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LapGraphRow } from "@/components/runs/LapTimeGraph";

/**
 * Running gap vs one competitor across a full run (Sessions expanded view,
 * driver-compare "Gap" mode). Design locked 2026-07-19 via artifact interview:
 * faint green/red per-lap delta bars + a bold cumulative gap line coloured by
 * sign (green while you're ahead, red while behind). Positive = you ahead,
 * ahead plots up, dashed zero line = even.
 *
 * Gap math is raw truth: every included lap sums into the gap — a crash is a
 * real cliff on the chart. Laps excluded as timing artifacts (on either side)
 * are skipped: no bar, cumulative carries flat across their slot. Laps pair by
 * index (lap N vs lap N), so the gap only runs over the shared lap count.
 */

const GAIN_COLOR = "rgb(var(--color-gain))"; // matches the gain token (faster / you ahead)
const LOSS_COLOR = "rgb(var(--color-destructive))"; // loss token (slower / you behind)
const CROSS_COLOR = "rgb(var(--color-muted-foreground))"; // neutral ink-2 for segments crossing zero

const CHART_HEIGHT = 150;
const PAD_LEFT = 40;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

type GapPoint = {
  /** 0-based slot index — shared x domain with the Laps view. */
  index: number;
  lapNumber: number;
  /** This lap's delta: competitor time − your time (positive = you faster). */
  delta: number;
  /** Running total after this lap. */
  cumulative: number;
};

function formatGap(value: number, decimals = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}s`;
}

/**
 * Round a raw tick interval up to a clean step (1 / 2 / 5 × 10^k), aiming for
 * ~4–5 gridlines across the range.
 */
function niceTickStep(range: number, targetLines = 4): number {
  const raw = range / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const factor = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return factor * magnitude;
}

export function LapGapGraph({
  userRows,
  competitorRows,
}: {
  /** Your laps — the reference side of the gap. */
  userRows: LapGraphRow[];
  /** The selected competitor's laps. */
  competitorRows: LapGraphRow[];
}) {
  const [chartWidth, setChartWidth] = useState(340);
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setChartWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pairedCount = Math.min(userRows.length, competitorRows.length);

  const points = useMemo(() => {
    const result: GapPoint[] = [];
    let cumulative = 0;
    for (let i = 0; i < pairedCount; i++) {
      const you = userRows[i];
      const them = competitorRows[i];
      // A timing artifact on either side makes the pair unusable — skip the
      // slot; the line bridges and the running total carries flat.
      if (!you.isIncluded || !them.isIncluded) continue;
      const delta = them.lapTimeSeconds - you.lapTimeSeconds;
      cumulative += delta;
      result.push({ index: i, lapNumber: them.lapNumber, delta, cumulative });
    }
    return result;
  }, [userRows, competitorRows, pairedCount]);

  const geometry = useMemo(() => {
    if (points.length < 3) return null;
    const values = points.flatMap((p) => [p.delta, p.cumulative]);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max - min < 0.6) {
      // Near-even run — pad so the trace doesn't collapse onto the zero line.
      min -= 0.3;
      max += 0.3;
    }
    const padding = (max - min) * 0.08;
    const lo = min - padding;
    const hi = max + padding;
    const innerWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    // Shared x domain with the Laps view so toggling doesn't reflow the axis.
    const domainLength = Math.max(userRows.length, competitorRows.length);
    const xAt = (index: number) =>
      PAD_LEFT + (domainLength === 1 ? innerWidth / 2 : (index / (domainLength - 1)) * innerWidth);
    // Ahead (positive) plots up.
    const yAt = (value: number) => PAD_TOP + ((hi - value) / (hi - lo)) * innerHeight;
    // Gridlines on clean values (every 1s, 2s, 0.5s…), ~4–5 across the range.
    // Zero is skipped — the dashed "even" line already marks it.
    const step = niceTickStep(hi - lo);
    const tickDecimals = Math.max(0, -Math.floor(Math.log10(step)));
    const ticks: number[] = [];
    for (let i = Math.ceil(lo / step); i * step <= hi + step * 0.01; i++) {
      if (i !== 0) ticks.push(i * step);
    }
    return { xAt, yAt, ticks, tickDecimals, domainLength };
  }, [points, userRows.length, competitorRows.length, chartWidth]);

  if (!geometry) return null;

  const { xAt, yAt, ticks, tickDecimals, domainLength } = geometry;
  const labelStep = Math.max(1, Math.ceil(domainLength / 8));
  const barWidth = Math.max(
    2,
    Math.min(10, (chartWidth - PAD_LEFT - PAD_RIGHT) / Math.max(domainLength, 1) - 4)
  );
  const finalGap = points[points.length - 1].cumulative;

  const segmentColor = (a: GapPoint, b: GapPoint) => {
    if (a.cumulative >= 0 && b.cumulative >= 0) return GAIN_COLOR;
    if (a.cumulative < 0 && b.cumulative < 0) return LOSS_COLOR;
    return CROSS_COLOR;
  };

  return (
    <div ref={chartRef} className="relative">
      <svg
        width="100%"
        height={CHART_HEIGHT}
        viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
        className="block"
        role="img"
        aria-label={`Running gap graph across ${points.length} laps, finishing ${formatGap(finalGap, 2)}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={chartWidth - PAD_RIGHT}
              y1={yAt(tick)}
              y2={yAt(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={yAt(tick) + 3}
              textAnchor="end"
              className="fill-faint font-mono text-[9px] tabular-nums"
            >
              {formatGap(tick, tickDecimals)}
            </text>
          </g>
        ))}

        {/* Zero line — even with the competitor. */}
        <line
          x1={PAD_LEFT}
          x2={chartWidth - PAD_RIGHT}
          y1={yAt(0)}
          y2={yAt(0)}
          className="stroke-muted-foreground/50"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={chartWidth - PAD_RIGHT}
          y={yAt(0) - 3}
          textAnchor="end"
          className="fill-faint font-mono text-[8px]"
        >
          even
        </text>

        {points.map((p, i) => {
          const isLast = i === points.length - 1;
          const stepped = p.index % labelStep === 0 && domainLength - 1 - p.index >= labelStep;
          if (!isLast && !stepped) return null;
          return (
            <text
              key={p.lapNumber}
              x={xAt(p.index)}
              y={CHART_HEIGHT - 8}
              textAnchor={p.index === 0 ? "start" : isLast ? "end" : "middle"}
              className="fill-faint font-mono text-[9px] tabular-nums"
            >
              {p.lapNumber}
            </text>
          );
        })}

        {/* Faint per-lap delta bars — where the time moved lap by lap. */}
        {points.map((p) => {
          const y0 = yAt(0);
          const y1 = yAt(p.delta);
          const top = Math.min(y0, y1);
          const height = Math.max(1.5, Math.abs(y1 - y0));
          return (
            <g key={p.lapNumber}>
              <title>
                {`Lap ${p.lapNumber} — you ${formatGap(p.delta, 2)} · gap ${formatGap(p.cumulative, 2)}`}
              </title>
              <rect
                x={xAt(p.index) - barWidth / 2}
                y={top}
                width={barWidth}
                height={height}
                rx={1.5}
                fill={p.delta >= 0 ? GAIN_COLOR : LOSS_COLOR}
                fillOpacity={0.3}
              />
            </g>
          );
        })}

        {/* Running gap line, coloured by sign — green ahead, red behind. */}
        {points.slice(1).map((p, i) => {
          const prev = points[i];
          return (
            <line
              key={p.lapNumber}
              x1={xAt(prev.index)}
              y1={yAt(prev.cumulative)}
              x2={xAt(p.index)}
              y2={yAt(p.cumulative)}
              stroke={segmentColor(prev, p)}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

        {/* Finish marker carrying the final gap. */}
        <g>
          <title>{`Finish — ${formatGap(finalGap, 2)} ${finalGap >= 0 ? "ahead" : "behind"}`}</title>
          <circle
            cx={xAt(points[points.length - 1].index)}
            cy={yAt(finalGap)}
            r={3.5}
            fill={finalGap >= 0 ? GAIN_COLOR : LOSS_COLOR}
            className="stroke-card"
          />
        </g>
      </svg>
    </div>
  );
}
