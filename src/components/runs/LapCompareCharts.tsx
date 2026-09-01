"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComparisonSeries } from "@/lib/lapAnalysis";
import { buildPaceRanges, buildRaceProgress, MIN_CLEAN_LAPS_FOR_PACE_RANGE } from "@/lib/lapRaceCharts";
import { LapTimeGraph } from "@/components/runs/LapTimeGraph";
import { PillToggle } from "@/components/ui/PillToggle";
import { xLabelStep } from "@/components/runs/chartAxis";
import { formatLap } from "@/lib/runLaps";
import { formatLapDelta } from "@/lib/lapAnalysis";
import { cn } from "@/lib/utils";

/**
 * The lap sheet's charts, one at a time behind a row of tabs.
 *
 * "Whatever graphs we decide to implement, have it as a toggle or a selection rather than
 * having to scroll" (founder, 2026-08-27, holding a MyRCM report that stacks four of them).
 * So: one card, one plot on screen, the tabs change which. The set was decided the same
 * day — the lap trace that was already here, gap to leader, position history and pace range.
 *
 * There is no colour palette. Ten drivers on one plot is the case the app's chart rules were
 * written to avoid, and a categorical palette is a design-system call that has not been
 * made. What identifies a line instead is what a race trace uses anyway: the driver's name
 * at the end of it, the target drawn in ink over a field in grey, and pointing at a line —
 * or at that driver's chip above the grid — lifting it out of the rest.
 */

export type LapChartSeries = {
  id: string;
  /** What the line is called — the driver on a race sheet, the session on your own runs. */
  name: string;
  series: ComparisonSeries;
  isTarget: boolean;
  /**
   * True when this ran in the SAME session as the target. Gap and position are only
   * arithmetic across drivers who shared a start; the caller decides what "same" means.
   */
  sameSessionAsTarget: boolean;
};

export type LapChartTab = "trace" | "gap" | "position" | "pace";

const CHART_HEIGHT = 220;
const PAD_LEFT = 40;
/** Room for the name at the end of each line. */
const PAD_RIGHT = 84;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
/** Two end labels closer than this are pushed apart. */
const LABEL_STEP_PX = 11;

/**
 * The phone version, decided by the card's own width rather than a breakpoint (founder
 * call, 2026-08-29 — the charts were `hidden lg:block` before, so a phone had none).
 * Under this width the plot is shorter, and the 84px name gutter is dropped: only the
 * target and the lifted driver are named, written at the end of their own lines inside
 * the plot. Ten surnames stacked down a 390px screen's right edge named nobody legibly
 * and took a quarter of the width doing it.
 */
const COMPACT_WIDTH_PX = 560;
const COMPACT_CHART_HEIGHT = 170;
const COMPACT_PAD_RIGHT = 10;
/** ~Sora at `.fig-tick`: enough to decide whether an in-plot label fits left of its point. */
const LABEL_CHAR_PX = 6.5;

const INK = "rgb(var(--color-foreground))";
const FIELD = "rgb(var(--color-muted-foreground))";

/** "Bruno Coelho" → "COELHO"; a one-word name stays as it is. Long names are clipped. */
function endLabel(name: string): string {
  const parts = name.trim().split(/\s+/);
  const surname = parts.length > 1 ? parts.slice(1).join(" ") : name.trim();
  const upper = surname.toUpperCase();
  return upper.length > 12 ? `${upper.slice(0, 11)}…` : upper;
}

function useMeasuredWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Start from the viewport when there is one, so a phone's first frame is already the
  // compact plot rather than a desktop one that snaps a frame later. This card only ever
  // mounts client-side (the sheet gates on hydration), so `window` is safe to read here.
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? Math.min(fallback, Math.max(1, window.innerWidth - 40)) : fallback
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * End labels sit beside the last point of each line; where two lines finish within a text
 * height of each other the labels are nudged apart, in order, so both stay legible. The
 * leader line keeps its true y — nudges only ever push away from the crowd.
 */
function spreadLabels(items: Array<{ id: string; y: number }>, lo: number, hi: number) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const placed: Array<{ id: string; y: number }> = [];
  let last = -Infinity;
  for (const item of sorted) {
    const y = Math.max(item.y, last + LABEL_STEP_PX);
    placed.push({ id: item.id, y });
    last = y;
  }
  // Ran off the bottom: shove the stack back up from the last one.
  const overflow = (placed[placed.length - 1]?.y ?? lo) - hi;
  if (overflow > 0) {
    for (let i = placed.length - 1; i >= 0; i -= 1) {
      const wanted = placed[i]!.y - overflow;
      const ceiling = i + 1 < placed.length ? placed[i + 1]!.y - LABEL_STEP_PX : Infinity;
      placed[i]!.y = Math.max(lo, Math.min(wanted, ceiling));
    }
  }
  return new Map(placed.map((p) => [p.id, p.y]));
}

