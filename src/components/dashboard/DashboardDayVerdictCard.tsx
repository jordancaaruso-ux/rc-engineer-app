import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import type { TodayVerdict } from "@/lib/dashboardVerdict";
import { formatLap } from "@/lib/runLaps";
import { carRatingBandCaption } from "@/lib/runHandlingAssessment";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { RatingDial } from "@/components/ui/RatingDial";
import { PaceSparkline } from "@/components/dashboard/PaceSparkline";

const GAIN = "text-gain";
const LOSS = "text-destructive";

/**
 * Signed lap delta, 3 decimals — negative (faster) reads green, positive red.
 *
 * `neutral` greys it instead, for a delta the card has already called noise. Without it a
 * headline of "Holding steady" carried a red ▲ 0.020 beside it: two hundredths is inside
 * the steady band by definition, and colouring it as lost time argued with the word. Same
 * convention as `PaceSparkline`, whose end dot goes faint on a steady day.
 */
function DeltaChip({
  delta,
  neutral = false,
  className,
}: {
  delta: number;
  neutral?: boolean;
  className?: string;
}) {
  const faster = delta < 0;
  return (
    <span
      className={cn(
        "text-[12px] font-semibold tabular-nums",
        neutral ? "text-faint" : faster ? GAIN : LOSS,
        className,
      )}
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
 * Today's ratings as figures plus the sentence they end. Four values is what fits beside
 * the dial on one line at 390px — measured, not guessed.
 *
 * A longer day used to collapse to `6 → … → 6`, which hid the middle — and the middle is
 * the whole point on the day most likely to have one (founder report 2026-08-25: a day
 * that fluctuated read as "same all day" on BOTH lines). So past four runs the chain gives
 * way to the day's low and high, which is the fact the ellipsis was eating. Nothing here
 * prints where the day ENDED, because the dial to the right of this row is exactly that.
 *
 * The tail is " today", not " across today": measured at 390px, a four-value chain and the
 * longer tail wrap onto a second line, because the dial takes the width its band word needs
 * ("Workable" is the wide one).
 */
function handlingArcLine(arc: number[]): { figures: string; tail: string } {
  if (arc.length <= 4) return { figures: arc.join(" → "), tail: " today" };
  const low = Math.min(...arc);
  const high = Math.max(...arc);
  if (low === high) return { figures: String(low), tail: " every run today" };
  return { figures: `low ${low}, high ${high}`, tail: " today" };
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
  // "Only Practice rated" on a day of five practice sessions named none of them, so a
  // positional label speaks as a position — lower case, because it sits mid-sentence.
  const rated = handling.runPosition != null ? `run ${handling.runPosition}` : handling.runLabel;
  switch (handling.direction) {
    case "improving":
      return "Coming to you";
    case "fading":
      return "Going away";
    case "flat":
      // Every run today rated the same number — the only day that earns this sentence.
      return "Same all day";
    case "holding":
      return "Settled";
    case "swinging":
      return "Up and down";
    default:
      // No direction yet. Two ratings is not a trend — it is run 2 against run 1, the
      // comparison this card stopped making — so the row states the count and lets the
      // arc and the dial speak. One rating with more runs logged means a draft is still
      // open, so "first run of the day" would be a lie.
      if (handling.arc.length >= 2) return "Two runs rated";
      return runCount === 1 ? "First run of the day" : `Only ${rated} rated`;
  }
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

/**
 * Track-day day-verdict card — the computed read of the day ("three
 * instruments", docs/DASHBOARD_NORTH_STAR.md v2, founder-locked 2026-07-19 via
 * artifact board): pace trend, whether the last setup change helped, and lap
 * consistency. Pure math, no AI — the run list itself lives in Sessions
 * (tapping the card lands there). Replaces the Today-so-far run strip.
 *
 * **No Engineer footer since 2026-08-20** (founder call). It read "Ask the Engineer about
 * today" and queued "give me your read on today so far" — a request to recite the figures
 * printed directly above it. `DashboardAskEngineerCard` takes the slot under this card
 * instead, and offers questions the card cannot answer: worth changing at all, why it is
 * loose on entry, which tyre.
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

  /**
   * The card's headline is the pace read, and since 2026-08-25 it is a claim about NOW
   * rather than about the whole day: the latest run against the median of today's earlier
   * ones. The wording carries that — "quicker than earlier" explains the delta beside it,
   * where "trending faster" left the number to be guessed at.
   *
   * A two-run day gets no verdict at all. The only comparison it could make is against the
   * first run of the morning, which is the anchor `medianOfEarlier` exists to retire.
   */
  const headline = verdict.trend
    ? verdict.trend.direction === "faster"
      ? "Quicker than earlier"
      : verdict.trend.direction === "slower"
        ? "Off your earlier pace"
        : verdict.trend.direction === "steady"
          ? "Holding steady"
          : "Too early to call"
    : verdict.runCount === 1
      ? "One run logged"
      : "On the board";

  const { trend, bestRun, lastChange, handling } = verdict;
  const arcLine = handling ? handlingArcLine(handling.arc) : null;

  /**
   * Which run was quickest.
   *
   * A run is named by its session TYPE, and nothing stores a session number, so a day of
   * five practice sessions used to read "Best run was Practice" — true of all five of
   * them, and therefore a pointer at nothing (founder report 2026-08-25). When the day's
   * names repeat, `resolveDayRunNames` hands back the run's POSITION instead of inventing
   * a "Practice 3" that could contradict the event's own timetable, and the sentence
   * changes shape to suit it. A day with real names ("Qualifying", "A Main") is untouched.
   */
  const bestRunLine =
    bestRun?.runPosition != null
      ? `Best was run ${bestRun.runPosition} of ${verdict.runCount}`
      : `Best run was ${bestRun?.runLabel ?? ""}`;

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
          {trend?.delta != null ? (
            <DeltaChip delta={trend.delta} neutral={trend.direction === "steady"} />
          ) : null}
        </div>

        {bestRun ? (
          <InstrumentRow
            label="Pace"
            main={bestRun.bestLap != null ? bestRunLine : "No laps linked yet"}
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
              <PaceSparkline values={trend.spark} direction={trend.direction ?? "steady"} />
            ) : undefined}
            last={!lastChange && !handling}
          />
        ) : null}

        {lastChange ? (
          <InstrumentRow
            label="Last change"
            main={changedLine(lastChange.rows)}
            sub={changeSub}
            right={
              lastChange.delta != null ? (
                <DeltaChip delta={lastChange.delta} neutral={lastChange.verdict === "unclear"} />
              ) : undefined
            }
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
                  <span className="tabular-nums text-foreground/80">{arcLine?.figures}</span>
                  {arcLine?.tail}
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

    </SurfaceCard>
  );
}
