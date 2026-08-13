"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import type {
  AnalysisRunDistribution,
  AnalysisTrendModel,
  AnalysisTrendRun,
} from "@/lib/analysis/analysisHomeModel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PagedCard } from "@/components/ui/PagedCard";
import { PillToggle } from "@/components/ui/PillToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import {
  TireIndicatorIcon,
  TireMarkGlyph,
  TIRE_MARK_STROKE,
} from "@/components/runs/TireIndicatorIcon";
import { formatTireIndicatorTitle, type RunTireIndicator } from "@/lib/runs/tireSetChange";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import { cn } from "@/lib/utils";

/**
 * Session trend — an Apple-widget paged chart: three lenses on the same
 * event/day, swiped as faces. Pace (best / avg top 5 / avg top 10 / median
 * band, lower = faster), Consistency (100 − CV, higher = steadier), and
 * Mistakes (IQR-outlier count, lower = cleaner). The car tabs are shared across
 * faces; each face owns its own orientation and units. Chart-series hues only —
 * yellow stays reserved for actions per VISUAL_NORTH_STAR.
 *
 * The Pace face carries two views behind a toggle: the four-series Line chart,
 * and Spread — a box-and-whisker per run that shows the *shape* of a stint
 * rather than four summary numbers from it. Same axis, same units, so they read
 * as one question at two resolutions and the switch is a morph, not a swap.
 */

type SeriesKey = "best" | "avgTop5" | "avgTop10" | "median";

/** Pace face lens. Remembered per device alongside PagedCard's face memory. */
type TrendView = "line" | "spread";

const PACE_VIEW_STORAGE_KEY = "analysisTrendPaceView";

// Single warm-ink luminance ramp, not a rainbow: the series you came to read
// (best lap) is the brightest + thickest line and everything else recedes with
// falling luminance. Yellow stays action-only (VISUAL_NORTH_STAR), so the hero
// line is bright ink, never the accent.
const SERIES: Array<{ key: SeriesKey; name: string; color: string; width: number }> = [
  { key: "best", name: "Best lap", color: "rgb(var(--color-foreground))", width: 2.5 },
  { key: "avgTop5", name: "Avg top 5", color: "rgb(var(--color-muted-foreground))", width: 1.75 },
  { key: "avgTop10", name: "Avg top 10", color: "#87847D", width: 1.75 },
  { key: "median", name: "Median", color: "#5C5A55", width: 1.75 },
];

/**
 * Spread-view marks, extending the same luminance ramp — no new palette. The box
 * recedes; the median bar and the best-lap cap are bright ink, deliberately the
 * same white as the `best` line so the eye tracks one mark across the morph.
 * Mistake dots borrow the Mistakes face's colour, so a bad lap looks the same
 * wherever you meet it on this card.
 */
const BOX_COLOR = "#87847D";
const BOX_FILL_OPACITY = 0.18;
const WHISKER_COLOR = "#5C5A55";
const SPREAD_INK = "rgb(var(--color-foreground))";
const MISTAKE_COLOR = "rgb(var(--color-destructive))";

/** Box width clamp — without it boxes are enormous at 2 runs and hairlines past ~20. */
const BOX_WIDTH_MIN = 6;
const BOX_WIDTH_MAX = 26;
/** At or below the floor a box can't be read: fall back to a range line + median tick. */
const BOX_DEGRADE_AT = 6.5;

/**
 * The card sizes itself to its *container*, not the viewport — it's 560px wide on
 * /analysis and ~730px in the Sessions workbench pane, and the phone's marker
 * glyphs were drawn for a thumb at 390px. Past `SPACIOUS_AT` the plot grows and
 * the marker glyphs come up with it; below it nothing changes, so the phone
 * renders exactly as it did.
 */
const SPACIOUS_AT = 620;

/**
 * The gutter under the plot is one instrument, not two rows of clip-art: chassis
 * on top, tires beneath, one column per run. Both glyphs are drawn on a *shared*
 * grid — same optical box (`markSize`), same on-screen stroke (`MARK_STROKE`),
 * same centre line, same ink rule (bright = changed since the last run on this
 * car, faint = went back out as it came in).
 *
 * The stroke needs deriving rather than setting. Lucide's `strokeWidth` is in its
 * own 24-unit space, so the old 22px wrench and 16px disc — both nominally
 * `strokeWidth={2}` — landed at 1.83px and 1.33px on screen, and the wrench row
 * read heavier as well as larger. Scaling the nominal width back out of the
 * render size keeps both rows weighing the same however the card is sized.
 *
 * The tire mark owns the weight, since it is drawn identically in the sessions
 * rows; the wrench matches it rather than the other way round.
 */
