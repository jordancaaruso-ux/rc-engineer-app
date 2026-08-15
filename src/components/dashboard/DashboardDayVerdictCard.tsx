import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import type { TodayVerdict } from "@/lib/dashboardVerdict";
import { formatLap } from "@/lib/runLaps";
import { carRatingBandCaption } from "@/lib/runHandlingAssessment";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { RatingDial } from "@/components/ui/RatingDial";

const GAIN = "text-gain";
const LOSS = "text-destructive";

/** Signed lap delta, 3 decimals — negative (faster) reads green, positive red. */
function DeltaChip({ delta, className }: { delta: number; className?: string }) {
  const faster = delta < 0;
  return (
    <span
      className={cn("text-[12px] font-semibold tabular-nums", faster ? GAIN : LOSS, className)}
    >
      {faster ? "▼" : "▲"} {Math.abs(delta).toFixed(3)}
    </span>
  );
}

/** One-line summary of a run's setup changes: "Front sway 1.4 → 1.5 · +2 more". */
function changedLine(rows: NonNullable<TodayVerdict["lastChange"]>["rows"]): string {
  const shown = rows.slice(0, 2).map((row) => {
    const unit = row.unit ? ` ${row.unit}` : "";
    return row.previous != null
      ? `${row.label} ${row.previous} → ${row.current}${unit}`
      : `${row.label} ${row.current}${unit}`;
  });
  const extra = rows.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")} · +${extra} more` : shown.join(" · ");
}

/**
 * Today's ratings as an arrow chain. Four values is what fits beside the dial on one
 * line at 390px — measured, not guessed — so a longer day collapses to both ENDS with
 * an ellipsis between. Both ends, because the direction word is computed from exactly
 * those two: trimming the first number would make the word look wrong.
 */
function handlingArcLine(arc: number[]): string {
  if (arc.length <= 4) return arc.join(" → ");
  return `${arc[0]} → … → ${arc[arc.length - 1]}`;
}

/**
 * The bold line for the handling row — DIRECTION only.
 *
 * It deliberately never says the band word. `RatingDial` in verdict mode always prints
 * that word beside the ring (there is no prop to suppress it), so a headline of "Good
 * all day" put "Good" on the row twice. The division of labour: bold line = which way
 * the car went, dial = where it ended up.
 */
function handlingHeadline(handling: NonNullable<TodayVerdict["handling"]>, runCount: number): string {
  switch (handling.direction) {
    case "improving":
      return "Coming to you";
    case "fading":
      return "Going away";
    case "flat":
      return "Same all day";
    default:
      // One rating so far. More runs than ratings means a draft is still open, so
      // "first run of the day" would be a lie.
      return runCount === 1 ? "First run of the day" : `Only ${handling.runLabel} rated`;
  }
}

/** Per-run pace sparkline — faster laps plot lower, so an improving day slopes down. */
function Sparkline({ values, direction }: { values: number[]; direction: "faster" | "slower" | "steady" }) {
  const W = 72;
  const H = 26;
  const PAD = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const x = (i: number) => (values.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (values.length - 1));
  const y = (v: number) => (range === 0 ? H / 2 : PAD + ((max - v) * (H - 2 * PAD)) / range);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const endColor = direction === "faster" ? "rgb(var(--color-gain))" : direction === "slower" ? "rgb(var(--color-destructive))" : "rgb(var(--color-faint))";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke="rgb(var(--color-faint))" strokeWidth="1.5" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.6" fill={endColor} />
    </svg>
  );
}

function InstrumentRow({
  label,
  main,
  sub,
  right,
  last = false,
}: {
  label: string;
  main: React.ReactNode;
  sub: React.ReactNode;
  right?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5",
        last ? "pb-0.5" : "border-b border-border/70"
      )}
    >
      <div className="w-[86px] flex-none">
        <span className="type-data-label">{label}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold leading-snug text-foreground">{main}</div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-faint">{sub}</div>
      </div>
      {right ? <div className="ml-auto flex-none">{right}</div> : null}
    </div>
  );
}

// No mode param (one-mode decision 2026-07-29): the Engineer answers the same way
// everywhere — the prompt text itself says what this tap wants.
const ENGINEER_TODAY_HREF = `/engineer?prompt=${encodeURIComponent(
  "Give me your read on today so far."
)}`;

