import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import {
  formatDrivingDuration,
  longestStreak,
  summaryChangeChip,
  type DashboardSummary,
  type SummaryDelta,
} from "@/lib/dashboardSummary";
import { formatLap } from "@/lib/runLaps";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { RatingDial } from "@/components/ui/RatingDial";
import { PaceChart } from "@/components/dashboard/desktop/PaceChart";

/**
 * The desktop hero — the biggest thing on the page and the only one that answers
 * "am I getting faster?" (design handoff 2026-08-08).
 *
 * Three blocks across: the lap numeral, two rating dials, and the pace chart. A
 * six-up hairline stat strip runs underneath. Desktop only — the phone keeps the
 * verdict / next-outing stack unchanged.
 *
 * Two dials, not the handoff's three. The third was specified as a left/right corner
 * weight ("51.4%, 1.4% L"); this app captures no corner weights of any kind, so that
 * dial had no data behind it. Founder call 2026-08-08: ship the two that are real.
 */
export function DashboardHeroCard({
  isTrackDay,
  hero,
  summary,
  todayContext,
  todayRunCount,
  recentRun,
  lastChange,
}: {
  isTrackDay: boolean;
  hero: NonNullable<DashboardHomeModel["heroPace"]>;
  summary: DashboardSummary;
  todayContext: DashboardHomeModel["todayContext"];
  todayRunCount: number;
  recentRun: DashboardHomeModel["recentRun"];
  lastChange: NonNullable<DashboardHomeModel["todayVerdict"]>["lastChange"] | null;
}) {
  const isLapSeries = hero.seriesKind === "laps";

  // "Where your pace is" said nothing and named no venue, which is how a mixed-track
  // series went unnoticed. The card is about the most recent session, so it says so, and
  // the track sits in the meta line beside it (founder call 2026-08-10).
  const eyebrow = isTrackDay ? "Today" : "Last run";
  const meta = isTrackDay
    ? [
        `${todayRunCount} ${todayRunCount === 1 ? "run" : "runs"}`,
        todayContext?.carName,
        todayContext?.trackName,
      ]
        .filter(Boolean)
        .join(" · ")
    : [recentRun?.carName, hero.trackName, hero.anchorLabel].filter(Boolean).join(" · ");

  const doorHref = isTrackDay ? "/runs/history?expandLatest=1" : "/analysis";
  const doorLabel = isTrackDay ? "Open in Sessions" : "Open Analysis";
  const lapLabel = isTrackDay ? "Best lap today" : "Best lap · last run";

  // The note beside the delta chip: on a track day the verdict card has already judged
  // whether the last setup change helped, so say that rather than inventing a phrase.
  const deltaNote = isTrackDay
    ? lastChange
      ? `${lastChange.runLabel} — ${
          lastChange.verdict === "helped"
            ? "the change helped"
            : lastChange.verdict === "hurt"
              ? "the change cost time"
              : "effect unclear so far"
        }`
      : "vs the run before it"
    : // Only says "at <track>" now that the series is scoped to one — it used to name the
      // latest run's track no matter where the run it compared against actually was.
      hero.seriesKind === "sessions" && hero.series.length >= 2
      ? `vs your previous session${hero.trackName ? ` at ${hero.trackName}` : ""}`
      : null;

  return (
    <SurfaceCard
      variant="hero"
      contentClassName="p-0"
      className="rounded-2xl"
      // Demo walkthrough stop 2 — desktop only, because this card has no phone equivalent.
      dataTour="day-read"
    >
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="h-3.5 w-[3px] shrink-0 skew-x-[-21deg] rounded-sm bg-primary" aria-hidden />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-foreground">
          {eyebrow}
        </span>
        {meta ? <span className="truncate text-[12px] text-faint">{meta}</span> : null}
        <Link
          href={doorHref}
          prefetch={false}
          className="tap-active ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {doorLabel}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="flex items-start gap-9 px-6 pb-[22px] pt-[26px]">
        {/* Block 1 — the anchor of the whole page. */}
        <div className="min-w-[262px] shrink-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-faint">
            {lapLabel}
          </div>
          <div className="mt-2.5 font-mono font-medium tabular-nums leading-[.84] tracking-[-.045em] text-foreground text-[clamp(3.5rem,4.6vw,5.5rem)]">
            {formatLap(hero.bestLap)}
          </div>
          {hero.deltaSeconds != null ? (
            <div className="mt-4 flex items-center gap-2.5">
              <DeltaChip seconds={hero.deltaSeconds} />
              {deltaNote ? (
                <span className="text-[12px] leading-[1.35] text-muted-foreground">{deltaNote}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Block 2 — the two verdicts a numeral can't give. */}
        {hero.carRating != null || hero.consistency ? (
          <>
            <div className="w-px self-stretch bg-border" aria-hidden />
            <div className="flex shrink-0 flex-col gap-[18px]">
              {hero.carRating != null ? (
                <RatingDial
                  size={60}
                  value={hero.carRating}
                  min={1}
                  word
                  label="Handling"
                  caption={
                    isTrackDay
                      ? `handling · ${hero.series[hero.series.length - 1]?.label ?? "last run"}`
                      : "handling · last run"
                  }
                />
              ) : null}
              {hero.consistency ? (
                <RatingDial
                  // 60 for both dials: "99.4%" is five characters and at 52 it touches the
                  // ring. The number is the point of the dial, so the ring grows rather than
                  // the type shrinking, and the handling dial matches so the pair reads level.
                  size={60}
                  value={hero.consistency.value}
                  min={1}
                  display={
                    hero.consistency.percent != null ? `${hero.consistency.percent.toFixed(1)}%` : "–"
                  }
                  word={hero.consistency.word}
                  label="Consistency"
                  caption={`top-5 within ${hero.consistency.spreadSeconds.toFixed(3)} s`}
                />
              ) : null}
            </div>
          </>
        ) : null}

        {/* Block 3 — the trend. */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-faint">
              {isTrackDay
                ? "Pace · per run today"
                : isLapSeries
                  ? "Pace · laps in your last run"
                  : `Pace · last ${hero.series.length}${hero.trackName ? ` at ${hero.trackName}` : " sessions"}`}
            </span>
            <span className="shrink-0 text-[12px] text-faint">
              {isLapSeries && hero.trackName ? `first session at ${hero.trackName}` : "lower is faster"}
              {hero.foundSeconds != null && hero.foundSeconds > 0.001
                ? ` · ${hero.foundSeconds.toFixed(3)} s found`
                : ""}
            </span>
          </div>
          <PaceChart
            series={hero.series}
            deltaSeconds={hero.deltaSeconds}
            kind={hero.seriesKind}
            // Track-day only ever means "one run so far today", never a first visit — the
            // empty state must not claim a venue is new when he has raced there for years.
            trackName={isTrackDay ? null : hero.trackName}
          />
        </div>
      </div>

      <StatStripSixUp summary={summary} />
    </SurfaceCard>
  );
}

/** Signed lap delta — negative (faster) reads green, positive red. Never neutral. */
function DeltaChip({ seconds }: { seconds: number }) {
  const faster = seconds < 0;
  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 font-mono text-[13px] font-bold tabular-nums",
        faster ? "bg-gain/[.12] text-gain" : "bg-destructive/[.12] text-destructive",
      )}
    >
      {faster ? "▼" : "▲"} {Math.abs(seconds).toFixed(3)}
    </span>
  );
}

/**
 * Six equal hairline cells. Volume deltas use ↑/↓ in neutral ink, never green or red:
 * fewer runs is not a failure. That is an existing app rule and this does not change it.
 */
function StatStripSixUp({ summary }: { summary: DashboardSummary }) {
  const cells: Array<{ label: string; value: string; delta?: SummaryDelta; format?: (n: number) => string }> = [
    { label: "Runs · 30d", value: String(summary.runs.current), delta: summary.runs, format: (n) => String(Math.round(n)) },
    { label: "Laps", value: String(summary.laps.current), delta: summary.laps, format: (n) => String(Math.round(n)) },
    {
      label: "Wheel time",
      value: formatDrivingDuration(summary.drivingSeconds.current),
      delta: summary.drivingSeconds,
      format: formatDrivingDuration,
    },
    { label: "Active days", value: String(summary.activeDays) },
    { label: "Tracks", value: String(summary.tracks) },
    { label: "Best streak", value: `${longestStreak(summary.activityByDay)}d` },
  ];

  return (
    <div className="grid grid-cols-6 border-t border-border">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn("px-5 py-3", i < cells.length - 1 && "border-r border-border")}
        >
          <div className="text-[10.5px] font-semibold text-faint">{cell.label}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-[19px] font-medium tabular-nums text-foreground">
              {cell.value}
            </span>
            {cell.delta && cell.format ? (
              <VolumeDelta delta={cell.delta} format={cell.format} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function VolumeDelta({
  delta,
  format,
}: {
  delta: SummaryDelta;
  format: (n: number) => string;
}) {
  const { diff, direction } = summaryChangeChip(delta);
  if (direction === "flat") {
    return <span className="text-[10.5px] text-muted-foreground">±0</span>;
  }
  return (
    <span className="text-[10.5px] tabular-nums text-muted-foreground">
      {direction === "up" ? "↑" : "↓"} {format(Math.abs(diff))}
    </span>
  );
}
