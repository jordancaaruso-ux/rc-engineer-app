"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PillToggle } from "@/components/ui/PillToggle";
import { formatLap } from "@/lib/runLaps";
import { formatClock, type TeamDayDriver, type TeamDayModel } from "@/lib/runs/teamDayModel";
import { cn } from "@/lib/utils";

/**
 * The team day — everyone who ran this session, on one clock.
 *
 * The only new chart in the Sessions rework. Everything else on this page is
 * `SessionTrendCard` re-rendered, and that chart plots run *sequence*, which
 * stops meaning anything the moment two people are on it: your run 3 and theirs
 * were not the same twenty minutes, and the track moves more in an hour than
 * most setups do. So this one is plotted against **time of day**, and the runs
 * line up under each other only when they actually happened together.
 *
 * ## Quiet by default
 *
 * Five drivers is five lines, and five colours would be a chart nobody can read
 * on a phone at a race track. So the default state has exactly one voice: the
 * anchor line in full ink, everyone else a hairline in muted ink. You can
 * already see the shape of the field and where you sit in it. Colour is opt-in —
 * tick up to three drivers in the list below and they light up in the
 * categorical hues, in fixed slot order.
 *
 * The anchor is you whenever you drove the day, and the fastest driver whenever
 * you didn't — there is ALWAYS one. Lighting nobody isn't a quieter chart, it is
 * a broken one: the same flag carries the dots and the scrubber, so a teammate's
 * day used to draw a single grey hairline that couldn't be dragged or tapped
 * while the hint underneath promised both.
 *
 * The hues are blue / orange / violet, never green or red: those two are spoken
 * for app-wide as pace and quality deltas, and a green driver line would read as
 * "gaining" to anyone who has used the rest of the product. See
 * `--color-series-*` in globals.css for the validation.
 *
 * ## A meeting is not a day
 *
 * Events group by `eventId`, so a three-day state title arrives here as one
 * "day". Plotted on a single clock, Sunday's 9am landed on top of Friday's 9am
 * and the line ran backwards every night — it read as the car losing two seconds
 * at lunchtime when it was a different lunchtime. So the plot is banded: one
 * stretch of clock per calendar day, side by side, each sized by its own hours.
 * Inside a band, time of day still means time of day and two drivers still line
 * up under each other. Between bands the line simply stops and restarts: the night
 * is real, and a segment drawn across it would be a slope nobody drove.
 *
 * ## One interaction, two sizes
 *
 * Drag anywhere on the plot and a crosshair snaps to the nearest run on an
 * emphasised line, with the numbers in a fixed readout row (fixed, so nothing
 * below it moves as you scrub). Tap that same point to open the run. It is the
 * same gesture with a mouse or a thumb, which is why the phone doesn't need a
 * second implementation of this card.
 */

type Metric = "best" | "avgTop5";

/** Fixed slot order, never cycled — a 4th tick is refused, not wrapped around. */
const COMPARE_HUES = [
  "rgb(var(--color-series-1))",
  "rgb(var(--color-series-2))",
  "rgb(var(--color-series-3))",
] as const;
export const MAX_COMPARE_DRIVERS = COMPARE_HUES.length;

/**
 * The driver row, and the header above it, on one template.
 *
 * Phone: rank · name · "View runs" · times.
 * Desktop: rank · name · "View runs" · spacer · runs · best · vs fastest.
 *
 * The pill is on BOTH, and the phone used to get a bare 16px chevron instead —
 * an arrow at the edge of a row is a hint that something might open, not a
 * statement of what. It cost nothing to swap: the pill carries its own chevron,
 * so dropping the trailing one pays for most of the width the words need, and
 * at 390px a name as long as "Christopher Vandenberg" still lands whole.
 *
 * The name column is a fixed 240px on desktop rather than `max-content` — the
 * pill has to land in the same place on every row, and a column that sizes to
 * its longest name moves it the moment somebody with a long name shows up.
 * Names longer than that truncate; the chart's line labels carry them in full.
 */
const ROW_GRID =
  "grid-cols-[18px_minmax(0,1fr)_auto_auto] items-center gap-2.5 " +
  "lg:grid-cols-[18px_240px_max-content_1fr_56px_84px_84px] lg:gap-[18px]";

