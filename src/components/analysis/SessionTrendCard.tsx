"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import type {
  AnalysisRunDistribution,
  AnalysisTrendModel,
  AnalysisTrendRun,
} from "@/lib/analysis/analysisHomeModel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PillToggle } from "@/components/ui/PillToggle";
import { ButtonLink } from "@/components/ui/ButtonLink";
import {
  TireIndicatorIcon,
  TireMarkGlyph,
  TIRE_MARK_STROKE,
} from "@/components/runs/TireIndicatorIcon";
import { formatTireIndicatorTitle, type RunTireIndicator } from "@/lib/runs/tireSetChange";
import { carRatingBandCaption, carRatingBandColor } from "@/lib/runHandlingAssessment";
import { SetupSheetModal, type SetupSheetModalRun } from "@/components/runs/RunHistoryModalsLazy";
import { SetupCascadeQuestions } from "@/components/runs/SetupCascadeQuestions";
import type { SetupEditorSavedResult } from "@/components/setup/useSetupEditorSave";
import { cn } from "@/lib/utils";

/**
 * Session trend — how the pace of an event or day moved, run by run: best / avg
 * top 5 / avg top 10 / median, lower = faster. Chart-series hues only — yellow
 * stays reserved for actions per VISUAL_NORTH_STAR.
 *
 * Two views behind the header toggle: the four-series Line chart, and Spread — a
 * box-and-whisker per run that shows the *shape* of a stint rather than four
 * summary numbers from it. Same axis, same units, so they read as one question
 * at two resolutions and the switch is a morph, not a swap.
 *
 * This was a three-face pager (Pace / Consistency / Mistakes) until 2026-08-16.
 * The two extra faces cost a picker row under the chart *and* pushed the
 * Line/Spread toggle into a row of its own above it — chrome measured in tens of
 * pixels on a 390px phone, ahead of a single lap time, for lenses nobody opened
 * the card to read. Mistakes survive where they are legible anyway: the red dots
 * and the count in Spread view.
 */

type SeriesKey = "best" | "avgTop5" | "avgTop10" | "median";

/** Pace face lens. Remembered per device alongside PagedCard's face memory. */
type TrendView = "line" | "spread";

const PACE_VIEW_STORAGE_KEY = "analysisTrendPaceView";

/**
 * One ink at four depths — warm grey, the app's own. Definitions and the reasoning
 * live on `--color-pace-*` in globals.css; the short version is that these four are
 * one measurement read at four resolutions, so they belong on an ordinal ramp, and
 * a ramp of one measurement does not need a hue.
 *
 * They were violet for part of 2026-08-25 and came back to grey the same day
 * (founder's call): four coloured lines over ash paper read as a picture about the
 * colour, pulling harder than the run rows underneath, which are the subject.
 *
 * What was actually wrong with the greys they replaced was the STEPPING, not the
 * grey: measured lightness ran [0.209, 0.515, 0.614, 0.468], so Median drew DARKER
 * than Avg top 10 and sat 0.047 from Top 5 — two of the four were one colour, in
 * the wrong order, at 1.75px on paper. The ramp in globals.css is monotone now,
 * every adjacent gap ≥ 0.11, so re-greying does not bring that back.
 *
 * Best lap keeps the thickest stroke as well as the deepest step, so the line you
 * came to read wins on both axes and survives being printed in one ink.
 */
const SERIES: Array<{ key: SeriesKey; name: string; color: string; width: number }> = [
  { key: "best", name: "Best lap", color: "rgb(var(--color-pace-1))", width: 2.5 },
  { key: "avgTop5", name: "Avg top 5", color: "rgb(var(--color-pace-2))", width: 1.75 },
  { key: "avgTop10", name: "Avg top 10", color: "rgb(var(--color-pace-3))", width: 1.75 },
  { key: "median", name: "Median", color: "rgb(var(--color-pace-4))", width: 1.75 },
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
 * How long the plot rests on each run while it walks itself through the day.
 *
 * The chart reads its own figures out, oldest run first, until you take it over
 * (2026-08-25). Before this it opened pointed at nothing: four lines, and a key row
 * printing the LAST run's numbers with no mark on the plot saying which column
 * those numbers came from. You had to know to drag a finger across it to discover
 * that the picture was readable at all — on a phone there is no hover to hint it.
 *
 * 1.1s is long enough to read a five-digit lap time and short enough that a
 * five-run day is over in under six seconds. It is a demonstration, not an
 * animation: the moment a pointer touches the plot the walk stands aside, and once
 * you actually pick a run it stops for good.
 */
const CYCLE_MS = 1100;

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
  /** False on the day screen: no wrench or tire row hangs under the plot. */
  gutter: boolean;
};