/** Tick spacing so a gap axis carries at most ~6 rules whatever the spread. */
function niceStep(max: number): number {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120];
  for (const c of candidates) if (max / c <= 6) return c;
  return 300;
}

type LineChartProps = {
  lines: Array<{
    id: string;
    name: string;
    isTarget: boolean;
    /** Index-aligned with lap 1..n; a driver who stopped has a shorter array. */
    values: number[];
  }>;
  lapCount: number;
  /** Value → y in [PAD_TOP, CHART_HEIGHT − PAD_BOTTOM]. */
  yAt: (v: number) => number;
  ticks: Array<{ v: number; label: string }>;
  ariaLabel: string;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  formatValue: (v: number) => string;
  width: number;
  height: number;
  /** The phone drawing — see `COMPACT_WIDTH_PX`. */
  compact: boolean;
};

function LineChart({
  lines,
  lapCount,
  yAt,
  ticks,
  ariaLabel,
  focusedId,
  onFocus,
  formatValue,
  width,
  height,
  compact,
}: LineChartProps) {
  const padRight = compact ? COMPACT_PAD_RIGHT : PAD_RIGHT;
  const innerWidth = Math.max(1, width - PAD_LEFT - padRight);
  const xAt = (i: number) => PAD_LEFT + (lapCount <= 1 ? innerWidth / 2 : (i / (lapCount - 1)) * innerWidth);
  const labelStep = xLabelStep(lapCount, width - (padRight - 10), lapCount);
  const labelYs = useMemo(
    () =>
      spreadLabels(
        lines
          .filter((l) => l.values.length > 0)
          .map((l) => ({ id: l.id, y: yAt(l.values[l.values.length - 1]!) })),
        PAD_TOP,
        height - PAD_BOTTOM
      ),
    [lines, yAt, height]
  );
  const anyFocus = focusedId != null && lines.some((l) => l.id === focusedId);

  /**
   * Compact: two labels at most, each written at the end of its own line. The target's
   * sits above its last point; the lifted driver's goes above too unless that would land
   * on the target's, in which case it drops below. A line that ended early (a driver who
   * stopped) may not have room to its left, so the label flips to run rightwards.
   */
  const targetLine = lines.find((l) => l.isTarget && l.values.length > 0) ?? null;
  const targetEndY = targetLine ? yAt(targetLine.values[targetLine.values.length - 1]!) : null;
  const inPlotLabel = (line: LineChartProps["lines"][number], lastX: number, lastY: number) => {
    const text = endLabel(line.name);
    const fitsLeft = lastX - text.length * LABEL_CHAR_PX >= PAD_LEFT;
    const collides =
      !line.isTarget && targetEndY != null && Math.abs(lastY - targetEndY) < LABEL_STEP_PX + 3;
    // A line that ends on the top rule (P1, or a 0s gap drawn at the bottom) has no room on
    // that side: the label goes the other way rather than off the plot.
    const above = lastY - 7;
    const below = lastY + 13;
    const roomAbove = above >= 9;
    const roomBelow = below <= height - PAD_BOTTOM + 2;
    const y = collides ? (roomBelow ? below : above) : roomAbove ? above : below;
    return {
      text,
      x: fitsLeft ? lastX - 4 : lastX + 4,
      anchor: (fitsLeft ? "end" : "start") as "end" | "start",
      y,
    };
  };

  // Target on top of the field, the focused line on top of everything.
  const drawOrder = [...lines].sort(
    (a, b) =>
      Number(a.id === focusedId) - Number(b.id === focusedId) || Number(a.isTarget) - Number(b.isTarget)
  );

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      role="img"
      aria-label={ariaLabel}
      onMouseLeave={() => onFocus(null)}
    >
      {ticks.map((t) => (
        <g key={t.v}>
          <line
            x1={PAD_LEFT}
            x2={width - padRight + (compact ? 0 : 6)}
            y1={yAt(t.v)}
            y2={yAt(t.v)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text x={PAD_LEFT - 6} y={yAt(t.v) + 3} textAnchor="end" className="fill-faint fig-tick">
            {t.label}
          </text>
        </g>
      ))}
      {Array.from({ length: lapCount }, (_, i) => {
        const isLast = i === lapCount - 1;
        const stepped = i % labelStep === 0 && lapCount - 1 - i >= labelStep;
        if (!isLast && !stepped) return null;
        return (
          <text
            key={i}
            x={xAt(i)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : isLast ? "end" : "middle"}
            className="fill-faint fig-tick"
          >
            {i + 1}
          </text>
        );
      })}
      {drawOrder.map((line) => {
        if (line.values.length === 0) return null;
        const focused = line.id === focusedId;
        const dimmed = anyFocus && !focused;
        const stroke = focused || line.isTarget ? INK : FIELD;
        const points = line.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
        const lastIndex = line.values.length - 1;
        const lastX = xAt(lastIndex);
        const lastY = yAt(line.values[lastIndex]!);
        const labelY = labelYs.get(line.id) ?? lastY;
        const title = `${line.name} · ${formatValue(line.values[lastIndex]!)} after lap ${line.values.length}`;
        const plotLabel = compact && (focused || line.isTarget) ? inPlotLabel(line, lastX, lastY) : null;
        return (
          <g
            key={line.id}
            className="transition-opacity duration-150"
            style={{ opacity: dimmed ? 0.28 : 1 }}
            onMouseEnter={() => onFocus(line.id)}
            /* A finger has no hover: tapping a line lifts it, tapping it again lets go. */
            onClick={() => onFocus(focused ? null : line.id)}
          >
            <title>{title}</title>
            {/* A wide invisible stroke so a 1.5px line can be pointed at. */}
            <polyline points={points} fill="none" stroke="transparent" strokeWidth={12} />
            <polyline
              points={points}
              fill="none"
              stroke={stroke}
              strokeWidth={focused ? 2.5 : line.isTarget ? 2 : 1.5}
              strokeOpacity={focused || line.isTarget ? 0.95 : 0.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {line.values.map((v, i) => (
              <circle
                key={i}
                cx={xAt(i)}
                cy={yAt(v)}
                r={focused ? 2.75 : 2}
                fill={stroke}
                fillOpacity={focused || line.isTarget ? 0.95 : 0.6}
                className="stroke-card"
                strokeWidth={1}
              />
            ))}
            {compact ? (
              plotLabel ? (
                <text
                  x={plotLabel.x}
                  y={plotLabel.y}
                  textAnchor={plotLabel.anchor}
                  className="fig-tick fill-foreground font-semibold"
                  /* Paper behind the letters so the name reads across whatever lines it sits on. */
                  paintOrder="stroke"
                  stroke="rgb(var(--color-card))"
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {plotLabel.text}
                </text>
              ) : null
            ) : (
              <>
                {/* Leader line from the last point across to its label, when the label was nudged. */}
                {Math.abs(labelY - lastY) > 1 ? (
                  <line
                    x1={lastX + 3}
                    y1={lastY}
                    x2={width - PAD_RIGHT + 10}
                    y2={labelY}
                    stroke={stroke}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                  />
                ) : null}
                <text
                  x={width - PAD_RIGHT + 12}
                  y={labelY + 3}
                  textAnchor="start"
                  className={cn("fig-tick", focused || line.isTarget ? "fill-foreground font-semibold" : "fill-faint")}
                >
                  {endLabel(line.name)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function PaceRangeRows({
  series,
  focusedId,
  onFocus,
  compact,
}: {
  series: LapChartSeries[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  /** Two lines per driver — name and figures, then the bar — instead of five columns. */
  compact: boolean;
}) {
  const ranges = useMemo(
    () => buildPaceRanges(series.map((s) => ({ id: s.id, laps: s.series.laps }))),
    [series]
  );
  const byId = new Map(series.map((s) => [s.id, s]));
  const withRange = ranges.filter((r) => r.best != null);
  const lo = withRange.length ? Math.min(...withRange.map((r) => r.best!)) : 0;
  const hi = withRange.length ? Math.max(...withRange.map((r) => r.slowest!)) : 1;
  const span = Math.max(0.2, hi - lo);
  const pct = (v: number) => `${(((v - lo) / span) * 100).toFixed(2)}%`;
  const leaderAvg = ranges.find((r) => r.ranked)?.average ?? null;

  if (compact) {
    return (
      <div className="space-y-0.5" onMouseLeave={() => onFocus(null)}>
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="ui-label-caps whitespace-nowrap text-[9px] uppercase tracking-wider">
            Clean laps · avg marked
          </span>
          <span className="ui-label-caps whitespace-nowrap text-[9px] uppercase tracking-wider">
            Best · avg · slowest
          </span>
        </div>
        {ranges.map((r) => {
          const s = byId.get(r.id);
          if (!s) return null;
          const focused = r.id === focusedId;
          const gapToLeader =
            r.ranked && leaderAvg != null && r.average != null ? r.average - leaderAvg : null;
          return (
            <div
              key={r.id}
              className={cn(
                "rounded-md px-1 py-1.5 transition-colors",
                focused && "bg-surface-runna-inset",
                !r.ranked && "opacity-60"
              )}
              onMouseEnter={() => onFocus(r.id)}
              onClick={() => onFocus(focused ? null : r.id)}
            >
              <div className="flex items-baseline justify-between gap-2 leading-tight">
                <span
                  className={cn(
                    "min-w-0 truncate text-[12px] text-foreground",
                    s.isTarget && "font-semibold"
                  )}
                >
                  {s.name}
                </span>
                <span className="fig-cell shrink-0 text-foreground">
                  {formatLap(r.best)}
                  <span className="text-muted-foreground"> · {formatLap(r.average)}</span>
                  <span className="text-muted-foreground"> · {formatLap(r.slowest)}</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-border/60">
                {r.best != null && r.slowest != null ? (
                  <div
                    className={cn(
                      "absolute inset-y-0 rounded-full",
                      s.isTarget || focused ? "bg-foreground/80" : "bg-muted-foreground/55"
                    )}
                    style={{ left: pct(r.best), width: `calc(${pct(r.slowest)} - ${pct(r.best)})`, minWidth: 3 }}
                  />
                ) : null}
                {r.average != null ? (
                  <div
                    className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-primary-ink"
                    style={{ left: pct(r.average) }}
                    title={`Average ${formatLap(r.average)}`}
                  />
                ) : null}
              </div>
              <div className="mt-1 truncate text-[10px] tabular-nums text-muted-foreground">
                {r.cleanCount} clean
                {r.offPaceCount > 0 ? ` · ${r.offPaceCount} off-pace` : ""}
                {!r.ranked ? ` · under ${MIN_CLEAN_LAPS_FOR_PACE_RANGE}, not ranked` : ""}
                {gapToLeader != null && gapToLeader > 0 ? ` · ${formatLapDelta(gapToLeader)} avg` : ""}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-1" onMouseLeave={() => onFocus(null)}>
      <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-center gap-x-3 px-1 pb-1">
        <span className="ui-label-caps text-[9px] uppercase tracking-wider">Driver</span>
        <span className="ui-label-caps text-[9px] uppercase tracking-wider">
          Clean laps · best to slowest, average marked
        </span>
        <span className="ui-label-caps text-right text-[9px] uppercase tracking-wider">Best</span>
        <span className="ui-label-caps text-right text-[9px] uppercase tracking-wider">Average</span>
        <span className="ui-label-caps text-right text-[9px] uppercase tracking-wider">Slowest</span>
      </div>
      {ranges.map((r) => {
        const s = byId.get(r.id);
        if (!s) return null;
        const focused = r.id === focusedId;
        const gapToLeader = r.ranked && leaderAvg != null && r.average != null ? r.average - leaderAvg : null;
        return (
          <div
            key={r.id}
            className={cn(
              "grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-center gap-x-3 rounded-md px-1 py-1.5 transition-colors",
              focused && "bg-surface-runna-inset",
              !r.ranked && "opacity-60"
            )}
            onMouseEnter={() => onFocus(r.id)}
          >
            <div className="min-w-0 leading-tight">
              <div className={cn("truncate text-[12px]", s.isTarget ? "font-semibold text-foreground" : "text-foreground")}>
                {s.name}
              </div>
              <div className="truncate text-[10px] tabular-nums text-muted-foreground">
                {r.cleanCount} clean
                {r.offPaceCount > 0 ? ` · ${r.offPaceCount} off-pace` : ""}
                {!r.ranked ? ` · under ${MIN_CLEAN_LAPS_FOR_PACE_RANGE}, not ranked` : ""}
                {gapToLeader != null && gapToLeader > 0 ? ` · ${formatLapDelta(gapToLeader)} avg` : ""}
              </div>
            </div>
            <div className="relative h-3 rounded-full bg-border/60">
              {r.best != null && r.slowest != null ? (
                <div
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    s.isTarget || focused ? "bg-foreground/80" : "bg-muted-foreground/55"
                  )}
                  style={{ left: pct(r.best), width: `calc(${pct(r.slowest)} - ${pct(r.best)})`, minWidth: 3 }}
                />
              ) : null}
              {r.average != null ? (
                <div
                  className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-primary-ink"
                  style={{ left: pct(r.average) }}
                  title={`Average ${formatLap(r.average)}`}
                />
              ) : null}
            </div>
            <span className="text-right text-[11px] tabular-nums text-foreground">{formatLap(r.best)}</span>
            <span className="text-right text-[11px] tabular-nums text-foreground">{formatLap(r.average)}</span>
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">{formatLap(r.slowest)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LapCompareCharts({
  series,
  tab,
  onTabChange,
  focusedId,
  onFocus,
  traceBestLapNumbers,
}: {
  /** Target first, then every ticked column, in grid order. */
  series: LapChartSeries[];
  tab: LapChartTab;
  onTabChange: (tab: LapChartTab) => void;
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  /** The target's best-lap numbers, for the trace's marker. */
  traceBestLapNumbers: Set<number>;
}) {
  const { ref, width } = useMeasuredWidth();
  const compact = width < COMPACT_WIDTH_PX;
  const chartHeight = compact ? COMPACT_CHART_HEIGHT : CHART_HEIGHT;
  const target = series.find((s) => s.isTarget) ?? null;
  const raceSeries = useMemo(
    () => series.filter((s) => s.sameSessionAsTarget && s.series.laps.length > 0),
    [series]
  );
  const raceChartsAvailable = raceSeries.length >= 2;
  const traceBaseline = series.find((s) => !s.isTarget) ?? null;

  const progress = useMemo(
    () =>
      raceChartsAvailable
        ? buildRaceProgress(raceSeries.map((s) => ({ id: s.id, laps: s.series.laps })))
        : null,
    [raceChartsAvailable, raceSeries]
  );

  const options = useMemo(() => {
    const all: Array<{ value: LapChartTab; label: string }> = [
      { value: "trace", label: "Trace" },
      { value: "gap", label: "Gap" },
      { value: "position", label: "Position" },
      { value: "pace", label: "Pace" },
    ];
    return raceChartsAvailable ? all : all.filter((o) => o.value === "trace" || o.value === "pace");
  }, [raceChartsAvailable]);

  // A tab that stopped existing (the race drivers were unticked) falls back to the trace.
  useEffect(() => {
    if (!options.some((o) => o.value === tab)) onTabChange("trace");
  }, [options, tab, onTabChange]);

  const gapGeometry = useMemo(() => {
    if (!progress) return null;
    const max = Math.max(0.5, ...progress.drivers.flatMap((d) => d.gaps));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const innerHeight = chartHeight - PAD_TOP - PAD_BOTTOM;
    // Bigger gap plots higher — the same way round as the trace, where a slower lap is higher.
    const yAt = (v: number) => PAD_TOP + innerHeight - (v / top) * innerHeight;
    const ticks: Array<{ v: number; label: string }> = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push({ v, label: `${v % 1 === 0 ? v : v.toFixed(1)}s` });
    return { yAt, ticks };
  }, [progress, chartHeight]);

  const positionGeometry = useMemo(() => {
    if (!progress) return null;
    const n = Math.max(2, progress.drivers.filter((d) => d.lapsCompleted > 0).length);
    const innerHeight = chartHeight - PAD_TOP - PAD_BOTTOM;
    const yAt = (p: number) => PAD_TOP + ((p - 1) / (n - 1)) * innerHeight;
    // A ten-car field on a 170px plot is a rule every 15px; label every other place.
    const labelEvery = compact && n > 6 ? 2 : 1;
    const ticks = Array.from({ length: n }, (_, i) => ({
      v: i + 1,
      label: i % labelEvery === 0 || i === n - 1 ? `P${i + 1}` : "",
    }));
    return { yAt, ticks };
  }, [progress, chartHeight, compact]);

  const nameOf = (id: string) => series.find((s) => s.id === id)?.name ?? id;

  /** The line under the tabs: whose figure is being read, and what it is. */
  const readout = useMemo(() => {
    const focus = series.find((s) => s.id === focusedId) ?? target;
    if (!focus) return null;
    if ((tab === "gap" || tab === "position") && progress) {
      const d = progress.drivers.find((x) => x.id === focus.id);
      if (!d || d.lapsCompleted === 0) return `${focus.name} · no laps`;
      const gap = d.gaps[d.lapsCompleted - 1]!;
      const pos = d.positions[d.lapsCompleted - 1]!;
      return `${focus.name} · P${pos} · ${gap === 0 ? "led" : `+${gap.toFixed(3)}s`} after lap ${d.lapsCompleted}`;
    }
    return `${focus.name} · best ${formatLap(focus.series.bestLap)}`;
  }, [series, focusedId, target, tab, progress]);

  if (!target) return null;

  return (
    <div className="rounded-md border border-border bg-surface-runna p-2.5">
      {/* Compact: the tabs take the whole line and the readout sits under them — side by
          side they wrapped unevenly, a 16rem control and a name fighting for 348px. */}
      <div
        className={cn(
          "mb-2 flex justify-between gap-x-3 gap-y-1",
          compact ? "flex-col" : "flex-wrap items-center"
        )}
      >
        <PillToggle
          options={options}
          value={tab}
          onChange={onTabChange}
          role="tablist"
          ariaLabel="Which chart to show"
          className={compact ? "w-full" : "w-auto min-w-[16rem]"}
        />
        <p className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {readout}
        </p>
      </div>

      <div ref={ref}>
        {tab === "trace" ? (
          <>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <svg width="16" height="6" aria-hidden className="shrink-0">
                  <line x1="0" y1="3" x2="16" y2="3" stroke={FIELD} strokeWidth="2" />
                </svg>
                {target.name}
              </span>
              {traceBaseline ? (
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <svg width="16" height="6" aria-hidden className="shrink-0">
                    <line
                      x1="0"
                      y1="3"
                      x2="16"
                      y2="3"
                      stroke={FIELD}
                      strokeWidth="1.5"
                      strokeOpacity="0.35"
                      strokeDasharray="4 3"
                    />
                  </svg>
                  {traceBaseline.name}
                </span>
              ) : null}
            </div>
            <LapTimeGraph
              rows={target.series.laps}
              bestLapNumbers={traceBestLapNumbers}
              mistakeLapNumbers={new Set()}
              mistakeDetailByLapNumber={new Map()}
              medianSeconds={null}
              baseline={traceBaseline?.series.laps ?? null}
              baselineLabel={traceBaseline?.name ?? null}
            />
            {/* The trace takes one baseline; with more ticked, say which one it is reading. */}
            {series.length > 2 ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                The trace reads {target.name} against {traceBaseline?.name}, the first ticked column — Gap and
                Position read the whole field.
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "gap" && progress && gapGeometry ? (
          <LineChart
            width={width}
            lines={progress.drivers.map((d) => ({
              id: d.id,
              name: nameOf(d.id),
              isTarget: d.id === target.id,
              values: d.gaps,
            }))}
            lapCount={progress.lapCount}
            yAt={gapGeometry.yAt}
            ticks={gapGeometry.ticks}
            ariaLabel={`Gap to leader across ${progress.lapCount} laps`}
            focusedId={focusedId}
            onFocus={onFocus}
            formatValue={(v) => (v === 0 ? "leading" : `+${v.toFixed(3)}s`)}
            height={chartHeight}
            compact={compact}
          />
        ) : null}

        {tab === "position" && progress && positionGeometry ? (
          <LineChart
            width={width}
            lines={progress.drivers.map((d) => ({
              id: d.id,
              name: nameOf(d.id),
              isTarget: d.id === target.id,
              values: d.positions,
            }))}
            lapCount={progress.lapCount}
            yAt={positionGeometry.yAt}
            ticks={positionGeometry.ticks}
            ariaLabel={`Position after each of ${progress.lapCount} laps`}
            focusedId={focusedId}
            onFocus={onFocus}
            formatValue={(v) => `P${v}`}
            height={chartHeight}
            compact={compact}
          />
        ) : null}

        {tab === "pace" ? (
          <PaceRangeRows series={series} focusedId={focusedId} onFocus={onFocus} compact={compact} />
        ) : null}

        {(tab === "gap" || tab === "position") && progress?.lap0Dropped ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Read from lap 1: only some drivers&apos; sheets carried the run to the first crossing.
          </p>
        ) : null}
        {(tab === "gap" || tab === "position") && raceSeries.length < series.length ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Reads the {raceSeries.length} drivers from {target.name}&apos;s session — columns from other sessions
            never shared a start, so they have no gap to draw.
          </p>
        ) : null}
      </div>
    </div>
  );
}