const MARK_STROKE = TIRE_MARK_STROKE;

type ChartMetrics = {
  height: number;
  padBottom: number;
  plotBottom: number;
  /** Optical box both marker glyphs are drawn inside. */
  markSize: number;
  /** Glyph centres, not tops — the two rows share one vertical grid. */
  setupRowCenter: number;
  tireRowCenter: number;
  /**
   * Run-label baseline, measured down from the plot rather than up from the SVG
   * bottom, so axis → wrench → tire → label is one even rhythm. Every face uses
   * it even where a row is absent, so the axis can't shift on a swipe.
   */
  labelBaseline: number;
  /** Below this px-per-run the glyphs would touch, so both rows thin to changes only. */
  markMinSpacing: number;
  /** Roughly how many x-axis labels fit before they collide. */
  labelBudget: number;
};

function chartMetrics(chartWidth: number): ChartMetrics {
  const spacious = chartWidth >= SPACIOUS_AT;
  const height = spacious ? 384 : 252;
  const padBottom = spacious ? 84 : 68;
  const plotBottom = height - padBottom;
  return {
    height,
    padBottom,
    plotBottom,
    markSize: spacious ? 20 : 16,
    setupRowCenter: plotBottom + (spacious ? 20 : 17),
    tireRowCenter: plotBottom + (spacious ? 46 : 38),
    labelBaseline: plotBottom + (spacious ? 73 : 62),
    markMinSpacing: spacious ? 28 : 22,
    labelBudget: spacious ? 14 : 8,
  };
}

const PAD_LEFT = 38;
const PAD_RIGHT = 14;
const PAD_TOP = 14;

function seconds(value: number | null | undefined, digits = 3): string {
  return value == null ? "—" : value.toFixed(digits);
}

/**
 * Gridline values snapped to round increments (…, 0.1, 0.2, 0.5, 1, 2, 5, …)
 * inside [lo, hi] — never arbitrary fractions of the range. `minStep` floors the
 * increment for integer metrics (mistake counts) so labels can't duplicate.
 */