function chartMetrics(chartWidth: number, compact = false): ChartMetrics {
  const spacious = chartWidth >= SPACIOUS_AT;
  if (compact) {
    // Nothing below the axis but the run labels, so the only bottom padding is
    // the room those need: the 62-84px the glyph rows used is the whole saving.
    const height = spacious ? 268 : 176;
    const padBottom = 24;
    const plotBottom = height - padBottom;
    return {
      height,
      padBottom,
      plotBottom,
      markSize: spacious ? 20 : 16,
      setupRowCenter: plotBottom,
      tireRowCenter: plotBottom,
      labelBaseline: plotBottom + 15,
      markMinSpacing: spacious ? 28 : 22,
      labelBudget: spacious ? 14 : 8,
      gutter: false,
    };
  }
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
    gutter: true,
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
          <span className="micro-caps text-faint">{label}</span>
          <span className="text-[11px] font-medium tabular-nums text-foreground">
            {seconds(value)}
          </span>
        </span>
      ))}
      {distribution.mistakes.length > 0 ? (
        <span className="flex items-baseline gap-1">
          <span className="micro-caps text-faint">miss</span>
          <span
            className="text-[11px] font-medium tabular-nums"
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

/**
 * Measured chart width via ResizeObserver; each face measures independently.
 *
 * The first measurement is taken in a layout effect, BEFORE the browser paints.
 * The SVG keeps its aspect ratio, so a viewBox still holding the 340 default in a
 * pane twice that wide doesn't stretch — it draws the whole chart at half size,
 * centred in blank card, for exactly one frame and then snaps. That frame is the
 * one you get every time a chart mounts, and it reads as the chart resizing itself.
 */
function useChartWidth(dep: unknown): [React.RefObject<HTMLDivElement | null>, number] {
  const [chartWidth, setChartWidth] = useState(340);
  const chartRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measured = el.getBoundingClientRect().width;
    if (measured > 0) setChartWidth(measured);
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
  onFocusRun,
  markedRunId = null,
  compact = false,
  bare = false,
  heading,
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
  /**
   * The run currently under the pointer, or null. Lets whoever placed the card
   * light the same run in a list beside it — Sessions tints its rail row and its
   * phone row, so the chart and the list stop being two separate readings of one
   * day. Purely a pointer state: it fires on hover / scrub, never on selection,
   * and null-fires on unmount so a stale row can't stay lit.
   *
   * NOT the same run as the readout strip, which falls back to the latest run
   * when nothing is hovered. Lighting a row off that fallback would leave the
   * last row permanently marked for a chart nobody is touching.
   */
  onFocusRun?: (runId: string | null) => void;
  /**
   * The run the LIST is holding open, drawn on the plot (2026-08-25) — the return
   * leg of `onFocusRun`, which until now only ever travelled outward. Without it
   * the chart could light a row and the row could not light the chart back, so
   * unfolding Run 3 left the picture above it saying nothing about Run 3.
   *
   * Drawn as the accent rule the open row already wears down its left edge, plus a
   * fattened point per series, and the key row reads this run when the pointer is
   * away. A live pointer still outranks it: what your finger is on beats what you
   * left open.
   */
  markedRunId?: string | null;
  /**
   * The day screen's chart (2026-08-24), where the runs below it are the subject
   * and this is the picture above them.
   *
   * Everything the card spends height on to be self-sufficient comes off: the
   * Line/Spread toggle (Line only), the scope line (the page header two inches
   * up says the same day and venue), the hover readout (every figure in it is
   * already printed on the run row underneath), and the wrench + tire gutter —
   * whose one claim, "the setup moved on this run", the expanded row now writes
   * out in words and numbers instead of a glyph to be matched to a column.
   *
   * The series keys move up beside the title, so the whole chrome is one line.
   * Nothing here changes /analysis, where the card IS the surface.
   */
  compact?: boolean;
  /**
   * Compact only: draw the chart WITHOUT its card, for a host that already has one.
   *
   * `/analysis` puts the picture inside the outing it is a picture of (2026-08-25), under
   * that outing's name — a card of its own there was a second box saying nothing, and the
   * chart read as generic because nothing above it said which day it was drawing.
   */
  bare?: boolean;
  /**
   * Compact only: what this chart is a picture of, drawn above the series keys.
   * `OutingHeading` on both surfaces that pass it.
   */
  heading?: ReactNode;
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
  /*
   * The "did your other runs have this wrong too?" questions the correction earned. Kept
   * out of the modal's own branch, so closing the sheet doesn't take the question with it.
   */
  const [cascade, setCascade] = useState<{
    runId: string;
    nonce: number;
    result: SetupEditorSavedResult;
  } | null>(null);
  // A correction mints a new snapshot, and the wrench row above is drawn from the
  // old one — so the chart has to be re-read once the editor saves.
  const setupRouter = useRouter();

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
  // The Line/Spread view lives up here rather than inside the chart, because its
  // toggle sits in the card header beside the eyebrow — the same shape
  // TeamDayCard's "Best / Top 5" uses. A header control is always on screen and
  // never moves, so switching views can't shift the button out from under the
  // thumb that just tapped it, and it costs no row of its own.
  const [view, setView] = useState<TrendView>("line");

  /**
   * Which series are switched off — state of the card, not of the plot, because
   * in compact mode the buttons that toggle them sit in the card header while
   * the lines they hide are drawn one level down.
   */
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  /*
   * Which run the key row is reading — the one the plot is pointed at.
   *
   * The plot already publishes this through `onFocusRun`; the card now listens in on
   * the way past rather than asking the plot for a second channel. Null resting, so
   * the row falls back to the latest run, which is the same fallback the full card's
   * readout strip has always used.
   */
  const [readRunId, setReadRunId] = useState<string | null>(null);
  /**
   * The run the key row prints: the one the plot is reading, else the one the list
   * below is holding open, else the latest.
   *
   * "Reading" is the plot's own word — a pointer on it, or the column its
   * left-to-right walk is resting on (`CYCLE_MS`). It arrives on `onReadRun` rather
   * than on `onFocusRun` because the two answer different questions: this card asks
   * "which run are these four numbers", and the host list asks "is the user's finger
   * on my row". The walk answers the first and must not answer the second.
   *
   * The marked run sits in the middle deliberately. What the plot is reading wins
   * because it is live; but with the plot resting, the four figures should belong to
   * the run you actually have open underneath, or the card prints Run 6's times
   * above an unfolded Run 3.
   */
  const readoutRun = useMemo(
    () =>
      carRuns.find((run) => run.id === readRunId) ??
      carRuns.find((run) => run.id === markedRunId) ??
      carRuns[carRuns.length - 1] ??
      null,
    [carRuns, readRunId, markedRunId]
  );
  const toggleSeries = useCallback((key: SeriesKey) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    if (compact) return; // one view here, and it is never the stored one
    try {
      const saved = window.localStorage.getItem(PACE_VIEW_STORAGE_KEY);
      if (saved === "spread" || saved === "line") setView(saved);
    } catch {
      /* storage unavailable (private mode) — stay on the line view */
    }
  }, [compact]);

  const chooseView = useCallback((next: TrendView) => {
    setView(next);
    try {
      window.localStorage.setItem(PACE_VIEW_STORAGE_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);

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

  if (compact) {
    /*
     * The body once, then wrapped — NOT two little `Shell` components chosen by a
     * ternary. A component declared during render is a new type on every render, so
     * React unmounts and remounts its whole subtree: the chart would lose its
     * measured width (and `useChartWidth` ignores 0, so it would silently fall back
     * to the 340px default). eslint's `react-hooks/static-components` refuses it
     * outright, and it is right to.
     */
    const body = (
      <>
        {/* The day this is a picture OF (2026-08-25). Without it the compact chart is
            four grey lines with no subject — the founder's word was "generic". Same
            component `/analysis` heads its outing with, so the two cannot drift. */}
        {heading}

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

        {/*
          Caption above the picture, figures below it (founder call, 2026-08-26).

          The two halves answer different questions and belong on different sides of
          the plot. The caption says what the picture is DRAWING — which run the plot
          is reading, on what rubber, at what time — and a picture's caption cannot sit
          under the thing it introduces or you have read the chart before you know what
          it is. The figures are READ OFF the plot, so they sit under it, where your eye
          already is when you take your finger off.
        */}
        <RunCaptionLine run={readoutRun} />

        <PaceTrendChart
          carRuns={carRuns}
          scopeLabel={trend.scopeLabel}
          view="line"
          compact
          hidden={hidden}
          onToggleSeries={toggleSeries}
          onOpenSetup={openSetupForRun}
          setupLoadingRunId={setupLoadingRunId}
          onSelectRun={onSelectRun}
          onFocusRun={onFocusRun}
          onReadRun={setReadRunId}
          markedRunId={markedRunId}
        />

        <SeriesFigureRow hidden={hidden} onToggle={toggleSeries} readoutRun={readoutRun} />
      </>
    );
    return bare ? (
      <div className="flex flex-col gap-2 px-2.5 pb-2.5 pt-2 sm:px-4">{body}</div>
    ) : (
      <SurfaceCard variant="hero" contentClassName="flex flex-col gap-2 p-2.5 sm:p-4">
        {body}
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard variant="hero" contentClassName="flex flex-col gap-3.5 p-4 sm:p-5">
      {/* `eyebrow-root` (hairline + pad) composed by hand rather than via
          <Eyebrow> so the view toggle can sit on the label's row — the same trick
          RecentRunsCard and the hub doors use. Composed, NOT overridden:
          `.eyebrow-root` is unlayered CSS while Tailwind 4 utilities live in
          `@layer utilities`, so passing `border-b-0` to <Eyebrow> is silently a
          no-op and the card ends up with two rules of two different lengths. */}
      <div className="eyebrow-root flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="eyebrow-label min-w-0 flex-1">Session trend</span>
          <PillToggle
            className="w-auto shrink-0 whitespace-nowrap"
            options={[
              { value: "line", label: "Line" },
              { value: "spread", label: "Spread" },
            ]}
            value={view}
            onChange={chooseView}
            role="tablist"
            ariaLabel="Pace chart view"
          />
        </div>
        {/* What this chart is actually charting (2026-08-20). It said nothing before — which day,
            which venue, which meeting were all left implied by "your most recent runs", so the
            picture only made sense to someone who already knew the answer.

            Its own line under the title, not beside it: the toggle already owns the right of that
            row, and `TeammatesCard` directly below tried the side-by-side version at 390px and
            lost both halves — a wrapped eyebrow AND a scope truncated mid-date.

            Flush left, NOT indented under the eyebrow's words. It was indented past the ink notch
            for one build and pulled: `TeammatesCard` prints this same line, in this same type, one
            card down the same page, and it sits flush — two identical lines at two indents on one
            screen reads as a mistake rather than as a refinement. */}
        <span className="type-timestamp block truncate">{trend.scopeLabel}</span>
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

      <PaceTrendChart
        carRuns={carRuns}
        scopeLabel={trend.scopeLabel}
        view={view}
        hidden={hidden}
        onToggleSeries={toggleSeries}
        onOpenSetup={openSetupForRun}
        setupLoadingRunId={setupLoadingRunId}
        onSelectRun={onSelectRun}
        onFocusRun={onFocusRun}
        markedRunId={markedRunId}
      />

      {setupError ? <p className="text-[11px] text-destructive">{setupError}</p> : null}

      {setupModal ? (
        <SetupSheetModal
          open
          onClose={() => setSetupModal(null)}
          run={setupModal.run}
          pickerRuns={setupModal.pickerRuns}
          /*
           * Same door as the run page's, so it edits like the run page's. This card
           * carries no viewer id, so ownership is left to the server test the modal
           * already waits on (`save.action === "mark"`) — the toggle stays hidden on
           * a run that isn't yours whatever this host passes.
           */
          onRunSetupCorrected={(result) => {
            // The questions travel too. A refresh on its own is what made the cascade
            // look deleted on every door except `/runs/[id]` (2026-08-25).
            const runId = setupModal.run.id;
            setCascade((prev) => ({ runId, nonce: (prev?.nonce ?? 0) + 1, result }));
            setupRouter.refresh();
          }}
        />
      ) : null}
      {cascade ? (
        <SetupCascadeQuestions
          key={cascade.runId}
          runId={cascade.runId}
          pending={cascade}
          onChanged={() => setupRouter.refresh()}
        />
      ) : null}
    </SurfaceCard>
  );
}

/** The four-series pace band with a fixed readout strip, tire row, tap-to-open. */
function PaceTrendChart({
  carRuns,
  scopeLabel,
  view,
  compact = false,
  hidden,
  onToggleSeries,
  onOpenSetup,
  setupLoadingRunId,
  onSelectRun,
  onFocusRun,
  onReadRun,
  markedRunId = null,
}: {
  carRuns: AnalysisTrendRun[];
  scopeLabel: string;
  /** Owned by the card, because the toggle for it lives in the card header. */
  view: TrendView;
  /** Day screen: plot only — no readout strip, no gutter, no key row. See `SessionTrendCard`. */
  compact?: boolean;
  /** Owned by the card too, for the same reason: compact draws the keys in the header. */
  hidden: Set<SeriesKey>;
  onToggleSeries: (key: SeriesKey) => void;
  onOpenSetup: (runId: string) => void;
  setupLoadingRunId: string | null;
  onSelectRun?: (runId: string) => void;
  onFocusRun?: (runId: string | null) => void;
  /**
   * The run this plot is currently READING — pointed at, or reached by the walk it
   * does on its own (see `CYCLE_MS`). Separate from `onFocusRun` on purpose:
   * `onFocusRun` is the user's finger, and a list beside the chart lights a row off
   * it. The walk is not the user's finger, so it must never reach through and start
   * flicking rows in someone else's list; it only moves the figures on this card.
   */
  onReadRun?: (runId: string | null) => void;
  /** The run the host's list is holding open. See `SessionTrendCard`. */
  markedRunId?: string | null;
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
  /**
   * The column the self-walk is resting on, and whether the walk has been taken
   * over. See `CYCLE_MS` for why the chart reads itself out at all.
   *
   * Two states rather than one nullable index, because "not walking" and "walking,
   * currently on run 1" are different things and the second has to survive a hover:
   * the pointer parks the walk on whatever column you leave it on, and the walk
   * carries on from there when your finger goes.
   */
  const [cycleIndex, setCycleIndex] = useState(0);
  const [walkTakenOver, setWalkTakenOver] = useState(false);
  const [chartRef, chartWidth] = useChartWidth(carRuns);
  const pointerDownRef = useRef<{ x: number; y: number; sameIndex: boolean } | null>(null);

  const dims = useMemo(() => chartMetrics(chartWidth, compact), [chartWidth, compact]);

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

  /*
   * The walk (2026-08-25). Four gates, and each one is a case where the chart
   * moving on its own would be wrong rather than merely unnecessary:
   *
   * - taken over — you have pressed the plot, so it is yours now;
   * - a run is open below — the picture is answering that run, and walking off it
   *   would leave the key row describing a column the open row does not match;
   * - Spread view — its emphasis is a box growing, which at 1.1s a step is a
   *   fidget, not a readout; the Line view's mark is a rule and four dots;
   * - fewer than two runs, or nothing to draw — there is no left-to-right.
   *
   * Reduced motion switches it off outright rather than slowing it down: someone
   * who has asked for stillness is not asking for a slower carousel. They lose
   * nothing, because the resting state — latest run, no mark — is what this chart
   * showed everyone before today.
   */
  const walking =
    !walkTakenOver && markedRunId == null && view === "line" && ready && carRuns.length >= 2;

  // Restart at the left whenever the set of runs changes under it — a car filter
  // can leave `cycleIndex` past the end of the new list.
  useEffect(() => {
    setCycleIndex(0);
  }, [carRuns]);

  useEffect(() => {
    // The timer STOPS under the pointer rather than ticking away behind it. Hover
    // already outranks the walk on screen, so leaving the interval running looked
    // right and wasn't: park on run 2, read it for three seconds, take your finger
    // off, and the chart jumped to run 5 because that is where the clock had got to.
    // Measured, not reasoned about — the on-screen readout went "Run 2 → Run 5 → Run 1".
    if (!walking || hoverIndex != null) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setCycleIndex((index) => (index + 1) % carRuns.length),
      CYCLE_MS
    );
    return () => window.clearInterval(timer);
  }, [walking, hoverIndex, carRuns.length]);

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
    if (index == null) return;
    setHoverIndex(index);
    // Hovering only STANDS the walk aside — the pointer outranks it while it is on
    // the plot. Handing the walk the column you left on means the chart carries on
    // from where your eye was rather than snapping back to wherever the timer got
    // to while you were reading.
    setCycleIndex(index);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = nearestRunIndex(event);
    if (index == null) return;
    // A press is the chart being taken over, and it does not hand back. Set here
    // rather than in `handleClick`: on touch the first press only moves the
    // pointer (`sameIndex` is false), and a walk that resumed under a thumb
    // already resting on the plot would move the column out from under the
    // second tap.
    setWalkTakenOver(true);
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
  /*
   * The column the plot is pointing at: your finger first, then the walk.
   *
   * Everything the chart draws as "here" — the dashed rule, the fattened points,
   * the figures in the readout — reads this one index, so the walk is literally the
   * hover state moving on a timer and there is no second set of marks to keep in
   * step with the first.
   *
   * Clamped, because `cycleIndex` outlives one render of a car filter that shortens
   * the list; the reset effect above lands a tick later.
   */
  const activeIndex = hoverIndex ?? (walking ? Math.min(cycleIndex, carRuns.length - 1) : null);
  const activeRun = activeIndex != null ? (carRuns[activeIndex] ?? null) : null;
  // The readout strip always shows a run — the one being pointed at, else the
  // latest — so it has a stable height and the plot is never covered by a tooltip.
  const displayRun = activeRun ?? carRuns[carRuns.length - 1] ?? null;

  /*
   * The run the host's list is holding open, as a column on this plot.
   *
   * Suppressed while that same column is under the pointer: hover already draws a
   * rule and fat points there, and two marks stacked on one column read as a
   * rendering fault rather than as two facts. A car filter that hides the marked
   * run simply leaves nothing marked — `indexOf` returns -1 and we drop it.
   */
  const markedIndex = useMemo(() => {
    if (!markedRunId) return null;
    const index = carRuns.findIndex((run) => run.id === markedRunId);
    return index < 0 || index === activeIndex ? null : index;
  }, [carRuns, markedRunId, activeIndex]);

  /*
   * Publish the hovered run so a list beside the chart can light the same row.
   *
   * `hoverRun`, not `displayRun`: the strip's resting fallback is the latest run,
   * and lighting a row off that would leave the last row marked forever.
   *
   * Held in a ref because callers pass an inline arrow. Depending on the callback
   * itself would re-run this effect on every parent render — publishing the same
   * id over and over into a parent that re-renders on receiving it.
   */
  const focusedRunId = hoverRun?.id ?? null;
  const onFocusRunRef = useRef(onFocusRun);
  // Declared before the publish effect, so a commit that changes both the
  // callback and the hovered run publishes through the new callback.
  useEffect(() => {
    onFocusRunRef.current = onFocusRun;
  }, [onFocusRun]);
  useEffect(() => {
    onFocusRunRef.current?.(focusedRunId);
  }, [focusedRunId]);
  // Leaving the card must not leave a row lit — the pane swaps on selection.
  useEffect(() => () => onFocusRunRef.current?.(null), []);

  /*
   * And the same again for the run being READ, which the walk moves and the pointer
   * does not own. Same ref dance, same reason — see `onReadRun` on the props.
   */
  const readRunId = activeRun?.id ?? null;
  const onReadRunRef = useRef(onReadRun);
  useEffect(() => {
    onReadRunRef.current = onReadRun;
  }, [onReadRun]);
  useEffect(() => {
    onReadRunRef.current?.(readRunId);
  }, [readRunId]);
  useEffect(() => () => onReadRunRef.current?.(null), []);

  return (
    <div className={cn("flex flex-col", compact ? "gap-0" : "gap-3")}>
      {/* Every figure in this strip is printed on the run's own row underneath on
          the day screen, so compact draws no readout at all. */}
      {ready && displayRun && !compact ? (
        <div className="rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {/* The full name, not the axis code. This strip is full width even
                  at 390px and exists to say what your finger is on, so "Q2" was
                  the one place the code was costing us a word we had room for. */}
              <span className="truncate text-[12.5px] font-semibold leading-tight tracking-tight text-foreground">
                {displayRun.sessionName}
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
            {/*
              The clock, held right against the strip's own edge.

              The strip already says which run you are on; a chart of a day says
              nothing about where in that day each point sat, and the driver reading
              it is looking for the run that fell in the heat. The row was built with
              `justify-between` and one child, so the slot was there waiting — the
              time costs no height and no second line at 390px.
            */}
            <span className="flex shrink-0 items-baseline gap-2">
              <RunExtraFigures run={displayRun} />
              {displayRun.timeLabel ? (
                <span className="tabular-nums text-[10.5px] leading-tight text-muted-foreground">
                  {displayRun.timeLabel}
                </span>
              ) : null}
            </span>
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
          <span className="text-[11px] font-medium tabular-nums text-foreground">
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
                        className="fill-faint text-[9px] tabular-nums"
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
              // The open run always gets its name printed, even on a long day where
              // the label budget would otherwise have stepped over it — a marked
              // column with no label underneath is a mark you can't name.
              const isMarked = index === markedIndex;
              if (!isLast && !stepped && !isMarked) return null;
              return (
                <text
                  key={run.id}
                  x={geometry.xAt(index)}
                  y={dims.labelBaseline}
                  textAnchor="middle"
                  className={cn(
                    "tabular-nums text-[9px]",
                    isMarked
                      ? "fill-foreground font-semibold"
                      : isLast
                        ? "fill-muted-foreground"
                        : "fill-faint"
                  )}
                >
                  {run.shortLabel}
                </text>
              );
            })}

            {dims.gutter ? (
              <>
                <TireSetRow carRuns={carRuns} xAt={geometry.xAt} dims={dims} />

                <SetupChangeRow
                  carRuns={carRuns}
                  xAt={geometry.xAt}
                  dims={dims}
                  onOpenSetup={onOpenSetup}
                  loadingRunId={setupLoadingRunId}
                />
              </>
            ) : null}

            {/*
              The open run's column, in the accent the open row wears down its own
              left edge — solid, where hover's is dashed, because one is a thing you
              left open and the other is a thing you are touching. Yellow is legal
              here for the same reason it is legal on active nav: it marks WHERE YOU
              ARE, not how fast anything was (VISUAL_NORTH_STAR).

              Drawn before the series so the lines and their points sit on top of it.
            */}
            {markedIndex != null ? (
              <line
                x1={geometry.xAt(markedIndex)}
                x2={geometry.xAt(markedIndex)}
                y1={PAD_TOP - 2}
                y2={dims.gutter ? dims.tireRowCenter + dims.markSize / 2 + 5 : dims.plotBottom}
                className="stroke-primary-ink/45"
                strokeWidth={1.5}
              />
            ) : null}

            {activeIndex != null ? (
              <line
                x1={geometry.xAt(activeIndex)}
                x2={geometry.xAt(activeIndex)}
                y1={PAD_TOP - 2}
                // Runs on through the gutter so the hovered run's wrench and tire
                // are visibly the same column as the point you're reading. With no
                // gutter it stops at the axis, which is all there is to point at.
                y2={dims.gutter ? dims.tireRowCenter + dims.markSize / 2 + 5 : dims.plotBottom}
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
                      {activeIndex != null && !isHidden && points[activeIndex] ? (
                        <circle
                          cx={points[activeIndex].x}
                          cy={points[activeIndex].y}
                          r={4}
                          fill={series.color}
                          className="stroke-card"
                          strokeWidth={1.5}
                        />
                      ) : null}
                      {/* Same fat point for the open run, so its four figures are
                          findable on the plot and not just readable off the key. */}
                      {markedIndex != null && !isHidden && points[markedIndex] ? (
                        <circle
                          cx={points[markedIndex].x}
                          cy={points[markedIndex].y}
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
                      emphasized={activeIndex === index}
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
          `hidden` set is React state, so what you switched off comes back with you.
          Compact draws this same row in the card header instead, where it doubles
          as the card's title line. */}
      {view === "line" && !compact ? (
        <SeriesKeyRow hidden={hidden} onToggle={onToggleSeries} />
      ) : null}
    </div>
  );
}

/**
 * A sample of one series' actual line, for its cell — drawn at the same stroke
 * width the plot uses, so "Best lap" is visibly the fattest key as well as the
 * fattest line. A round dot said only "this colour"; a line sample says "this
 * line", which is the thing you are trying to find in the picture above.
 */
function SeriesMark({ color, width }: { color: string; width: number }) {
  return (
    <svg width="11" height="6" viewBox="0 0 11 6" aria-hidden className="shrink-0 overflow-visible">
      <line x1="0.5" y1="3" x2="10.5" y2="3" stroke={color} strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}

/**
 * The four measures, under the chart: the key to the picture and its readout at
 * once. Each cell names a line, draws a sample of it, and prints that line's figure
 * for whichever run the plot is currently reading — point at run 4 and the four
 * numbers become run 4's.
 *
 * ## Four cells, not four chips
 *
 * They wore `chipToggleClass` for a few hours on 2026-08-25 — bordered, filled,
 * `flex-1` — on the reasoning that they have ALWAYS been buttons (tap one and its
 * line drops off the plot) and nothing said so. What that actually produced was
 * four heavy outlined boxes directly under a delicate four-line chart, all four
 * "on" and therefore all four wearing the strongest border in the toggle family.
 * Founder, same day: "too big and looks weird". He is right, and the diagnosis is
 * that the borders were never carrying the affordance anyway — a chip that is on
 * looks exactly like a chip that is furniture.
 *
 * So: no box. Hairline dividers make it one strip instead of four objects, the
 * type comes down a step, and the row reads as an instrument under the plot rather
 * than as a row of buttons competing with it. The off state is the whole cell going
 * faint with its line sample drained — which is the one place `opacity` is the
 * honest signal, because a series that is off is literally a line that has gone.
 * The label and mark stay legible either way, so you can always find the switch you
 * threw.
 *
 * ## One row, values stacked
 *
 * A lone "Median" spilling to a second line reads as a separate group of controls
 * when it is the same group, so the row must not wrap and the labels are kept short
 * enough that it doesn't. That is also why the figure sits ABOVE the mark and label
 * rather than beside it: measured in Sora, the beside-it form wants ~103px a cell
 * (mark 11 + "Avg top 10" ~50 + a 5-digit tabular figure ~40 + gaps) and a 390px
 * phone has ~83px to spend. Stacked, a cell needs ~72px and all four fit with room
 * over. Founder call, 2026-08-25: one row.
 */
/**
 * The compact card's caption, ABOVE the plot: which run the picture is reading, what
 * rubber was under it, and when it ran.
 *
 *     Practice   Vaulk 36SK · run 3        Rating 7  Air 24°C   3:09 PM
 *
 * The rating and the air joined it on 2026-08-26 — see `RunExtraFigures` for why they sit
 * up here with the tyre rather than down in the figure strip.
 *
 * ## What is deliberately NOT on it (founder call, 2026-08-26)
 *
 * A wrench and a tyre disc rode here for one build. Both came off:
 *
 *   - the **tyre disc** decoded to "this set changed / this is its Nth run", and the
 *     words next to it already say `Vaulk 36SK · run 3`. A glyph you have to learn,
 *     beside the sentence it stands for, is a glyph that is not earning its ink;
 *   - the **wrench** said "the setup moved on this run". It is the one fact that
 *     leaves with it — you now find it by opening the run, where the change is
 *     written out as fields and numbers rather than as a mark to be matched to a
 *     column. That trade was made with eyes open; if it needs to come back it comes
 *     back as the WORD, not as a glyph.
 *
 * The session's name is what the run WAS ("Practice", "Qualifying 2"), not where it
 * fell in the day — the same reversal the rows below made on the same date.
 */
function RunCaptionLine({ run }: { run: AnalysisTrendRun | null }) {
  if (!run) return null;
  return (
    <div className="flex min-w-0 items-baseline gap-2 px-0.5">
      <span className="shrink-0 text-[11.5px] font-semibold tracking-tight text-foreground">
        {run.sessionName}
      </span>
      {run.tireIndicator ? (
        <span className="truncate text-[10.5px] text-muted-foreground">
          {run.tireIndicator.tireLabel}
          {run.tireIndicator.runNumber != null ? ` · run ${run.tireIndicator.runNumber}` : ""}
        </span>
      ) : null}
      {/*
        One right-hand group, not three things each reaching for `ml-auto` — with more
        than one auto margin on a flex row the free space is SHARED between them and the
        rating drifts into the middle of the line instead of sitting with the clock.
      */}
      <span className="ml-auto flex shrink-0 items-baseline gap-2">
        <RunExtraFigures run={run} />
        {run.timeLabel ? (
          <span className="text-[10px] tabular-nums text-faint">{run.timeLabel}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The four figures, UNDER the plot on the compact card — a swatch and a number each,
 * for whichever run the plot is reading.
 *
 * Under, not over (founder call, 2026-08-26, reversing the morning's arrangement):
 * these are read OFF the picture, so they belong on the side your eye is already on
 * when you lift your finger. The caption, which says what the picture IS, stays above
 * it — see `RunCaptionLine`.
 *
 * No names beside the swatches. The shade ramp is the label: dark to pale is best →
 * median in a fixed order, directly under the four lines it names, and the full card
 * still spells them out where there is width for it. Each is a toggle, as the named
 * cells are — tap one and its line leaves the plot.
 */
function SeriesFigureRow({
  hidden,
  onToggle,
  readoutRun,
}: {
  hidden: Set<SeriesKey>;
  onToggle: (key: SeriesKey) => void;
  readoutRun?: AnalysisTrendRun | null;
}) {
  const valueOf = (key: SeriesKey): number | null => {
    if (!readoutRun) return null;
    const m = readoutRun.metrics;
    return key === "best"
      ? m.best
      : key === "avgTop5"
        ? m.avgTop5
        : key === "avgTop10"
          ? m.avgTop10
          : m.median;
  };
  return (
    <div className="flex flex-nowrap items-center gap-x-4 px-0.5" role="group" aria-label="Metrics">
      {SERIES.map((series) => {
        const isHidden = hidden.has(series.key);
        const value = valueOf(series.key);
        return (
          <button
            key={series.key}
            type="button"
            onClick={() => onToggle(series.key)}
            aria-pressed={!isHidden}
            aria-label={series.name}
            className={cn(
              "tap-active flex min-w-0 items-center gap-1.5 rounded-[3px] py-0.5 transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
              isHidden ? "text-faint" : "text-foreground"
            )}
          >
            <span
              className={cn("h-[9px] w-[9px] shrink-0 rounded-[2.5px]", isHidden && "opacity-30")}
              style={{ backgroundColor: series.color }}
              aria-hidden
            />
            {/* Semibold, never bold — the weight every figure in this app is set in.
                Bold here made four numbers over a delicate four-line chart read as a
                scoreboard (founder, 2026-08-26). */}
            <span className="text-[13px] font-semibold tabular-nums leading-none tracking-tight">
              {value != null ? seconds(value) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The two figures that are NOT read off the lines: your 1–10 verdict on the car, and the
 * air it ran in. Added 2026-08-26.
 *
 * ## Why they sit in the readout and not on the plot
 *
 * The version that drew them was built and looked at first: a rating line over the four
 * pace lines, behind a pill row. It works — the shape of a bad slot is visible before any
 * number is — and it was dropped anyway, on two counts. It puts a second scale in a frame
 * that has one, where the overlay's HEIGHT means nothing in seconds and can therefore only
 * ever be read for shape; and it costs a control row, ~32px on a 390px phone, which is the
 * same toll that retired the three-face picker in August. The strip already walks itself
 * run by run, so the figures ride that mechanism for free and no pixel of chart is spent.
 *
 * If the overlay ever comes back it comes back as the RATING only. Air temperature as a
 * band was the weakest half of that build — decorative on a day the weather sat still, and
 * already answered by the numeral here.
 *
 * ## Why the caption line and not the figure strip
 *
 * Under the plot was where they were built, and it does not fit: four lap times at 13px
 * with their swatches already spend ~276 of the 328px a 390px phone gives that row, and
 * "Rating 7 · Air 15°C" wants another ~110. Measured on the real card, `16.204` and the
 * word "Rating" printed on top of each other. Shrinking the gaps and the words got within
 * ~13px of fitting, which is not fitting.
 *
 * The card's own rule then settles it rather than the arithmetic: the caption says what
 * the picture is DRAWING — which run, on what rubber, at what time — and the strip below
 * carries what is READ OFF the lines. A rating and an air temperature are not read off the
 * lines. They are two more facts about the run, and they belong in the sentence with the
 * tyre and the clock, which is also the line with the space for them.
 *
 * ## One shape, both cards
 *
 * The compact card and the full one keep their readouts in different furniture — a caption
 * line above the plot on the phone, a bordered strip above it on desktop — but both end
 * that line with the same right-hand group, so this renders once and is dropped into both.
 * It is NOT in the full card's bottom row: that row is the legend, handed no run to read,
 * and a rating has nothing to be the legend of.
 *
 * A missing half draws nothing at all rather than a dash: an empty label is a worse answer
 * than silence, and a run with neither figure gives the tyre and the clock their space back.
 */
function RunExtraFigures({ run }: { run: AnalysisTrendRun | null | undefined }) {
  const rating = run?.carRating ?? null;
  const air = run?.airTempC ?? null;
  if (rating == null && air == null) return null;

  /* The numeral wears its band's ink — the same ramp `RatingDial` fills its arc from, so a
     5 is the same colour wherever you meet it. This is not the pace ramp and not the
     accent: `--color-rating-*` is a verdict scale, which is exactly what this number is. */
  const ratingColor = carRatingBandColor(rating);
  // The band word is the tooltip's, not the line's — "Rating 7" is the whole line, and
  // spelling out "good" beside it costs a phone's width to say what the ink already says.
  const band = rating != null ? carRatingBandCaption(rating) : null;
  const ratingTitle =
    rating != null
      ? `Car rating ${rating} out of 10${band ? ` — ${band.toLowerCase()}` : ""}`
      : undefined;
  const airLabel = air != null ? `${Math.round(air)}°C` : null;

  /*
   * Caption voice, not figure voice: 9.5px label against a 11px numeral, a step under
   * the 13px the lap times are set in. They share a line with the tyre and the clock and
   * must read as more of that sentence, not as two more figures that wandered up off the
   * strip. The rating still gets its band ink, which is all the emphasis it needs.
   */
  return (
    <span className="flex shrink-0 items-baseline gap-2">
      {rating != null ? (
        <span className="flex items-baseline gap-1" title={ratingTitle}>
          <span className="text-[9.5px] leading-none text-muted-foreground">Rating</span>
          <span
            className="text-[11px] font-semibold tabular-nums leading-none tracking-tight"
            style={{ color: ratingColor }}
          >
            {rating}
          </span>
        </span>
      ) : null}
      {airLabel ? (
        <span className="flex items-baseline gap-1">
          <span className="text-[9.5px] leading-none text-muted-foreground">Air</span>
          <span className="text-[11px] font-semibold tabular-nums leading-none tracking-tight text-foreground">
            {airLabel}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function SeriesKeyRow({
  hidden,
  onToggle,
  className,
  readoutRun,
}: {
  hidden: Set<SeriesKey>;
  onToggle: (key: SeriesKey) => void;
  className?: string;
  /** The run the figures belong to — hovered/tapped, else the latest. */
  readoutRun?: AnalysisTrendRun | null;
}) {
  const valueOf = (key: SeriesKey): number | null => {
    if (!readoutRun) return null;
    const m = readoutRun.metrics;
    return key === "best" ? m.best : key === "avgTop5" ? m.avgTop5 : key === "avgTop10" ? m.avgTop10 : m.median;
  };
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {readoutRun ? (
        <div className="flex min-w-0 items-baseline gap-1.5 px-0.5">
          <span className="truncate text-[11.5px] font-semibold tracking-tight text-foreground">
            {readoutRun.sessionName}
          </span>
          {readoutRun.timeLabel ? (
            <span className="shrink-0 text-[10px] tabular-nums text-faint">
              {readoutRun.timeLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {/*
        `flex-1` with a cap, not plain `flex-1`: on the phone four cells share ~335px
        and land at ~83px each, under the cap, so nothing changes there. In the
        Sessions pane the row is ~1330px wide and four stretched cells read as four
        empty banners with a word in the middle of each.

        The dividers are what make this a strip rather than four objects, so they are
        drawn between the cells (`[&>*+*]`) and not around them.
      */}
      <div
        className={cn(
          "flex flex-nowrap items-stretch",
          // Dividers only when the cells carry figures. With four bare labels they
          // are a legend, and ruling a legend into columns implies a table.
          readoutRun && "[&>*+*]:border-l [&>*+*]:border-border/70"
        )}
        role="group"
        aria-label="Metrics"
      >
      {SERIES.map((series) => {
        const isHidden = hidden.has(series.key);
        const value = valueOf(series.key);
        return (
          <button
            key={series.key}
            type="button"
            onClick={() => onToggle(series.key)}
            aria-pressed={!isHidden}
            className={cn(
              "tap-active flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[3px] py-1",
              // With figures this is a strip and the cells share the width evenly.
              // Without them it is a legend and must sit left, at its own size — the
              // full card is ~1000px wide on desktop, and four stretched labels there
              // read as four empty banners with a word in the middle of each.
              readoutRun ? "max-w-[168px] flex-1 px-1" : "shrink-0 px-2.5",
              "transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
              isHidden ? "text-faint" : "text-foreground"
            )}
          >
            {value != null ? (
              <span className="text-[12.5px] font-semibold tabular-nums leading-none">
                {seconds(value)}
              </span>
            ) : null}
            <span className="flex min-w-0 items-center gap-1">
              {/* Drained, not recoloured, when the series is off: a line that is not
                  on the plot should not be advertising its ink at full strength, and
                  keeping the mark's shape and hue at 30% still tells you which line
                  you dropped when you go to put it back. */}
              <span className={cn("flex", isHidden && "opacity-30")}>
                <SeriesMark color={series.color} width={series.width} />
              </span>
              <span className="truncate text-[9.5px] leading-none tracking-tight">
                {series.name}
              </span>
            </span>
          </button>
        );
      })}
      {/* Deliberately no rating or air temperature here. On the full card this row is
          the LEGEND — it names the four lines and is handed no run to read — while the
          figures live in the readout strip above the plot, which is where those two
          joined them. A rating has nothing to be the legend of. */}
      </div>
    </div>
  );
}
