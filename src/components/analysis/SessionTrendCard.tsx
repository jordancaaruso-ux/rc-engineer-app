"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Disc } from "lucide-react";
import type { AnalysisTrendModel, AnalysisTrendRun } from "@/lib/analysis/analysisHomeModel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PagedCard } from "@/components/ui/PagedCard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { TireIndicatorIcon } from "@/components/runs/TireIndicatorIcon";
import { formatTireIndicatorTitle } from "@/lib/runs/tireSetChange";
import { cn } from "@/lib/utils";

/**
 * Session trend — an Apple-widget paged chart: three lenses on the same
 * event/day, swiped as faces. Pace (best / avg top 5 / avg top 10 / median
 * band, lower = faster), Consistency (100 − CV, higher = steadier), and
 * Mistakes (IQR-outlier count, lower = cleaner). The car tabs are shared across
 * faces; each face owns its own orientation and units. Chart-series hues only —
 * yellow stays reserved for actions per VISUAL_NORTH_STAR.
 */

type SeriesKey = "best" | "avgTop5" | "avgTop10" | "median";

const SERIES: Array<{ key: SeriesKey; name: string; color: string; width: number }> = [
  { key: "best", name: "Best lap", color: "#45C8E8", width: 2.5 },
  { key: "avgTop5", name: "Avg top 5", color: "#A78BFA", width: 2 },
  { key: "avgTop10", name: "Avg top 10", color: "#4FD089", width: 2 },
  { key: "median", name: "Median", color: "#E5644E", width: 2 },
];

const CHART_HEIGHT = 216;
const PAD_LEFT = 38;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
/** Bottom band: tire indicator row + x-axis run labels. */
const PAD_BOTTOM = 42;
/** Top of the 12px tire icons, between the plot and the run labels. */
const TIRE_ROW_TOP = CHART_HEIGHT - PAD_BOTTOM + 4;
/** Minimum px between runs before the tire row thins to changed-set runs only. */
const TIRE_ROW_MIN_SPACING = 18;

function seconds(value: number | null | undefined, digits = 3): string {
  return value == null ? "—" : value.toFixed(digits);
}

