"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { xLabelStep } from "@/components/runs/chartAxis";
import type { FadeProfilePoint } from "@/lib/lapAnalysis";

/**
 * Lap-by-lap time graph for a single run (Sessions expanded view). Follows the
 * SessionTrendCard SVG conventions: measured container width, slower laps plot
 * higher, mono tick labels, recessive grid.
 *
 * The y-axis is clamped to clean pace (best included lap → best + 15%) so a
 * crash lap doesn't flatten the real variation; clamped laps pin to the top
 * edge as triangles carrying the true time in their tooltip. Excluded laps
 * (timing artifacts / invalid fast laps) are skipped entirely — the line
 * bridges across their slot.
 */

export type LapGraphRow = {
  lapNumber: number;
  lapTimeSeconds: number;
  isIncluded: boolean;
};

/** Chart-series hues on charcoal — yellow stays reserved for actions. */
const LINE_COLOR = "rgb(var(--color-muted-foreground))"; // neutral ink-2: the single pace series
const BEST_COLOR = "rgb(var(--color-best-lap))"; // matches best-lap purple in the All laps grid
const MISTAKE_COLOR = "rgb(var(--color-destructive))"; // loss token, matches mistake chips

const CHART_HEIGHT = 150;
const PAD_LEFT = 40;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
/** Clean-pace ceiling: laps slower than best × this are clamped to the top edge. */
const CLAMP_FACTOR = 1.15;

/**
 * The fade strip under the chart: one bar per rolling window of `getFadeProfile`, up in
 * loss red when that stretch of the run was getting slower, down in gain green when it was
 * coming to the driver. It shares the chart's x-axis so a bar sits under the laps it read.
 *
 * The scale has a floor of ±0.10 s/lap and only grows past it: a flat run must LOOK flat,
 * and a rolling rate on six laps swings ±0.05 on nothing, which a scale fitted to the data
 * would blow up into a mountain range. A real fade (+0.2 s/lap and staying there) fills it.
 */
const FADE_STRIP_HEIGHT = 46;
const FADE_STRIP_PAD_TOP = 6;
const FADE_STRIP_PAD_BOTTOM = 6;
const FADE_STRIP_FLOOR = 0.1;
const FADE_UP_COLOR = "rgb(var(--color-destructive))";
const FADE_DOWN_COLOR = "rgb(var(--color-gain))";