const YOU_COLOR = "rgb(var(--color-foreground))";
const FIELD_COLOR = "rgb(var(--color-muted-foreground))";

/** Above this the plot has room for direct labels at the line ends. */
const LABELS_FIT_AT = 560;

const PAD_LEFT = 38;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const CHART_HEIGHT = 232;

type Series = {
  driver: TeamDayDriver;
  color: string;
  width: number;
  /** Ticked, or you — drawn at full strength and scrubbable. */
  lit: boolean;
  /** `dayKey` rides along so the line can break at a band edge instead of leaping it. */
  points: Array<{ x: number; y: number; index: number; dayKey: string }>;
};

/** A day's band once it has been given its slice of the plot. */
type PlacedBand = { key: string; label: string; minMinute: number; maxMinute: number; x0: number; x1: number };

/** Space between two days' bands. Wide enough to read as a gap, not as a gridline. */
const BAND_GUTTER = 18;
/** No band thinner than its own "Fri 26 Jun" header, however few runs that day held. */
const MIN_BAND = 54;

function niceTicks(lo: number, hi: number, want = 5): number[] {
  const raw = (hi - lo) / want;
  if (!Number.isFinite(raw) || raw <= 0) return [lo];
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/**
 * Hour ticks across ONE band, thinned so the labels never touch. `width` is that
 * band's own width, which on a four-day meeting at 390px is about 55px — the old
 * floor of two ticks printed "20:00" and "22:00" straight through each other, so
 * a band with room for one label gets its opening hour and nothing else.
 */
function hourTicks(min: number, max: number, width: number): number[] {
  const span = max - min;
  const maxTicks = Math.max(1, Math.floor(width / 56));
  let stepHours = 1;
  while (span / 60 / stepHours > maxTicks) stepHours *= 2;
  const out: number[] = [];
  for (let m = min; m <= max + 1e-9; m += stepHours * 60) out.push(m);
  return width < 92 && out.length > 1 ? [out[0]!] : out;
}

/**
 * The handle a driver goes by on a chip. The list below carries the full name,
 * so this only has to be recognisable, not complete — and it has to fit on a
 * phone next to four others.
 *
 * `driver.name` is one free-text display name, not a first/last pair, so a
 * one-word name keeps every letter it has: "Glenn" abbreviated is nothing.
 */
export function shortDriverName(name: string, isYou: boolean): string {
  if (isYou) return "You";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim() || "Driver";
  return `${parts[0]![0]!.toUpperCase()}. ${parts.slice(1).join(" ")}`;
}

export function TeamDayCard({
  day,
  title,
  onSelectDriver,
  onSelectRun,
  viewerUserId,
}: {
  day: TeamDayModel;
  title: string;
  onSelectDriver: (userId: string) => void;
  onSelectRun: (runId: string) => void;
  /**
   * Who is reading. Their line is the anchor — full ink, never dimmed, never a
   * slot hue. Null, or a viewer who didn't drive this day, falls back to the
   * fastest driver rather than lighting nobody.
   */
  viewerUserId: string | null;
}) {
  const [metric, setMetric] = useState<Metric>("best");
  const [compare, setCompare] = useState<string[]>([]);
  const [hover, setHover] = useState<{ driverId: string; index: number } | null>(null);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(340);
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

  const showLabels = chartWidth >= LABELS_FIT_AT;
  const padRight = showLabels ? 76 : 12;

  const toggleCompare = useCallback((userId: string) => {
    setCompare((current) => {
      const at = current.indexOf(userId);
      if (at >= 0) return current.filter((id) => id !== userId);
      if (current.length >= MAX_COMPARE_DRIVERS) return current;
      return [...current, userId];
    });
  }, []);

  /**
   * The line everything else is read against — full ink, dotted, scrubbable.
   *
   * Yours whenever you drove the day. On a day you didn't, it used to be nobody:
   * `lit` gates the dots, the stroke weight AND `nearest()`, so a teammate's day
   * drew one grey hairline that couldn't be dragged or tapped, and the hint under
   * it promised both. One driver is nobody to tick against and the chip row
   * doesn't even render there, so there was no way back either.
   *
   * The fallback is the fastest, which is `drivers[0]` — the model ranks by best
   * lap — and is already the driver the list below measures everyone against
   * under "vs fastest". A day where nobody set a timed lap has no fastest, so it
   * takes the first row rather than lighting an empty line.
   */
  const anchorId = useMemo(() => {
    if (viewerUserId && day.drivers.some((d) => d.userId === viewerUserId)) return viewerUserId;
    return (day.drivers.find((d) => d.best != null) ?? day.drivers[0])?.userId ?? null;
  }, [day.drivers, viewerUserId]);

  const colorFor = useCallback(
    (driver: TeamDayDriver): string => {
      const slot = compare.indexOf(driver.userId);
      if (slot >= 0) return COMPARE_HUES[slot]!;
      return driver.userId === anchorId ? YOU_COLOR : FIELD_COLOR;
    },
    [anchorId, compare]
  );

  /**
   * A three-day state title is ONE session, and a single 0–24h ruler folded its
   * Saturday morning on top of its Friday morning. So each calendar day gets its
   * own band, laid side by side and sized by the hours it actually used — time of
   * day still means time of day inside a band, and nothing is drawn across the gap.
   */
  const padBottom = day.days.length > 1 ? PAD_BOTTOM + 13 : PAD_BOTTOM;

  const { series, geom } = useMemo(() => {
    const key = metric === "best" ? "best" : "avgTop5";
    const values: number[] = [];
    for (const driver of day.drivers) {
      for (const point of driver.points) {
        const v = point[key];
        if (v != null) values.push(v);
      }
    }
    if (values.length === 0 || day.days.length === 0) return { series: [] as Series[], geom: null };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || 1) * 0.1;
    const lo = min - pad;
    const hi = max + pad;
    const plotRight = Math.max(PAD_LEFT + 40, chartWidth - padRight);

    // Width in proportion to the hours each day used, so a Friday-evening
    // practice band doesn't claim the same third of the chart as a full Sunday.
    const spans = day.days.map((band) => Math.max(60, band.maxMinute - band.minMinute));
    const totalSpan = spans.reduce((a, b) => a + b, 0) || 1;
    const usable = Math.max(
      60,
      plotRight - PAD_LEFT - BAND_GUTTER * (day.days.length - 1)
    );
    let widths = spans.map((span) => (span / totalSpan) * usable);
    // Proportional alone gives a two-hour Friday practice about 30px beside two
    // full days, and "Fri 26 Jun" is wider than that. Lift the thin bands to a
    // floor and take it back off the wide ones, which have hours to spare.
    if (usable > MIN_BAND * day.days.length) {
      const deficit = widths.reduce((sum, w) => sum + Math.max(0, MIN_BAND - w), 0);
      const surplus = widths.reduce((sum, w) => sum + Math.max(0, w - MIN_BAND), 0);
      if (deficit > 0 && surplus > 0) {
        widths = widths.map((w) =>
          w < MIN_BAND ? MIN_BAND : w - (w - MIN_BAND) * (deficit / surplus)
        );
      }
    }
    let cursor = PAD_LEFT;
    const bands: PlacedBand[] = day.days.map((band, i) => {
      const width = widths[i]!;
      const placed = { ...band, x0: cursor, x1: cursor + width };
      cursor += width + BAND_GUTTER;
      return placed;
    });
    const bandByKey = new Map(bands.map((b) => [b.key, b]));

    const xAt = (dayKey: string, minute: number) => {
      const band = bandByKey.get(dayKey) ?? bands[0]!;
      const span = band.maxMinute - band.minMinute || 1;
      return band.x0 + ((minute - band.minMinute) / span) * (band.x1 - band.x0);
    };
    // Faster (smaller) laps sit LOWER, exactly as SessionTrendCard draws them —
    // improving reads as the line falling, whichever chart you are looking at.
    const yAt = (value: number) =>
      PAD_TOP + ((hi - value) / (hi - lo)) * (CHART_HEIGHT - PAD_TOP - padBottom);

    const built: Series[] = day.drivers.map((driver) => {
      const slot = compare.indexOf(driver.userId);
      const lit = slot >= 0 || driver.userId === anchorId;
      return {
        driver,
        color: colorFor(driver),
        width: lit ? 2.4 : 1.3,
        lit,
        points: driver.points
          .map((point, index) => ({ point, index }))
          .filter(({ point }) => point[key] != null)
          .map(({ point, index }) => ({
            x: xAt(point.dayKey, point.minute),
            y: yAt(point[key] as number),
            index,
            dayKey: point.dayKey,
          })),
      };
    });

    return {
      series: built,
      geom: { lo, hi, xAt, yAt, plotRight, bands, ticks: niceTicks(lo, hi) },
    };
  }, [anchorId, chartWidth, colorFor, compare, day, metric, padBottom, padRight]);

  /** One `M…L…` run per band, so no line is drawn across the gap between days. */
  const pathFor = useCallback((points: Series["points"]) => {
    let out = "";
    let lastKey: string | null = null;
    for (const p of points) {
      out += `${p.dayKey === lastKey ? "L" : `${out ? " " : ""}M`}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
      lastKey = p.dayKey;
    }
    return out.trim();
  }, []);

  /** Line-end labels, pushed apart so two drivers finishing level stay readable. */
  const endLabels = useMemo(() => {
    if (!showLabels || !geom) return [];
    const rows = series
      .filter((s) => s.points.length > 0)
      .map((s) => {
        const last = s.points[s.points.length - 1]!;
        return { series: s, x: last.x + 8, anchorY: last.y, y: last.y };
      })
      .sort((a, b) => a.y - b.y);
    const GAP = 13;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.y - rows[i - 1]!.y < GAP) rows[i]!.y = rows[i - 1]!.y + GAP;
    }
    const overflow = rows.length ? rows[rows.length - 1]!.y - (CHART_HEIGHT - padBottom) : 0;
    if (overflow > 0) for (const row of rows) row.y -= overflow;
    return rows;
  }, [geom, padBottom, series, showLabels]);

  /** Nearest run on a lit line to a pointer position, in SVG units. */
  const nearest = useCallback(
    (svgX: number, svgY: number) => {
      let bestHit: { driverId: string; index: number; dist: number } | null = null;
      for (const s of series) {
        if (!s.lit) continue;
        for (const p of s.points) {
          const dist = Math.hypot(p.x - svgX, (p.y - svgY) * 0.35);
          if (!bestHit || dist < bestHit.dist) {
            bestHit = { driverId: s.driver.userId, index: p.index, dist };
          }
        }
      }
      return bestHit;
    },
    [series]
  );

  const pointerPos = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return null;
    const scale = chartWidth / box.width;
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== "mouse" && !event.buttons) return;
    const pos = pointerPos(event);
    if (!pos) return;
    const hit = nearest(pos.x, pos.y);
    setHover(hit ? { driverId: hit.driverId, index: hit.index } : null);
  };

  const hovered = useMemo(() => {
    if (!hover) return null;
    const driver = day.drivers.find((d) => d.userId === hover.driverId);
    const point = driver?.points[hover.index];
    if (!driver || !point) return null;
    return { driver, point };
  }, [day.drivers, hover]);

  const litCount = series.filter((s) => s.lit).length;

  return (
    <SurfaceCard variant="panel" contentClassName="p-0">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          {/* No rule of its own. `Eyebrow` draws one by default, but this header
              already ends in a hairline 30px below — and that one runs the full
              width of the card while the eyebrow's stops where the Best/Top 5
              pill begins. Two lines, different lengths, one job between them:
              the date ended up boxed in a band that read as a table row. */}
          <Eyebrow className="mb-0 border-b-0 pb-0">Pace overview</Eyebrow>
          {/* Phone hides it: the pushed screen's own header two rows above already
              says "Test day · 19 Jul 2026 · TFTR", and saying it twice in 40px is
              how a 390px screen runs out of room. Desktop keeps it — there the
              rail row is compact and the pane needs to name what it is showing. */}
          <h2 className="mt-1 hidden truncate text-[13.5px] font-semibold text-foreground lg:block">
            {title}
          </h2>
        </div>
        {/* "Best" / "Top 5", not the spelled-out labels — the long forms are wider
            than the pill at 390px and wrapped onto two lines, which pushed the
            title into an ellipsis. The app's run tables abbreviate here already. */}
        <PillToggle
          className="w-auto shrink-0 whitespace-nowrap"
          role="tablist"
          ariaLabel="What the chart plots"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "best", label: "Best", ariaLabel: "Best lap" },
            { value: "avgTop5", label: "Top 5", ariaLabel: "Average of the top 5 laps" },
          ]}
        />
      </div>

      {geom ? (
        <div ref={chartRef} className="px-2 pt-2">
          <svg
            width="100%"
            height={CHART_HEIGHT}
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            className="block touch-pan-y"
            role="img"
            aria-label={`${metric === "best" ? "Best lap" : "Average of the top 5 laps"} against time of day for ${day.drivers.length} drivers. Lower is faster.`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              handleMove(event);
            }}
            onPointerMove={handleMove}
            onPointerUp={() => setHover(null)}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setHover(null);
            }}
            onClick={(event) => {
              const pos = pointerPos(event);
              if (!pos) return;
              const hit = nearest(pos.x, pos.y);
              if (!hit) return;
              const driver = day.drivers.find((d) => d.userId === hit.driverId);
              const runId = driver?.points[hit.index]?.runId;
              if (runId) onSelectRun(runId);
            }}
          >
            {geom.ticks.map((tick) => (
              <g key={`y${tick}`}>
                <line
                  x1={PAD_LEFT}
                  x2={geom.plotRight}
                  y1={geom.yAt(tick)}
                  y2={geom.yAt(tick)}
                  stroke="rgb(var(--color-border))"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={geom.yAt(tick) + 3}
                  textAnchor="end"
                  className="fill-faint text-[9.5px] tabular-nums"
                >
                  {tick.toFixed(1)}
                </text>
              </g>
            ))}
            {geom.bands.map((band, bandIndex) => {
              const hourLabelY = CHART_HEIGHT - (geom.bands.length > 1 ? 21 : 8);
              return (
                <g key={band.key}>
                  {/* The gap alone reads as a rendering glitch at a glance, so the
                      boundary between two days carries a hairline as well. */}
                  {bandIndex > 0 ? (
                    <line
                      x1={band.x0 - BAND_GUTTER / 2}
                      x2={band.x0 - BAND_GUTTER / 2}
                      y1={PAD_TOP}
                      y2={CHART_HEIGHT - padBottom}
                      stroke="rgb(var(--color-border))"
                      strokeWidth={1}
                    />
                  ) : null}
                  {hourTicks(band.minMinute, band.maxMinute, band.x1 - band.x0).map(
                    (minute, i, all) => (
                      <text
                        key={`x${band.key}-${minute}`}
                        x={geom.xAt(band.key, minute)}
                        y={hourLabelY}
                        textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
                        className="fill-faint text-[9.5px] tabular-nums"
                      >
                        {formatClock(minute)}
                      </text>
                    )
                  )}
                  {geom.bands.length > 1 ? (
                    <text
                      x={(band.x0 + band.x1) / 2}
                      y={CHART_HEIGHT - 6}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px] font-semibold"
                    >
                      {band.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {/* Hairlines first so a lit line is never crossed by a dim one. */}
            {[...series]
              .sort((a, b) => Number(a.lit) - Number(b.lit))
              .map((s) => (
                <g key={s.driver.userId}>
                  <path
                    d={pathFor(s.points)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={s.lit ? 1 : litCount > 1 ? 0.35 : 0.55}
                  />
                  {s.lit
                    ? s.points.map((p) => (
                        <circle
                          key={p.index}
                          cx={p.x}
                          cy={p.y}
                          r={3}
                          fill={s.color}
                          stroke="rgb(var(--color-card))"
                          strokeWidth={1.4}
                        />
                      ))
                    : null}
                </g>
              ))}

            {hovered && geom
              ? (() => {
                  const value =
                    metric === "best" ? hovered.point.best : hovered.point.avgTop5;
                  if (value == null) return null;
                  const x = geom.xAt(hovered.point.dayKey, hovered.point.minute);
                  return (
                    <g pointerEvents="none">
                      <line
                        x1={x}
                        x2={x}
                        y1={PAD_TOP}
                        y2={CHART_HEIGHT - padBottom}
                        stroke="rgb(var(--color-muted-foreground))"
                        strokeWidth={1}
                        opacity={0.5}
                      />
                      <circle
                        cx={x}
                        cy={geom.yAt(value)}
                        r={5.5}
                        fill="none"
                        stroke={colorFor(hovered.driver)}
                        strokeWidth={2}
                      />
                    </g>
                  );
                })()
              : null}

            {endLabels.map((label) => (
              <g key={`l${label.series.driver.userId}`} pointerEvents="none">
                {Math.abs(label.y - label.anchorY) > 2 ? (
                  <path
                    d={`M${(label.x - 6).toFixed(1)} ${label.anchorY.toFixed(1)} L${(label.x - 2).toFixed(1)} ${label.y.toFixed(1)}`}
                    stroke={label.series.color}
                    strokeWidth={1}
                    fill="none"
                    opacity={label.series.lit ? 0.5 : 0.3}
                  />
                ) : null}
                <text
                  x={label.x}
                  y={label.y + 3.5}
                  fill={label.series.color}
                  opacity={label.series.lit ? 1 : 0.65}
                  className="text-[10px] font-semibold"
                >
                  {label.series.driver.name}
                </text>
              </g>
            ))}
          </svg>

          {/*
            Both states share one grid cell, and the idle hint is always in the DOM —
            merely hidden while you scrub. `min-h` was not enough: the hint wraps to
            two lines at 390px (it is prose, see below) while the readout is one, so
            the row lost a line the moment your name appeared and the driver list
            jumped 17px up the screen and back on release. Stacked, the taller of the
            two always sets the height, so the row is constant through a scrub at
            every width — and still only one line tall where the hint fits on one.
          */}
          <p className="grid min-h-[20px] px-1.5 pb-2.5 text-[11.5px]">
            {/* The idle line, not an empty row. Nothing about this plot says it
                can be scrubbed, and "time of day" is the one thing about it that
                differs from every other chart in the app — both belong on screen
                before you touch it, and both vanish once the readout has real
                numbers to show. */}
            {/* Wraps rather than truncating: unlike the readout it replaces, this
                line is prose, and a clipped "drag to read a ru…" teaches nobody
                the gesture it exists to teach. */}
            <span
              aria-hidden={hovered ? true : undefined}
              className={cn(
                "col-start-1 row-start-1 min-w-0 text-faint",
                hovered && "invisible"
              )}
            >
              {day.days.length > 1 ? "One band per day · " : ""}time of day along the bottom ·
              drag to read a run, tap to open it
            </span>
            {hovered ? (
              <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-semibold text-foreground">
                  {hovered.driver.name} · {hovered.point.label}
                </span>
                <span className="min-w-0 truncate tabular-nums text-muted-foreground">
                  {hovered.point.clock} · best{" "}
                  {hovered.point.best != null ? formatLap(hovered.point.best) : "—"} ·{" "}
                  {hovered.point.lapCount} laps
                </span>
              </span>
            ) : null}
          </p>

          {/*
            The legend AND the control, under the chart it acts on — the same
            shape `SessionTrendCard` puts under its own plot for Best lap / Avg
            top 5 / Median. It used to be a bordered swatch inside each list
            row, which made the one element on that row wearing a button's
            clothes the one that doesn't open anything; the row read as scenery
            and nobody found the door. Moving it here costs the old adjacency
            (mark beside name = mark on line) and buys a list that is nothing
            but doors.

            One driver is nobody to compare against, so the row doesn't render.
          */}
          {day.drivers.length > 1 ? (
            <div
              className="flex flex-wrap gap-1.5 px-1.5 pb-1.5"
              role="group"
              aria-label="Colour drivers on the chart"
            >
              {day.drivers.map((driver) => {
                const slot = compare.indexOf(driver.userId);
                const isYou = driver.userId === viewerUserId;
                const isAnchor = driver.userId === anchorId;
                // The locked chip says WHICH rule locked it. On your own day
                // that is "yours"; on a day you didn't drive it is the fastest,
                // and a chip that just refused to untick with no reason given
                // is the dead press the row below already learned not to be.
                const lockedLabel = isYou
                  ? "Your line is always shown"
                  : `${driver.name} is fastest today — always shown`;
                const atLimit = slot < 0 && !isAnchor && compare.length >= MAX_COMPARE_DRIVERS;
                return (
                  <button
                    key={driver.userId}
                    type="button"
                    aria-pressed={slot >= 0 || isAnchor}
                    disabled={atLimit}
                    title={
                      isAnchor
                        ? lockedLabel
                        : slot >= 0
                          ? `Stop colouring ${driver.name}`
                          : atLimit
                            ? "Three drivers at a time — untick one first"
                            : `Colour ${driver.name} on the chart`
                    }
                    aria-label={
                      isAnchor
                        ? lockedLabel
                        : slot >= 0
                          ? `Stop colouring ${driver.name}`
                          : `Colour ${driver.name} on the chart`
                    }
                    onClick={() => {
                      if (isAnchor) return;
                      toggleCompare(driver.userId);
                    }}
                    className={cn(
                      "tap-active flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[10.5px] tracking-tight transition-opacity",
                      // The anchor is locked on, not pressed — a toggle that
                      // looks pressed invites a tap that does nothing.
                      isAnchor
                        ? "cursor-default font-semibold text-foreground"
                        : "text-muted-foreground hover:border-ring/30",
                      slot < 0 && !isAnchor && "opacity-45",
                      atLimit && "opacity-30"
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: colorFor(driver) }}
                      aria-hidden
                    />
                    {/* Only the actual you is called "You" — the anchor on
                        someone else's day keeps their own name. */}
                    {shortDriverName(driver.name, isYou)}
                  </button>
                );
              })}
            </div>
          ) : null}
          {/* The swatch refused a 4th tick in silence. A chip row has the width
              to say why, so the dead press stops being a mystery. */}
          {compare.length >= MAX_COMPARE_DRIVERS ? (
            <p className="px-1.5 pb-2 text-[11px] text-faint">
              Three drivers at a time — untick one to swap.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          No lap times in this session yet.
        </p>
      )}

      <div className="flex items-baseline gap-2 border-t border-border px-4 py-2">
        {/* Rule off, same reason as "Pace overview" above: `Eyebrow` draws its own
            hairline, but that one stops where the word stops while the count sits
            beside it, and the column-header row already rules the full card width
            8px below. Two near-parallel lines of different lengths read as a
            misdrawn table, not as a heading. */}
        <Eyebrow className="mb-0 border-b-0 pb-0">Drivers</Eyebrow>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {day.drivers.length} driver{day.drivers.length === 1 ? "" : "s"} · {day.totalRuns} run
          {day.totalRuns === 1 ? "" : "s"}
        </span>
      </div>
      {/*
        Column headers, desktop only. In the Sessions pane this row is 1400px
        wide, and a bare strip that wide has nothing to read along — the eye
        never travels from the name to anything else on it. Four labels turn
        the strip into a table, and tables get read across.

        `hidden lg:grid` and `lg:hidden` do the switching, and the grid relies
        on that: a `display:none` child leaves the grid entirely, so the phone's
        four visible cells and the desktop's seven land in their own templates
        from one DOM order.

        `.table-col-header`, NOT `Eyebrow` — these label columns, they don't open
        sections. As eyebrows they were 17px bold uppercase with a yellow tick
        each, which put five ticks in 40px, printed "Drivers / DRIVER" as the same
        heading twice, wrapped "vs fastest" onto two lines in an 84px column, and
        drew four hairline stubs of four different widths above the row's own
        full-width border. `text-right` was also a no-op on them: `.eyebrow-root`
        is a flex row, and `text-align` doesn't move flex items — so every label
        sat left while its column of figures sat right.
      */}
      <div className={cn(ROW_GRID, "hidden border-t border-border px-3 py-2 lg:grid")}>
        <span />
        <span className="table-col-header">Driver</span>
        <span />
        <span />
        <span className="table-col-header text-right">Runs</span>
        <span className="table-col-header text-right">Best</span>
        <span className="table-col-header whitespace-nowrap text-right">vs fastest</span>
      </div>
      <ul className="border-t border-border lg:border-t-0">
        {day.drivers.map((driver) => {
          const isYou = driver.userId === viewerUserId;
          /*
           * Whose line the pointer is on, lit down here as well as up there.
           *
           * The chart names the driver in its readout; without this the list
           * below it stayed inert, so "which of these five rows am I reading?"
           * was a question you answered by matching a colour. The fill is the
           * row's own hover fill — the chart's pointer paints a row exactly as a
           * pointer on the row would — and it goes when the pointer goes.
           *
           * A row, not a run: this list is drivers. On a day with one line lit
           * the same row stays marked the whole scrub, which is correct and
           * says little; with two or three ticked on it follows your finger.
           */
          const pointedAt = hover?.driverId === driver.userId;
          return (
            <li key={driver.userId} className="group border-b border-border last:border-b-0">
              {/*
                One control, the whole row. There is nothing left on the row to
                compete with it, so the hover tint, the pointer and the pill all
                describe the same target — the shape `AssetListRow` uses for
                every openable row in the app.
              */}
              <button
                type="button"
                data-driver-id={driver.userId}
                aria-label={`View ${driver.name}'s runs`}
                onClick={() => onSelectDriver(driver.userId)}
                className={cn(
                  ROW_GRID,
                  "tap-active grid w-full cursor-pointer px-2.5 py-2 text-left transition-colors",
                  "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                  "lg:px-3 lg:py-2.5",
                  pointedAt && "bg-muted/50"
                )}
              >
                <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-faint">
                  {driver.pos}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-tight tracking-tight text-foreground">
                    {driver.name}
                    {isYou ? (
                      <span className="ml-1.5 rounded border border-border px-1 text-[9px] font-bold uppercase tracking-wider text-faint">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] leading-none text-faint">
                    {driver.carName}
                    {/* The count, not the verb — the pill says what the row does
                        at every width now. Phone-only because desktop has a whole
                        Runs column for it. */}
                    <span className="lg:hidden">
                      {" · "}{driver.runCount} run{driver.runCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
                {/*
                  The door sits against the name, third in the reading order —
                  not out at the far right, where on a 1400px pane it would have a
                  metre of empty table to carry. It says what is behind it — this
                  driver's runs — rather than what you do when you get there;
                  "session" was the word for the whole day AND for one driver's
                  part of it, so the pill named the thing you were already looking
                  at. Its own chevron is the only arrow on the row at any width.
                */}
                <span className="inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full border border-border px-3 py-1 text-[12px] font-semibold text-muted-foreground transition-colors group-hover:border-foreground group-hover:text-foreground">
                  View runs
                  <ChevronRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                {/* The spacer takes every pixel of leftover desktop width, so
                    the numbers keep the right edge and the door doesn't move. */}
                <span className="hidden lg:block" />
                <span className="hidden text-right text-[13.5px] font-semibold leading-tight tabular-nums text-foreground lg:block">
                  {driver.runCount}
                </span>
                {/* Each row is its own grid, so an `auto` column is only as wide
                    as that row's own content: a driver with no timed lap has a
                    narrower "— / no laps" block than "16.956 / +1.15", and the
                    pill beside it slid 6px along. A floor wide enough for the
                    widest of them holds the pill still down the whole list.
                    `lg:contents` dissolves this box on desktop, where the 84px
                    columns already do the job. */}
                <span className="min-w-[3.25rem] shrink-0 text-right lg:contents">
                  <span
                    className={cn(
                      "block text-[13.5px] font-semibold leading-tight tabular-nums lg:text-right",
                      driver.pos === 1 && driver.best != null ? "text-gain" : "text-foreground"
                    )}
                  >
                    {driver.best != null ? formatLap(driver.best) : "—"}
                  </span>
                  {/*
                    Deltas stay in muted ink. A whole column of red says "five
                    problems" when it only means "four people are not the fastest".
                  */}
                  <span className="mt-0.5 block text-[10.5px] leading-none tabular-nums text-muted-foreground lg:mt-0 lg:self-center lg:text-right lg:text-[13.5px] lg:font-semibold lg:leading-tight">
                    {/* Under a "vs fastest" header the fastest driver's cell is
                        a dash, not the word "fastest" — the header already said
                        it. The phone has no header, so it keeps the word. */}
                    <span className="lg:hidden">
                      {driver.delta == null
                        ? "no laps"
                        : driver.delta === 0
                          ? "fastest"
                          : `+${driver.delta.toFixed(2)}`}
                    </span>
                    <span className="hidden lg:inline">
                      {driver.delta == null || driver.delta === 0
                        ? "—"
                        : `+${driver.delta.toFixed(2)}`}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </SurfaceCard>
  );
}