function buildPolylineSegments(points: Array<{ x: number; y: number } | null>): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${point.x},${point.y}`);
  }
  if (current.length > 1) segments.push(current.join(" "));
  return segments;
}

/** Measured chart width via ResizeObserver; each face measures independently. */
function useChartWidth(dep: unknown): [React.RefObject<HTMLDivElement | null>, number] {
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
  }, [dep]);
  return [chartRef, chartWidth];
}

export function SessionTrendCard({ trend }: { trend: AnalysisTrendModel | null }) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(trend?.defaultCarId ?? null);

  const carRuns = useMemo<AnalysisTrendRun[]>(
    () => (trend ? trend.runs.filter((run) => run.carId === selectedCarId) : []),
    [trend, selectedCarId]
  );

  if (!trend) {
    return (
      <SurfaceCard variant="hero" contentClassName="flex flex-col gap-3 p-4 sm:p-5">
        <Eyebrow dot="muted">Session trend</Eyebrow>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Log a run with lap times and this chart tracks your pace and consistency across the
          event or day.
        </p>
        <ButtonLink href="/runs/new" className="self-start">
          Log a run
        </ButtonLink>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard variant="hero" contentClassName="flex flex-col gap-3.5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow dot="accent">Session trend</Eyebrow>
        <div className="max-w-[180px] truncate text-right font-mono text-[10px] uppercase leading-relaxed tracking-[0.08em] text-faint">
          {trend.scopeLabel}
        </div>
      </div>

      {trend.carOptions.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Car">
          {trend.carOptions.map((option) => {
            const active = option.carId === selectedCarId;
            return (
              <button
                key={option.carId ?? "none"}
                type="button"
                onClick={() => setSelectedCarId(option.carId)}
                className={cn(
                  "tap-active rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  active
                    ? "border-ring/45 bg-muted text-foreground"
                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                {option.carName}
              </button>
            );
          })}
        </div>
      ) : null}

      <PagedCard
        storageKey="analysis-session-trend"
        faces={[
          {
            id: "pace",
            label: "Pace",
            content: <PaceTrendFace carRuns={carRuns} scopeLabel={trend.scopeLabel} />,
          },
          {
            id: "consistency",
            label: "Consistency",
            content: (
              <SingleMetricTrendFace
                carRuns={carRuns}
                metric="consistencyScore"
                title="Consistency"
                orientationHint="Higher = steadier"
                higherIsBetter
                color="#4FD089"
                formatValue={(v) => `${v.toFixed(1)}%`}
                emptyLabel="No consistency data for this car yet in this window."
              />
            ),
          },
          {
            id: "mistakes",
            label: "Mistakes",
            content: (
              <SingleMetricTrendFace
                carRuns={carRuns}
                metric="mistakeCount"
                title="Mistakes"
                orientationHint="Lower = cleaner"
                higherIsBetter={false}
                color="#E5644E"
                formatValue={(v) => String(Math.round(v))}
                emptyLabel="No mistake-eligible runs for this car yet in this window."
              />
            ),
          },
        ]}
      />
    </SurfaceCard>
  );
}

/** Face 1 — the four-series pace band with hover tooltip, tire row, tap-to-open. */
function PaceTrendFace({
  carRuns,
  scopeLabel,
}: {
  carRuns: AnalysisTrendRun[];
  scopeLabel: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartRef, chartWidth] = useChartWidth(carRuns);
  const pointerDownRef = useRef<{ x: number; y: number; sameIndex: boolean } | null>(null);

  const geometry = useMemo(() => {
    if (carRuns.length < 2) return null;
    const values: number[] = [];
    for (const run of carRuns) {
      for (const { key } of SERIES) {
        const v = run.metrics[key];
        if (v != null) values.push(v);
      }
    }
    if (values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 0.15) {
      const mid = (min + max) / 2;
      min = mid - 0.15;
      max = mid + 0.15;
    }
    const padding = (max - min) * 0.07;
    const lo = min - padding;
    const hi = max + padding;
    const innerWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xAt = (index: number) =>
      PAD_LEFT + (carRuns.length === 1 ? innerWidth / 2 : (index / (carRuns.length - 1)) * innerWidth);
    const yAt = (value: number) => PAD_TOP + ((hi - value) / (hi - lo)) * innerHeight;
    const pointsFor = (key: SeriesKey) =>
      carRuns.map((run, index) => {
        const v = run.metrics[key];
        return v == null ? null : { x: xAt(index), y: yAt(v) };
      });
    const ticks = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.12];
    return { xAt, yAt, pointsFor, ticks };
  }, [carRuns, chartWidth]);

  const toggleSeries = (key: SeriesKey) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const nearestRunIndex = (event: React.PointerEvent<SVGSVGElement>): number | null => {
    if (!geometry || carRuns.length === 0) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < carRuns.length; i++) {
      const distance = Math.abs(geometry.xAt(i) - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = nearestRunIndex(event);
    if (index != null) setHoverIndex(index);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = nearestRunIndex(event);
    if (index == null) return;
    pointerDownRef.current = {
      x: event.clientX,
      y: event.clientY,
      sameIndex: hoverIndex === index,
    };
    setHoverIndex(index);
  };

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || hoverIndex == null) return;
    if (Math.abs(event.clientX - down.x) > 8 || Math.abs(event.clientY - down.y) > 8) return;
    const run = carRuns[hoverIndex];
    if (down.sameIndex && run) {
      router.push(`/runs/history?focusRun=${encodeURIComponent(run.id)}`);
    }
  };

  const hoverRun = hoverIndex != null ? carRuns[hoverIndex] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
        Lower = faster
      </div>
      {geometry ? (
        <div ref={chartRef} className="relative">
          <svg
            width="100%"
            height={CHART_HEIGHT}
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            className="block cursor-pointer touch-pan-y"
            role="img"
            aria-label={`Lap metric trend across ${carRuns.length} runs — ${scopeLabel}. Tap a run to open it.`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerCancel={() => {
              pointerDownRef.current = null;
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setHoverIndex(null);
            }}
            onClick={handleClick}
          >
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={chartWidth - PAD_RIGHT}
                  y1={geometry.yAt(tick)}
                  y2={geometry.yAt(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={geometry.yAt(tick) + 3}
                  textAnchor="end"
                  className="fill-faint font-mono text-[9px] tabular-nums"
                >
                  {tick.toFixed(2)}
                </text>
              </g>
            ))}

            {carRuns.map((run, index) => {
              const step = Math.max(1, Math.ceil(carRuns.length / 8));
              const isLast = index === carRuns.length - 1;
              const stepped = index % step === 0 && carRuns.length - 1 - index >= step;
              if (!isLast && !stepped) return null;
              return (
                <text
                  key={run.id}
                  x={geometry.xAt(index)}
                  y={CHART_HEIGHT - 8}
                  textAnchor={index === 0 ? "start" : isLast ? "end" : "middle"}
                  className={cn("font-mono text-[9px]", isLast ? "fill-muted-foreground" : "fill-faint")}
                >
                  {run.shortLabel}
                </text>
              );
            })}

            {(() => {
              const withTires = carRuns
                .map((run, index) => ({ run, index }))
                .filter(({ run }) => run.tireIndicator != null);
              if (withTires.length === 0) return null;
              const spacing =
                carRuns.length > 1
                  ? (chartWidth - PAD_LEFT - PAD_RIGHT) / (carRuns.length - 1)
                  : chartWidth;
              const shown =
                spacing >= TIRE_ROW_MIN_SPACING
                  ? withTires
                  : withTires.filter(({ run }) => run.tireIndicator!.changed);
              return shown.map(({ run, index }) => {
                const indicator = run.tireIndicator!;
                const x = geometry.xAt(index);
                return (
                  <g
                    key={`tire-${run.id}`}
                    className={indicator.changed ? "text-foreground" : "text-faint"}
                  >
                    <title>{formatTireIndicatorTitle(indicator)}</title>
                    <Disc x={x - 6} y={TIRE_ROW_TOP} width={12} height={12} aria-hidden />
                    {indicator.runNumber != null ? (
                      <text
                        x={x + 5}
                        y={TIRE_ROW_TOP + 13}
                        className="fill-current font-mono text-[7px] tabular-nums"
                      >
                        {indicator.runNumber}
                      </text>
                    ) : null}
                  </g>
                );
              });
            })()}

            {hoverIndex != null ? (
              <line
                x1={geometry.xAt(hoverIndex)}
                x2={geometry.xAt(hoverIndex)}
                y1={PAD_TOP - 2}
                y2={CHART_HEIGHT - PAD_BOTTOM + 4}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}

            {[...SERIES].reverse().map((series) => {
              const points = geometry.pointsFor(series.key);
              const isHidden = hidden.has(series.key);
              return (
                <g key={series.key} className={cn("transition-opacity", isHidden && "opacity-[0.07]")}>
                  {buildPolylineSegments(points).map((segment) => (
                    <polyline
                      key={segment}
                      points={segment}
                      fill="none"
                      stroke={series.color}
                      strokeWidth={series.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {points.map((point, index) =>
                    point ? (
                      <circle
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={series.key === "best" ? 2.75 : 2.5}
                        fill={series.color}
                        className="stroke-card"
                        strokeWidth={1}
                      />
                    ) : null
                  )}
                  {hoverIndex != null && !isHidden && points[hoverIndex] ? (
                    <circle
                      cx={points[hoverIndex].x}
                      cy={points[hoverIndex].y}
                      r={4}
                      fill={series.color}
                      className="stroke-card"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>

          {hoverRun ? (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-[132px] rounded-lg border border-border bg-muted px-2.5 py-2 shadow-lg"
              style={{
                left: Math.max(2, Math.min(geometry.xAt(hoverIndex ?? 0) - 66, chartWidth - 136)),
              }}
            >
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                {hoverRun.shortLabel}
              </div>
              {SERIES.filter((series) => !hidden.has(series.key)).map((series) => (
                <div key={series.key} className="flex items-center justify-between gap-3 py-px">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ backgroundColor: series.color }}
                      aria-hidden
                    />
                    {series.name}
                  </span>
                  <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                    {seconds(hoverRun.metrics[series.key])}
                  </span>
                </div>
              ))}
              {hoverRun.tireIndicator ? (
                <div className="mt-1 flex items-center gap-1 border-t border-border pt-1">
                  <TireIndicatorIcon
                    indicator={hoverRun.tireIndicator}
                    size="sm"
                    className="-my-1 -ml-1.5"
                  />
                  <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
                    {hoverRun.tireIndicator.setLabel}
                    {hoverRun.tireIndicator.runNumber != null
                      ? ` · run ${hoverRun.tireIndicator.runNumber}`
                      : ""}
                  </span>
                </div>
              ) : null}
              <div className="mt-1 flex items-center gap-1 border-t border-border pt-1 text-[10.5px] font-semibold text-muted-foreground">
                Open run
                <ChevronRight className="h-3 w-3 text-primary" aria-hidden />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {carRuns.length === 1
            ? "One run with laps so far — log another and the trend line appears."
            : "No lap times for this car yet in this window."}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Metrics">
        {SERIES.map((series) => {
          const isHidden = hidden.has(series.key);
          return (
            <button
              key={series.key}
              type="button"
              onClick={() => toggleSeries(series.key)}
              aria-pressed={!isHidden}
              className={cn(
                "tap-active flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 transition-opacity hover:border-ring/30",
                isHidden && "opacity-45"
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: series.color }}
                aria-hidden
              />
              <span
                className={cn(
                  "text-[10.5px] tracking-tight",
                  isHidden ? "text-faint" : "text-muted-foreground"
                )}
              >
                {series.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Faces 2 & 3 — one metric per run as a single line; tap a run to open it. */
function SingleMetricTrendFace({
  carRuns,
  metric,
  title,
  orientationHint,
  higherIsBetter,
  color,
  formatValue,
  emptyLabel,
}: {
  carRuns: AnalysisTrendRun[];
  metric: "consistencyScore" | "mistakeCount";
  title: string;
  orientationHint: string;
  higherIsBetter: boolean;
  color: string;
  formatValue: (value: number) => string;
  emptyLabel: string;
}) {
  const router = useRouter();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartRef, chartWidth] = useChartWidth(carRuns);
  const pointerDownRef = useRef<{ x: number; y: number; sameIndex: boolean } | null>(null);

  const values = useMemo(() => carRuns.map((run) => run.metrics[metric]), [carRuns, metric]);
  const present = values.filter((v): v is number => v != null);

  const geometry = useMemo(() => {
    if (present.length < 2) return null;
    let min = Math.min(...present);
    let max = Math.max(...present);
    if (max - min < 1e-6) {
      // Flat metric (e.g. every run 0 mistakes) — pad so the line sits mid-height.
      min -= 1;
      max += 1;
    }
    const padding = (max - min) * 0.12;
    const lo = min - padding;
    const hi = max + padding;
    const innerWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xAt = (index: number) =>
      PAD_LEFT + (carRuns.length === 1 ? innerWidth / 2 : (index / (carRuns.length - 1)) * innerWidth);
    // "Better" always plots higher: consistency up = higher score; mistakes up = fewer.
    const yAt = (value: number) =>
      higherIsBetter
        ? PAD_TOP + ((hi - value) / (hi - lo)) * innerHeight
        : PAD_TOP + ((value - lo) / (hi - lo)) * innerHeight;
    const points = carRuns.map((run, index) => {
      const v = run.metrics[metric];
      return v == null ? null : { x: xAt(index), y: yAt(v) };
    });
    const ticks = [hi - (hi - lo) * 0.12, (lo + hi) / 2, lo + (hi - lo) * 0.12];
    return { xAt, yAt, points, ticks };
  }, [present, carRuns, chartWidth, higherIsBetter, metric]);

  const nearestRunIndex = (event: React.PointerEvent<SVGSVGElement>): number | null => {
    if (!geometry || carRuns.length === 0) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < carRuns.length; i++) {
      const distance = Math.abs(geometry.xAt(i) - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    return nearest;
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = nearestRunIndex(event);
    if (index == null) return;
    pointerDownRef.current = { x: event.clientX, y: event.clientY, sameIndex: hoverIndex === index };
    setHoverIndex(index);
  };

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || hoverIndex == null) return;
    if (Math.abs(event.clientX - down.x) > 8 || Math.abs(event.clientY - down.y) > 8) return;
    const run = carRuns[hoverIndex];
    if (down.sameIndex && run) {
      router.push(`/runs/history?focusRun=${encodeURIComponent(run.id)}`);
    }
  };

  const hoverRun = hoverIndex != null ? carRuns[hoverIndex] : null;
  const hoverValue = hoverIndex != null ? values[hoverIndex] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="type-data-label">{title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          {orientationHint}
        </div>
      </div>
      {geometry ? (
        <div ref={chartRef} className="relative">
          <svg
            width="100%"
            height={CHART_HEIGHT}
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            className="block cursor-pointer touch-pan-y"
            role="img"
            aria-label={`${title} trend across ${carRuns.length} runs. Tap a run to open it.`}
            onPointerMove={(event) => {
              const index = nearestRunIndex(event);
              if (index != null) setHoverIndex(index);
            }}
            onPointerDown={handlePointerDown}
            onPointerCancel={() => {
              pointerDownRef.current = null;
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setHoverIndex(null);
            }}
            onClick={handleClick}
          >
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={chartWidth - PAD_RIGHT}
                  y1={geometry.yAt(tick)}
                  y2={geometry.yAt(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={geometry.yAt(tick) + 3}
                  textAnchor="end"
                  className="fill-faint font-mono text-[9px] tabular-nums"
                >
                  {formatValue(tick)}
                </text>
              </g>
            ))}

            {carRuns.map((run, index) => {
              const step = Math.max(1, Math.ceil(carRuns.length / 8));
              const isLast = index === carRuns.length - 1;
              const stepped = index % step === 0 && carRuns.length - 1 - index >= step;
              if (!isLast && !stepped) return null;
              return (
                <text
                  key={run.id}
                  x={geometry.xAt(index)}
                  y={CHART_HEIGHT - 8}
                  textAnchor={index === 0 ? "start" : isLast ? "end" : "middle"}
                  className={cn("font-mono text-[9px]", isLast ? "fill-muted-foreground" : "fill-faint")}
                >
                  {run.shortLabel}
                </text>
              );
            })}

            {hoverIndex != null ? (
              <line
                x1={geometry.xAt(hoverIndex)}
                x2={geometry.xAt(hoverIndex)}
                y1={PAD_TOP - 2}
                y2={CHART_HEIGHT - PAD_BOTTOM + 4}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}

            {buildPolylineSegments(geometry.points).map((segment) => (
              <polyline
                key={segment}
                points={segment}
                fill="none"
                stroke={color}
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {geometry.points.map((point, index) =>
              point ? (
                <circle
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={hoverIndex === index ? 4 : 2.75}
                  fill={color}
                  className="stroke-card"
                  strokeWidth={hoverIndex === index ? 1.5 : 1}
                />
              ) : null
            )}
          </svg>

          {hoverRun && hoverValue != null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-[104px] rounded-lg border border-border bg-muted px-2.5 py-2 shadow-lg"
              style={{
                left: Math.max(2, Math.min(geometry.xAt(hoverIndex ?? 0) - 52, chartWidth - 108)),
              }}
            >
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                {hoverRun.shortLabel}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  {title}
                </span>
                <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                  {formatValue(hoverValue)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 border-t border-border pt-1 text-[10.5px] font-semibold text-muted-foreground">
                Open run
                <ChevronRight className="h-3 w-3 text-primary" aria-hidden />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {carRuns.length <= 1
            ? "Log another run and this trend line appears."
            : emptyLabel}
        </p>
      )}
    </div>
  );
}