function niceTicks(lo: number, hi: number, minStep = 0): number[] {
  const span = hi - lo;
  if (span <= 0) return [];
  const rawStep = span / 3.5;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = pow * 10;
  for (const multiple of [1, 2, 5]) {
    if (pow * multiple >= rawStep) {
      step = pow * multiple;
      break;
    }
  }
  step = Math.max(step, minStep);
  const first = Math.ceil(lo / step);
  const ticks: number[] = [];
  for (let i = first; i * step <= hi + step * 1e-6; i++) ticks.push(i * step);
  return ticks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One run's box-and-whisker. Whiskers are asymmetric on purpose: the bottom
 * always reaches the best lap (a fast tail is performance, never an outlier to
 * clip), the top stops at the slowest lap that isn't a mistake, and mistakes
 * sit above as dots.
 *
 * A mistake beyond the domain clamps to the top edge and goes stroke-only —
 * holding one crash lap on scale would flatten every box on the chart, and a
 * hollow dot reads as "off scale" without needing a caret. The hovered run's
 * real value is still named in the readout strip.
 *
 * Grows from its own median on the morph, so each box rises out of the line it
 * replaces. `transform-box` is set explicitly — its initial value has changed
 * across spec revisions and browsers disagree on the default.
 */
function RunSpreadBox({
  distribution,
  x,
  boxWidth,
  scale,
  expanded,
  emphasized,
}: {
  distribution: AnalysisRunDistribution;
  x: number;
  boxWidth: number;
  scale: { lo: number; hi: number; yAt: (value: number) => number };
  expanded: boolean;
  emphasized: boolean;
}) {
  const { best, p25, median, p75, slowestClean, mistakes } = distribution;
  const yMedian = scale.yAt(median);
  const yTop = scale.yAt(p75);
  const boxHeight = Math.max(1.5, scale.yAt(p25) - yTop);
  const degraded = boxWidth <= BOX_DEGRADE_AT;
  // Quartiles span every included lap, mistakes included, so that the median bar
  // is the same number as the Line view's Median series. When a run's whole top
  // quartile is mistakes, Q3 lands above the slowest clean lap and there is no
  // upper whisker to draw — the box top already exceeds every clean lap.
  const hasUpperWhisker = slowestClean > p75;

  return (
    <g
      className="motion-safe:transition-transform motion-safe:duration-[420ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.3,1)]"
      style={{
        transformBox: "view-box",
        transformOrigin: `${x}px ${yMedian}px`,
        transform: expanded ? undefined : "scaleY(0.001)",
      }}
    >
      {hasUpperWhisker ? (
        <line
          x1={x}
          x2={x}
          y1={scale.yAt(slowestClean)}
          y2={yTop}
          stroke={WHISKER_COLOR}
          strokeWidth={1.5}
        />
      ) : null}
      <line
        x1={x}
        x2={x}
        y1={scale.yAt(p25)}
        y2={scale.yAt(best)}
        stroke={WHISKER_COLOR}
        strokeWidth={1.5}
      />

      {degraded ? (
        // Too tight to read as a box: the quartile range becomes a thick line.
        <>
          <line
            x1={x}
            x2={x}
            y1={yTop}
            y2={scale.yAt(p25)}
            stroke={BOX_COLOR}
            strokeWidth={3.5}
          />
          <line x1={x - 3.5} x2={x + 3.5} y1={yMedian} y2={yMedian} stroke={SPREAD_INK} strokeWidth={2} />
        </>
      ) : (
        <>
          <rect
            x={x - boxWidth / 2}
            y={yTop}
            width={boxWidth}
            height={boxHeight}
            rx={2.5}
            fill={BOX_COLOR}
            fillOpacity={BOX_FILL_OPACITY}
            stroke={BOX_COLOR}
            strokeWidth={emphasized ? 2 : 1.5}
          />
          <line
            x1={x - boxWidth / 2}
            x2={x + boxWidth / 2}
            y1={yMedian}
            y2={yMedian}
            stroke={SPREAD_INK}
            strokeWidth={2.5}
          />
          {hasUpperWhisker ? (
            <line
              x1={x - boxWidth * 0.3}
              x2={x + boxWidth * 0.3}
              y1={scale.yAt(slowestClean)}
              y2={scale.yAt(slowestClean)}
              stroke={BOX_COLOR}
              strokeWidth={2}
            />
          ) : null}
          {/* Same bright ink as the `best` line — one mark to track across the morph. */}
          <line
            x1={x - boxWidth * 0.34}
            x2={x + boxWidth * 0.34}
            y1={scale.yAt(best)}
            y2={scale.yAt(best)}
            stroke={SPREAD_INK}
            strokeWidth={2.5}
          />
        </>
      )}

      {mistakes.map((lapTime, index) => {
        const offScale = lapTime > scale.hi;
        const spread = mistakes.length > 1 ? (index - (mistakes.length - 1) / 2) * 5 : 0;
        return (
          <circle
            key={`${lapTime}-${index}`}
            cx={x + (offScale ? spread : spread * 0.6)}
            cy={offScale ? PAD_TOP + 3.5 : scale.yAt(lapTime)}
            r={3}
            fill={offScale ? "none" : MISTAKE_COLOR}
            stroke={MISTAKE_COLOR}
            strokeWidth={offScale ? 1.5 : 0}
            opacity={offScale ? 0.9 : 1}
          />
        );
      })}
    </g>
  );
}

/** Spread-view readout row: the five box values, plus a mistake count when there is one. */
function SpreadReadoutValues({ run }: { run: AnalysisTrendRun }) {
  const distribution = run.distribution;
  if (!distribution) {
    return (
      <div className="mt-1 text-[11px] text-muted-foreground">
        Too few laps in this run for quartiles.
      </div>
    );
  }
  const cells: Array<[string, number]> = [
    ["best", distribution.best],
    ["q1", distribution.p25],
    ["med", distribution.median],
    ["q3", distribution.p75],
    ["slowest", distribution.slowestClean],
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {cells.map(([label, value]) => (
        <span key={label} className="flex items-baseline gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">{label}</span>
          <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
            {seconds(value)}
          </span>
        </span>
      ))}
      {distribution.mistakes.length > 0 ? (
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">miss</span>
          <span
            className="font-mono text-[11.5px] font-medium tabular-nums"
            style={{ color: MISTAKE_COLOR }}
          >
            {distribution.mistakes.length}
          </span>
        </span>
      ) : null}
    </div>
  );
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

/**
 * One tire set on the marker grid — the same glyph the sessions rows draw, on
 * plot coordinates instead of in a DOM box. Bright / faint follows the indicator,
 * exactly as the wrench above it does.
 *
 * Pointer-transparent: a tap here means "open this run", which the chart handles.
 */
function TireMark({
  indicator,
  cx,
  cy,
  size,
}: {
  indicator: RunTireIndicator;
  cx: number;
  cy: number;
  size: number;
}) {
  return (
    <g
      className={indicator.changed ? "text-foreground" : "text-faint"}
      style={{ pointerEvents: "none" }}
    >
      <title>{formatTireIndicatorTitle(indicator)}</title>
      <TireMarkGlyph indicator={indicator} cx={cx} cy={cy} size={size} />
    </g>
  );
}

/**
 * The tire row, under the wrench row and on every face — the gutter says the same
 * thing whichever lens you swiped to, and the row that was Pace-only left the
 * other faces with a hole where it should have been.
 *
 * Thins to changed sets only when the runs are packed tighter than the glyphs,
 * on the same threshold the wrench row uses, so the two rows never disagree about
 * which columns exist.
 */
function TireSetRow({
  carRuns,
  xAt,
  dims,
}: {
  carRuns: AnalysisTrendRun[];
  xAt: (index: number) => number;
  dims: ChartMetrics;
}) {
  const withTires = carRuns
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.tireIndicator != null);
  if (withTires.length === 0) return null;
  const spacing = carRuns.length > 1 ? xAt(1) - xAt(0) : Number.POSITIVE_INFINITY;
  const shown =
    spacing >= dims.markMinSpacing
      ? withTires
      : withTires.filter(({ run }) => run.tireIndicator!.changed);
  return (
    <>
      {shown.map(({ run, index }) => (
        <TireMark
          key={`tire-${run.id}`}
          indicator={run.tireIndicator!}
          cx={xAt(index)}
          cy={dims.tireRowCenter}
          size={dims.markSize}
        />
      ))}
    </>
  );
}

/**
 * The wrench row: a wrench under *every* run, so the row reads as "here is the
 * car at each session" and any of them opens that run's setup sheet — the same
 * modal as the "View setup" button in Sessions.
 *
 * Brightness carries the signal, exactly as the tire row does: bright ink when
 * the chassis setup differed from the previous run on that car (tires / battery
 * / additive excluded — see `computeSetupChangesByRunId`), faint when the car
 * went back out as it came in. Presence stopped meaning "something changed", so
 * the eye scans for white, not for gaps.
 *
 * Each wrench is its own tap target — a transparent hit rect never wider than
 * the gap to its neighbour, since tiled wrenches would otherwise steal each
 * other's taps. Native `<title>` names the changed fields on hover / long-press.
 * A run with no car gets no wrench: the setup modal needs one to resolve the
 * sheet. Below `setupMinSpacing` px per run the wrenches would touch, so the row
 * thins back to changed runs only. Shared by all three faces.
 */
function SetupChangeRow({
  carRuns,
  xAt,
  dims,
  onOpenSetup,
  loadingRunId,
}: {
  carRuns: AnalysisTrendRun[];
  xAt: (index: number) => number;
  dims: ChartMetrics;
  onOpenSetup: (runId: string) => void;
  loadingRunId: string | null;
}) {
  const spacing = carRuns.length > 1 ? xAt(1) - xAt(0) : Number.POSITIVE_INFINITY;
  const changedOnly = spacing < dims.markMinSpacing;
  const marks = carRuns
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.carId != null && (!changedOnly || run.setupChange != null));
  if (marks.length === 0) return null;
  const hitWidth = Math.min(dims.markSize * 2, spacing);
  return (
    <>
      {marks.map(({ run, index }) => {
        const x = xAt(index);
        const changed = run.setupChange != null;
        const changedLabels = run.setupChange?.changedFieldLabels.join(", ") ?? "";
        const loading = loadingRunId === run.id;
        return (
          <g
            key={`setup-${run.id}`}
            role="button"
            tabIndex={0}
            aria-label={
              changed
                ? `View setup for ${run.shortLabel} — changed: ${changedLabels}`
                : `View setup for ${run.shortLabel}`
            }
            className={cn(
              "cursor-pointer transition-colors hover:text-foreground focus-visible:text-foreground",
              loading
                ? "animate-pulse text-primary-ink"
                : changed
                  ? "text-foreground"
                  : "text-faint"
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenSetup(run.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenSetup(run.id);
              }
            }}
          >
            <title>{changed ? `View setup — changed: ${changedLabels}` : "View setup"}</title>
            <rect
              x={x - hitWidth / 2}
              y={dims.setupRowCenter - dims.markSize / 2 - 5}
              width={hitWidth}
              height={dims.markSize + 10}
              rx={6}
              fill="transparent"
            />
            <Wrench
              x={x - dims.markSize / 2}
              y={dims.setupRowCenter - dims.markSize / 2}
              width={dims.markSize}
              height={dims.markSize}
              strokeWidth={(MARK_STROKE * 24) / dims.markSize}
              aria-hidden
            />
          </g>
        );
      })}
    </>
  );
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

export function SessionTrendCard({
  trend,
  onSelectRun,
}: {
  trend: AnalysisTrendModel | null;
  /**
   * What tapping a run on the chart should do. Omitted, it navigates to
   * `/runs/<id>` — right on `/analysis`, where the chart is the whole surface and
   * the run is elsewhere. The Sessions workbench passes a handler instead: there
   * the run already has a home in the right-hand pane, so leaving the page to
   * read it would throw away the rail, the scroll position and the day you were
   * comparing against.
   */
  onSelectRun?: (runId: string) => void;
}) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(trend?.defaultCarId ?? null);
  // Tapping a wrench opens the same setup sheet the "View setup" button opens in
  // Sessions — but in-place here, no navigation. We fetch the run + compare
  // picker on demand (same endpoint RecentRunsCard uses) and mount the modal.
  const [setupModal, setSetupModal] = useState<{
    run: SetupSheetModalRun;
    pickerRuns: SetupSheetModalRun[];
  } | null>(null);
  const [setupLoadingRunId, setSetupLoadingRunId] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const openSetupForRun = async (runId: string) => {
    setSetupLoadingRunId(runId);
    setSetupError(null);
    try {
      const res = await fetch(`/api/runs/for-setup-compare?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { runs?: SetupSheetModalRun[] };
      const pickerRuns = Array.isArray(data.runs) ? data.runs : [];
      const anchor = pickerRuns.find((r) => r.id === runId);
      if (!res.ok || !anchor) throw new Error("load failed");
      setSetupModal({ run: anchor, pickerRuns });
    } catch {
      setSetupError("Couldn't load the setup for this run.");
    } finally {
      setSetupLoadingRunId(null);
    }
  };

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
      <Eyebrow dot="accent">Session trend</Eyebrow>

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
            content: (
              <PaceTrendFace
                carRuns={carRuns}
                scopeLabel={trend.scopeLabel}
                onOpenSetup={openSetupForRun}
                setupLoadingRunId={setupLoadingRunId}
                onSelectRun={onSelectRun}
              />
            ),
          },
          {
            id: "consistency",
            label: "Consistency",
            content: (
              <SingleMetricTrendFace
                carRuns={carRuns}
                metric="consistencyScore"
                title="Consistency"
                higherIsBetter
                color="rgb(var(--color-gain))"
                formatValue={(v) => `${v.toFixed(1)}%`}
                emptyLabel="No consistency data for this car yet in this window."
                onOpenSetup={openSetupForRun}
                setupLoadingRunId={setupLoadingRunId}
                onSelectRun={onSelectRun}
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
                higherIsBetter={false}
                color="rgb(var(--color-destructive))"
                formatValue={(v) => String(Math.round(v))}
                tickMinStep={1}
                emptyLabel="No mistake-eligible runs for this car yet in this window."
                onOpenSetup={openSetupForRun}
                setupLoadingRunId={setupLoadingRunId}
                onSelectRun={onSelectRun}
              />
            ),
          },
        ]}
      />

      {setupError ? <p className="text-[11px] text-destructive">{setupError}</p> : null}

      {setupModal ? (
        <SetupSheetModal
          open
          onClose={() => setSetupModal(null)}
          run={setupModal.run}
          pickerRuns={setupModal.pickerRuns}
        />
      ) : null}
    </SurfaceCard>
  );
}

/** Face 1 — the four-series pace band with a fixed readout strip, tire row, tap-to-open. */
function PaceTrendFace({
  carRuns,
  scopeLabel,
  onOpenSetup,
  setupLoadingRunId,
  onSelectRun,
}: {
  carRuns: AnalysisTrendRun[];
  scopeLabel: string;
  onOpenSetup: (runId: string) => void;
  setupLoadingRunId: string | null;
  onSelectRun?: (runId: string) => void;
}) {
  const router = useRouter();
  const openRun = useCallback(
    (runId: string) => {
      if (onSelectRun) onSelectRun(runId);
      else router.push(`/runs/${encodeURIComponent(runId)}`);
    },
    [onSelectRun, router]
  );
  const [view, setView] = useState<TrendView>("line");
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartRef, chartWidth] = useChartWidth(carRuns);
  const pointerDownRef = useRef<{ x: number; y: number; sameIndex: boolean } | null>(null);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PACE_VIEW_STORAGE_KEY);
      if (saved === "spread" || saved === "line") setView(saved);
    } catch {
      /* storage unavailable (private mode) — stay on the line view */
    }
  }, []);

  const chooseView = (next: TrendView) => {
    setView(next);
    try {
      window.localStorage.setItem(PACE_VIEW_STORAGE_KEY, next);
    } catch {
      /* non-fatal */
    }
  };

  const dims = useMemo(() => chartMetrics(chartWidth), [chartWidth]);

  const geometry = useMemo(() => {
    if (carRuns.length === 0) return null;
    const innerWidth = chartWidth - PAD_LEFT - PAD_RIGHT;
    const innerHeight = dims.height - PAD_TOP - dims.padBottom;
    const xAt = (index: number) =>
      PAD_LEFT + (carRuns.length === 1 ? innerWidth / 2 : (index / (carRuns.length - 1)) * innerWidth);
    const spacing = carRuns.length > 1 ? innerWidth / (carRuns.length - 1) : innerWidth;

    /** One y-scale over a set of values: 0.15s minimum span, 7% padding, snapped ticks. */
    const scaleFor = (values: number[]) => {
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
      return {
        lo,
        hi,
        yAt: (value: number) => PAD_TOP + ((hi - value) / (hi - lo)) * innerHeight,
        ticks: niceTicks(lo, hi),
      };
    };

    const lineValues: number[] = [];
    for (const run of carRuns) {
      for (const { key } of SERIES) {
        const v = run.metrics[key];
        if (v != null) lineValues.push(v);
      }
    }

    // The two views cannot share a domain. Spread spans the whiskers only —
    // one crash lap held on scale would flatten every box on the chart into a
    // sliver, so mistakes beyond `hi` clamp to the top edge instead.
    const spreadValues: number[] = [];
    for (const run of carRuns) {
      if (run.distribution) spreadValues.push(run.distribution.best, run.distribution.slowestClean);
    }

    return { xAt, spacing, line: scaleFor(lineValues), spread: scaleFor(spreadValues) };
  }, [carRuns, chartWidth, dims]);

  // A line needs two runs to be a line; a box plot of one run reads fine.
  const lineReady = carRuns.length >= 2 && geometry?.line != null;
  const spreadReady =
    geometry?.spread != null && carRuns.some((run) => run.distribution != null);
  const ready = view === "spread" ? spreadReady : lineReady;

  // The collapsed state has to paint before it's released or the boxes appear
  // fully grown. Skip it on mount (restored view) — only a real switch animates.
  const [morphed, setMorphed] = useState(true);
  const previousViewRef = useRef<TrendView | null>(null);
  useEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    if (view !== "spread" || previous == null || previous === "spread") return;
    setMorphed(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMorphed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [view]);

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
      openRun(run.id);
    }
  };

  const hoverRun = hoverIndex != null ? carRuns[hoverIndex] : null;
  // The readout strip always shows a run — the hovered one, else the latest —
  // so it has a stable height and the plot itself is never covered by a tooltip.
  const displayRun = hoverRun ?? carRuns[carRuns.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Above the readout so the control never moves when you use it. */}
      <PillToggle
        options={[
          { value: "line", label: "Line" },
          { value: "spread", label: "Spread" },
        ]}
        value={view}
        onChange={chooseView}
        role="tablist"
        ariaLabel="Pace chart view"
      />

      {ready && displayRun ? (
        <div className="rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {displayRun.shortLabel}
              </span>
              {displayRun.tireIndicator ? (
                <span className="flex items-center gap-1">
                  <TireIndicatorIcon
                    indicator={displayRun.tireIndicator}
                    size="sm"
                    className="-my-1 shrink-0"
                  />
                  <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">
                    {displayRun.tireIndicator.tireLabel}
                    {displayRun.tireIndicator.runNumber != null
                      ? ` · run ${displayRun.tireIndicator.runNumber}`
                      : ""}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          {view === "spread" ? (
            <SpreadReadoutValues run={displayRun} />
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {SERIES.filter((series) => !hidden.has(series.key)).map((series) => (
                <span key={series.key} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: series.color }}
                    aria-hidden
                  />
                  <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                    {seconds(displayRun.metrics[series.key])}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {geometry && ready ? (
        <div ref={chartRef} className="relative">
          <svg
            width="100%"
            height={dims.height}
            viewBox={`0 0 ${chartWidth} ${dims.height}`}
            className="block cursor-pointer touch-pan-y"
            role="img"
            aria-label={
              view === "spread"
                ? `Lap spread across ${carRuns.length} runs — ${scopeLabel}. Tap a run to open it.`
                : `Lap metric trend across ${carRuns.length} runs — ${scopeLabel}. Tap a run to open it.`
            }
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
            {/* One tick set per domain; the inactive one cross-fades out. */}
            {(["line", "spread"] as const).map((mode) => {
              const scale = geometry[mode];
              if (!scale) return null;
              return (
                <g
                  key={mode}
                  className={cn(
                    "motion-safe:transition-opacity motion-safe:duration-300",
                    view === mode ? "opacity-100" : "opacity-0"
                  )}
                >
                  {scale.ticks.map((tick) => (
                    <g key={tick}>
                      <line
                        x1={PAD_LEFT}
                        x2={chartWidth - PAD_RIGHT}
                        y1={scale.yAt(tick)}
                        y2={scale.yAt(tick)}
                        className="stroke-border"
                        strokeWidth={1}
                      />
                      <text
                        x={PAD_LEFT - 6}
                        y={scale.yAt(tick) + 3}
                        textAnchor="end"
                        className="fill-faint font-mono text-[9px] tabular-nums"
                      >
                        {tick.toFixed(2)}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}

            {/*
              The shelf the marker gutter hangs from: above it is lap time, below
              it is the state of the car. Without the rule the glyph rows float
              and their alignment to the plot is left to the eye.
            */}
            <line
              x1={PAD_LEFT}
              x2={chartWidth - PAD_RIGHT}
              y1={dims.plotBottom}
              y2={dims.plotBottom}
              className="stroke-border"
              strokeWidth={1}
            />

            {carRuns.map((run, index) => {
              const step = Math.max(1, Math.ceil(carRuns.length / dims.labelBudget));
              const isLast = index === carRuns.length - 1;
              const stepped = index % step === 0 && carRuns.length - 1 - index >= step;
              if (!isLast && !stepped) return null;
              return (
                <text
                  key={run.id}
                  x={geometry.xAt(index)}
                  y={dims.labelBaseline}
                  textAnchor="middle"
                  className={cn("font-mono text-[9px]", isLast ? "fill-muted-foreground" : "fill-faint")}
                >
                  {run.shortLabel}
                </text>
              );
            })}

            <TireSetRow carRuns={carRuns} xAt={geometry.xAt} dims={dims} />

            <SetupChangeRow
              carRuns={carRuns}
              xAt={geometry.xAt}
              dims={dims}
              onOpenSetup={onOpenSetup}
              loadingRunId={setupLoadingRunId}
            />

            {hoverIndex != null ? (
              <line
                x1={geometry.xAt(hoverIndex)}
                x2={geometry.xAt(hoverIndex)}
                y1={PAD_TOP - 2}
                // Runs on through the gutter so the hovered run's wrench and tire
                // are visibly the same column as the point you're reading.
                y2={dims.tireRowCenter + dims.markSize / 2 + 5}
                className="stroke-border"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}

            {geometry.line ? (
              <g
                className={cn(
                  "motion-safe:transition-opacity motion-safe:duration-300",
                  view === "line" ? "opacity-100" : "opacity-0"
                )}
              >
                {[...SERIES].reverse().map((series) => {
                  const scale = geometry.line!;
                  const points = carRuns.map((run, index) => {
                    const v = run.metrics[series.key];
                    return v == null ? null : { x: geometry.xAt(index), y: scale.yAt(v) };
                  });
                  const isHidden = hidden.has(series.key);
                  return (
                    <g
                      key={series.key}
                      className={cn("transition-opacity", isHidden && "opacity-[0.07]")}
                    >
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
              </g>
            ) : null}

            {geometry.spread ? (
              <g
                className={cn(
                  "motion-safe:transition-opacity motion-safe:duration-300",
                  view === "spread" ? "opacity-100" : "opacity-0"
                )}
              >
                {carRuns.map((run, index) =>
                  run.distribution ? (
                    <RunSpreadBox
                      key={run.id}
                      distribution={run.distribution}
                      x={geometry.xAt(index)}
                      boxWidth={clamp(geometry.spacing * 0.5, BOX_WIDTH_MIN, BOX_WIDTH_MAX)}
                      scale={geometry.spread!}
                      expanded={morphed}
                      emphasized={hoverIndex === index}
                    />
                  ) : null
                )}
              </g>
            ) : null}
          </svg>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {view === "spread"
            ? "Not enough laps in these runs to show lap spread yet."
            : carRuns.length === 1
              ? "One run with laps so far — log another and the trend line appears."
              : "No lap times for this car yet in this window."}
        </p>
      )}

      {/* Line-view only — these toggle series the spread view doesn't draw. The
          `hidden` set is React state, so what you switched off comes back with you. */}
      {view === "line" ? (
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
      ) : null}
    </div>
  );
}

/** Faces 2 & 3 — one metric per run as a single line; tap a run to open it. */
function SingleMetricTrendFace({
  carRuns,
  metric,
  title,
  higherIsBetter,
  color,
  formatValue,
  emptyLabel,
  tickMinStep = 0,
  onOpenSetup,
  setupLoadingRunId,
  onSelectRun,
}: {
  carRuns: AnalysisTrendRun[];
  metric: "consistencyScore" | "mistakeCount";
  title: string;
  higherIsBetter: boolean;
  color: string;
  formatValue: (value: number) => string;
  emptyLabel: string;
  /** Floor for the y-tick increment — 1 for integer metrics so labels can't repeat. */
  tickMinStep?: number;
  onOpenSetup: (runId: string) => void;
  setupLoadingRunId: string | null;
  onSelectRun?: (runId: string) => void;
}) {
  const router = useRouter();
  const openRun = useCallback(
    (runId: string) => {
      if (onSelectRun) onSelectRun(runId);
      else router.push(`/runs/${encodeURIComponent(runId)}`);
    },
    [onSelectRun, router]
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartRef, chartWidth] = useChartWidth(carRuns);
  const dims = useMemo(() => chartMetrics(chartWidth), [chartWidth]);
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
    const innerHeight = dims.height - PAD_TOP - dims.padBottom;
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
    const ticks = niceTicks(lo, hi, tickMinStep);
    return { xAt, yAt, points, ticks };
  }, [present, carRuns, chartWidth, dims, higherIsBetter, metric, tickMinStep]);

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
      openRun(run.id);
    }
  };

  const hoverRun = hoverIndex != null ? carRuns[hoverIndex] : null;
  // Stable readout strip (see pace face) — hovered run, else the latest with data.
  const lastWithValue = [...carRuns].reverse().find((run) => run.metrics[metric] != null) ?? null;
  const displayRun = hoverRun ?? lastWithValue;
  const displayValue = displayRun ? displayRun.metrics[metric] : null;

  return (
    <div className="flex flex-col gap-3">
      {geometry && displayRun ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {displayRun.shortLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="font-mono text-[11.5px] font-medium tabular-nums text-foreground">
                {displayValue == null ? "—" : formatValue(displayValue)}
              </span>
            </span>
          </div>
        </div>
      ) : null}
      {geometry ? (
        <div ref={chartRef} className="relative">
          <svg
            width="100%"
            height={dims.height}
            viewBox={`0 0 ${chartWidth} ${dims.height}`}
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

            {/* Same shelf as the Pace face — see the comment there. */}
            <line
              x1={PAD_LEFT}
              x2={chartWidth - PAD_RIGHT}
              y1={dims.plotBottom}
              y2={dims.plotBottom}
              className="stroke-border"
              strokeWidth={1}
            />

            {carRuns.map((run, index) => {
              const step = Math.max(1, Math.ceil(carRuns.length / dims.labelBudget));
              const isLast = index === carRuns.length - 1;
              const stepped = index % step === 0 && carRuns.length - 1 - index >= step;
              if (!isLast && !stepped) return null;
              return (
                <text
                  key={run.id}
                  x={geometry.xAt(index)}
                  y={dims.labelBaseline}
                  textAnchor="middle"
                  className={cn("font-mono text-[9px]", isLast ? "fill-muted-foreground" : "fill-faint")}
                >
                  {run.shortLabel}
                </text>
              );
            })}

            <TireSetRow carRuns={carRuns} xAt={geometry.xAt} dims={dims} />

            <SetupChangeRow
              carRuns={carRuns}
              xAt={geometry.xAt}
              dims={dims}
              onOpenSetup={onOpenSetup}
              loadingRunId={setupLoadingRunId}
            />

            {hoverIndex != null ? (
              <line
                x1={geometry.xAt(hoverIndex)}
                x2={geometry.xAt(hoverIndex)}
                y1={PAD_TOP - 2}
                // Runs on through the gutter so the hovered run's wrench and tire
                // are visibly the same column as the point you're reading.
                y2={dims.tireRowCenter + dims.markSize / 2 + 5}
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