/**
 * Track-day day-verdict card — the computed read of the day ("three
 * instruments", docs/DASHBOARD_NORTH_STAR.md v2, founder-locked 2026-07-19 via
 * artifact board): pace trend, whether the last setup change helped, and lap
 * consistency. Pure math, no AI — the run list itself lives in Sessions
 * (tapping the card lands there), and the Engineer is on-demand via the footer
 * (quick mode, anchored to today). Replaces the Today-so-far run strip.
 */
export function DashboardDayVerdictCard({
  verdict,
  context,
}: {
  verdict: TodayVerdict;
  context: DashboardHomeModel["todayContext"];
}) {
  const metaBits = [
    `${verdict.runCount} ${verdict.runCount === 1 ? "run" : "runs"}`,
    context?.carName ?? null,
    context?.trackName ?? null,
    context?.eventName ?? null,
  ].filter(Boolean);

  const headline = verdict.trend
    ? verdict.trend.direction === "faster"
      ? "Trending faster"
      : verdict.trend.direction === "slower"
        ? "Trending slower"
        : "Holding steady"
    : verdict.runCount === 1
      ? "One run logged"
      : "On the board";

  const { trend, bestRun, lastChange, handling } = verdict;

  const changeSub =
    lastChange?.verdict === "helped"
      ? `helped — ${lastChange.metric === "avg" ? "avg" : "best"} vs the run before`
      : lastChange?.verdict === "hurt"
        ? `cost time — ${lastChange.metric === "avg" ? "avg" : "best"} vs the run before`
        : "effect unclear so far";

  return (
    <SurfaceCard variant="hero" className="relative">
      <Link
        href="/runs/history?expandLatest=1"
        prefetch
        aria-label="Open today's runs in Sessions"
        className="tap-active absolute inset-0 z-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="pointer-events-none relative z-10">
        <div className="eyebrow-root mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="eyebrow-label">Today</span>
          <span className="text-[12px] text-muted-foreground">{metaBits.join(" · ")}</span>
        </div>

        <div className="flex items-baseline gap-2 py-1.5">
          <span className="text-[19px] font-bold leading-tight tracking-tight text-foreground">
            {headline}
          </span>
          {trend ? <DeltaChip delta={trend.delta} /> : null}
        </div>

        {bestRun ? (
          <InstrumentRow
            label="Pace"
            main={bestRun.bestLap != null ? `Best run was ${bestRun.runLabel}` : "No laps linked yet"}
            sub={
              bestRun.bestLap != null ? (
                <>
                  best <span className="tabular-nums text-foreground/80">{formatLap(bestRun.bestLap)}</span>
                  {bestRun.avgTop5 != null ? (
                    <>
                      {" "}
                      · avg <span className="tabular-nums text-foreground/80">{formatLap(bestRun.avgTop5)}</span>
                    </>
                  ) : null}
                </>
              ) : (
                "link lap times to see the day's pace"
              )
            }
            right={trend && trend.spark.length >= 2 ? (
              <Sparkline values={trend.spark} direction={trend.direction} />
            ) : undefined}
            last={!lastChange && !handling}
          />
        ) : null}

        {lastChange ? (
          <InstrumentRow
            label="Last change"
            main={changedLine(lastChange.rows)}
            sub={changeSub}
            right={lastChange.delta != null ? <DeltaChip delta={lastChange.delta} /> : undefined}
            last={!handling}
          />
        ) : null}

        {handling ? (
          <InstrumentRow
            label="Handling"
            main={handlingHeadline(handling, verdict.runCount)}
            sub={
              handling.arc.length >= 2 ? (
                <>
                  <span className="tabular-nums text-foreground/80">
                    {handlingArcLine(handling.arc)}
                  </span>{" "}
                  across today
                </>
              ) : (
                "the day's arc starts here"
              )
            }
            // Bare ring: the bold line above already carries the word, and the dial's
            // own aria-label reads "Handling 8 of 10 — Good" for anything that can't
            // see the colour. 44px fits inside the row's existing height.
            right={<RatingDial size={44} value={handling.rating} min={1} label="Handling" />}
            last
          />
        ) : null}
      </div>

      {/* On-demand Engineer read — the only AI on this card, and you ask for it. */}
      <div className="relative z-10 mt-3 border-t border-border/70 pt-2.5">
        <Link
          href={ENGINEER_TODAY_HREF}
          prefetch
          className="tap-active flex items-center gap-2 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <span aria-hidden className="text-primary-ink">✦</span>
          Ask the Engineer about today
          <ArrowUpRight aria-hidden className="ml-auto size-[15px] text-faint" strokeWidth={2.2} />
        </Link>
      </div>
    </SurfaceCard>
  );
}