function formatStripRate(rate: number): string {
  const r = Math.abs(rate) < 0.005 ? 0 : rate;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`;
}

/**
 * Index-aligned dashed baseline: each included lap becomes a point (clamped
 * into [lo, hi]); excluded laps are skipped entirely, the line bridging their
 * neighbours, so timing artifacts never appear on the trace.
 */
function buildBaselinePoints(
  baseline: LapGraphRow[],
  xAt: (i: number) => number,
  yAt: (v: number) => number,
  lo: number,
  hi: number
): string {
  return baseline
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.isIncluded)
    .map(({ r, i }) => `${xAt(i)},${yAt(Math.min(Math.max(r.lapTimeSeconds, lo), hi))}`)
    .join(" ");
}

export function LapTimeGraph({
  rows,
  bestLapNumbers,
  mistakeLapNumbers,
  mistakeDetailByLapNumber,
  medianSeconds,
  baseline,
  baselineLabel,
  lineColor = LINE_COLOR,
  baselineColor,
  fadeProfile,
}: {
  rows: LapGraphRow[];
  bestLapNumbers: Set<number>;
  mistakeLapNumbers: Set<number>;
  mistakeDetailByLapNumber: Map<number, string>;
  medianSeconds: number | null;
  /** Reference trace under the main series (driver compare: your laps, faint). */
  baseline?: LapGraphRow[] | null;
  baselineLabel?: string | null;
  /** Identity hue for the main pace series (driver compare). Defaults to neutral ink. */
  lineColor?: string;
  /** Identity hue for the dashed baseline; when set it renders bolder than the neutral default. */
  baselineColor?: string;
  /**
   * Rolling fade rate (`getFadeProfile`) drawn as a strip under the chart. Empty or absent
   * draws nothing — the caller's lap count decides, not this component.
   */
  fadeProfile?: FadeProfilePoint[] | null;
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

  const geometry = useMemo(() => {
    if (rows.length < 3) return null;
    const included = rows.filter((r) => r.isIncluded).map((r) => r.lapTimeSeconds);
    const anchor = included.length > 0 ? included : rows.map((r) => r.lapTimeSeconds);
    const best = Math.min(...anchor);
    const cap = best * CLAMP_FACTOR;
    // Excluded laps never render, so the window and clamp markers only care
    // about included pace.
    const inWindow = rows
      .filter((r) => r.isIncluded)
      .map((r) => r.lapTimeSeconds)
      .filter((t) => t <= cap);
    let min = best;
    let max = inWindow.length > 0 ? Math.max(...inWindow) : cap;
    const anyClamped = rows.some((r) => r.isIncluded && r.lapTimeSeconds > cap);
    if (anyClamped) max = Math.max(max, cap);
    if (max - min < 0.4) {
      // Metronomic run — pad so the line doesn't collapse flat.
      const mid = (min + max) / 2;
      min = mid - 0.2;
      max = mid + 0.2;
    }
    const padding = (max - min) * 0.08;
    const lo = min - padding;
    const hi = max + padding;
    const innerWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    // Lap N of the baseline aligns under lap N of the main series, so the x
    // domain spans whichever trace ran longer.
    const domainLength = Math.max(rows.length, baseline?.length ?? 0);
    const xAt = (index: number) =>
      PAD_LEFT + (domainLength === 1 ? innerWidth / 2 : (index / (domainLength - 1)) * innerWidth);
    // Slower (bigger seconds) plots higher — spikes point up, like LiveRC.
    const yAt = (value: number) => PAD_TOP + ((hi - Math.min(value, hi)) / (hi - lo)) * innerHeight;
    const ticks = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.12];
    return { xAt, yAt, ticks, lo, hi, cap: anyClamped ? cap : null };
  }, [rows, baseline, chartWidth]);

  if (!geometry) return null;

  const { xAt, yAt, ticks, lo, hi, cap } = geometry;
  const labelStep = xLabelStep(rows.length, chartWidth, rows[rows.length - 1]?.lapNumber ?? 0);
  // Excluded laps (timing artifacts, invalid fast laps) are skipped — the line
  // bridges straight across their slot. X stays index-aligned so lap N of the
  // baseline still sits under lap N of the main series.
  const linePoints = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.isIncluded)
    .map(({ r, i }) => `${xAt(i)},${yAt(r.lapTimeSeconds)}`)
    .join(" ");

  return (
    <div ref={chartRef} className="relative">
      <svg
        width="100%"
        height={CHART_HEIGHT}
        viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
        className="block"
        role="img"
        aria-label={`Lap time graph across ${rows.length} laps`}
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
              className="fill-faint fig-tick"
            >
              {tick.toFixed(1)}
            </text>
          </g>
        ))}

        {medianSeconds != null && medianSeconds > lo && medianSeconds < hi ? (
          <g>
            <line
              x1={PAD_LEFT}
              x2={chartWidth - PAD_RIGHT}
              y1={yAt(medianSeconds)}
              y2={yAt(medianSeconds)}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={chartWidth - PAD_RIGHT}
              y={yAt(medianSeconds) - 3}
              textAnchor="end"
              className="fill-faint fig-tick"
            >
              med {medianSeconds.toFixed(3)}
            </text>
          </g>
        ) : null}

        {rows.map((r, i) => {
          const isLast = i === rows.length - 1;
          const stepped = i % labelStep === 0 && rows.length - 1 - i >= labelStep;
          if (!isLast && !stepped) return null;
          return (
            <text
              key={r.lapNumber}
              x={xAt(i)}
              y={CHART_HEIGHT - 8}
              textAnchor={i === 0 ? "start" : isLast ? "end" : "middle"}
              className="fill-faint fig-tick"
            >
              {r.lapNumber}
            </text>
          );
        })}

        {baseline && baseline.length >= 2 ? (
          <g>
            <title>{baselineLabel ?? "Baseline"}</title>
            {/* Dashed reference of the comparison run — excluded laps skipped,
                line bridged, points clamped into the window. */}
            <polyline
              points={buildBaselinePoints(baseline, xAt, yAt, lo, hi)}
              fill="none"
              stroke={baselineColor ?? LINE_COLOR}
              strokeWidth={baselineColor ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={baselineColor ? 0.95 : 0.35}
              strokeDasharray={baselineColor ? undefined : "4 3"}
            />
          </g>
        ) : null}

        <polyline
          points={linePoints}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={0.9}
        />

        {rows.map((r, i) => {
          if (!r.isIncluded) return null; // excluded laps never plot
          const clamped = cap != null && r.lapTimeSeconds > cap;
          const isMistake = mistakeLapNumbers.has(r.lapNumber);
          const isBest = bestLapNumbers.has(r.lapNumber);
          const color = isMistake ? MISTAKE_COLOR : isBest ? BEST_COLOR : lineColor;
          const mistakeDetail = mistakeDetailByLapNumber.get(r.lapNumber);
          const title = [
            `Lap ${r.lapNumber} — ${r.lapTimeSeconds.toFixed(3)}s`,
            isBest ? "Best lap" : null,
            mistakeDetail ? `${mistakeDetail} vs median` : null,
            clamped ? "Off the clean-pace scale" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const x = xAt(i);
          const y = yAt(r.lapTimeSeconds);
          return (
            <g key={r.lapNumber}>
              <title>{title}</title>
              {clamped ? (
                <path
                  d={`M ${x} ${y - 3.5} L ${x + 3.5} ${y + 3} L ${x - 3.5} ${y + 3} Z`}
                  fill={color}
                  stroke={color}
                  strokeWidth={1.25}
                />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={isBest || isMistake ? 3 : 2.5}
                  fill={color}
                  className="stroke-card"
                />
              )}
            </g>
          );
        })}
      </svg>
      {fadeProfile && fadeProfile.length >= 2 ? (
        <FadeStrip profile={fadeProfile} rows={rows} xAt={xAt} chartWidth={chartWidth} />
      ) : null}
    </div>
  );
}

function FadeStrip({
  profile,
  rows,
  xAt,
  chartWidth,
}: {
  profile: FadeProfilePoint[];
  rows: LapGraphRow[];
  xAt: (index: number) => number;
  chartWidth: number;
}) {
  const indexOfLap = new Map(rows.map((r, i) => [r.lapNumber, i]));
  const limit = Math.max(FADE_STRIP_FLOOR, ...profile.map((p) => Math.abs(p.ratePerLap)));
  const innerHeight = FADE_STRIP_HEIGHT - FADE_STRIP_PAD_TOP - FADE_STRIP_PAD_BOTTOM;
  const zeroY = FADE_STRIP_PAD_TOP + innerHeight / 2;
  // Slower (positive) draws UP, matching the chart above where a slow lap spikes up.
  const yAt = (rate: number) => zeroY - (rate / limit) * (innerHeight / 2);
  // One bar per window, centred under the laps it read; bars are as wide as the step
  // between windows so consecutive bars touch and the strip reads as one shape.
  const centres = profile.map((p) => {
    const a = indexOfLap.get(p.fromLap);
    const b = indexOfLap.get(p.toLap);
    return a != null && b != null ? (xAt(a) + xAt(b)) / 2 : null;
  });
  const step =
    centres.length >= 2 && centres[0] != null && centres[1] != null
      ? Math.max(2, centres[1] - centres[0])
      : 6;
  const barWidth = Math.max(2, step - 1);

  return (
    <svg
      width="100%"
      height={FADE_STRIP_HEIGHT}
      viewBox={`0 0 ${chartWidth} ${FADE_STRIP_HEIGHT}`}
      className="block"
      role="img"
      aria-label="Fade per lap across the run, rolling six laps"
    >
      <text x={PAD_LEFT - 6} y={yAt(limit) + 3} textAnchor="end" className="fill-faint fig-tick">
        {formatStripRate(limit)}
      </text>
      <text x={PAD_LEFT - 6} y={yAt(-limit) + 3} textAnchor="end" className="fill-faint fig-tick">
        {formatStripRate(-limit)}
      </text>
      <line
        x1={PAD_LEFT}
        x2={chartWidth - PAD_RIGHT}
        y1={zeroY}
        y2={zeroY}
        className="stroke-border"
        strokeWidth={1}
      />
      {profile.map((p, i) => {
        const cx = centres[i];
        if (cx == null) return null;
        const y = yAt(p.ratePerLap);
        const up = p.ratePerLap >= 0;
        return (
          <g key={`${p.fromLap}-${p.toLap}`}>
            <title>{`Laps ${p.fromLap}–${p.toLap}: ${formatStripRate(p.ratePerLap)} s/lap`}</title>
            <rect
              x={cx - barWidth / 2}
              y={up ? y : zeroY}
              width={barWidth}
              height={Math.max(1, Math.abs(zeroY - y))}
              fill={up ? FADE_UP_COLOR : FADE_DOWN_COLOR}
              opacity={0.85}
            />
          </g>
        );
      })}
      <text
        x={chartWidth - PAD_RIGHT}
        y={FADE_STRIP_HEIGHT - 1}
        textAnchor="end"
        className="fill-faint fig-tick"
      >
        fade s/lap · rolling 6
      </text>
    </svg>
  );
}
