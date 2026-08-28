import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { carRatingBandCaption } from "@/lib/runHandlingAssessment";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { lapImportHref } from "@/lib/runs/lapImportHref";

/**
 * The desktop hero's stand-in on a track day with no lap times (founder call 2026-08-11).
 *
 * `heroPace` is null unless a lap time exists somewhere, so a day of runs logged without
 * timing left the whole left column blank — three runs, a rating that moved, and a full
 * change trail all recorded, and nothing on screen. The ledger card underneath could not
 * cover it either: on a track day it suppresses the change list because the hero and the
 * phone strip are supposed to carry it, and on desktop with no hero neither exists.
 *
 * So this takes the hero's slot rather than sitting under it — one card in that position,
 * whichever kind of day it is. Everything here is recorded fact: the rating the driver
 * tapped and the setup rows that actually differ. Nothing is inferred, and it never
 * pretends to a pace read it does not have — it asks for the laps instead.
 *
 * Shown only when there are NO lap times today at all. One timed run brings the real hero
 * back, and the untimed runs of a mixed day stay in the phone strip and Sessions.
 */
export function DashboardTodayNoLapsCard({
  strip,
  todayContext,
  todayRunCount,
  dayStamp,
}: {
  /** Today's runs, latest first — `model.todayStrip`. */
  strip: DashboardHomeModel["todayStrip"];
  todayContext: DashboardHomeModel["todayContext"];
  todayRunCount: number;
  /** Today's date ("FRI 07 AUG") — see `DashboardHome`. Always a track day here. */
  dayStamp: string;
}) {
  const latest = strip[0];
  const first = strip[strip.length - 1];
  if (!latest) return null;

  const meta = [
    `${todayRunCount} ${todayRunCount === 1 ? "run" : "runs"}`,
    todayContext?.carName,
    todayContext?.trackName,
  ]
    .filter(Boolean)
    .join(" · ");

  // Only a move between two rated runs is a move. One rated run is a reading, not a trend.
  const ratingDelta =
    latest.carRating != null && first?.carRating != null && first.runId !== latest.runId
      ? latest.carRating - first.carRating
      : null;
  const band = latest.carRating != null ? carRatingBandCaption(latest.carRating) : null;

  const changedToday = strip.reduce((n, r) => n + r.changedRows.length, 0);

  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="micro-caps text-foreground">
          Today
        </span>
        {meta ? <span className="truncate text-[12px] text-faint">{meta}</span> : null}
        {/* Same handoff as the real hero — see `DashboardHeroCard`. */}
        <span className="ml-auto shrink-0 micro-caps text-faint">
          {dayStamp}
        </span>
        <Link
          href="/runs/history?expandLatest=1"
          prefetch={false}
          className="tap-active inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          Open in Sessions
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="flex items-start gap-9 px-6 pb-[22px] pt-[26px]">
        {/* The anchor. The rating is the only figure that moved today, so it takes the
            slot the lap numeral would have had — and the run count takes it when the
            driver rated nothing. */}
        <div className="min-w-[262px] shrink-0">
          <div className="micro-caps text-faint">
            {latest.carRating != null ? "Handling · latest run" : "Runs today"}
          </div>
          <div className="mt-2.5 flex items-baseline gap-2 font-medium tabular-nums leading-[.84] tracking-[-.045em] text-foreground">
            <span className="text-[clamp(3.5rem,4.6vw,5.5rem)]">
              {latest.carRating ?? todayRunCount}
            </span>
            {latest.carRating != null ? (
              <span className="text-[22px] text-faint">/10</span>
            ) : null}
          </div>
          {latest.carRating != null && band ? (
            <div className="mt-3 text-[12px] text-muted-foreground">
              {band} · {latest.runLabel}
            </div>
          ) : null}
          {ratingDelta != null ? (
            <div className="mt-3 flex items-center gap-2.5">
              <RatingDeltaChip delta={ratingDelta} />
              <span className="text-[12px] leading-[1.35] text-muted-foreground">
                {ratingDelta === 0
                  ? `same as ${first.runLabel}`
                  : `${ratingDelta > 0 ? "up" : "down"} from ${first.carRating} on ${first.runLabel}`}
              </span>
            </div>
          ) : null}
        </div>

        <div className="w-px self-stretch bg-border" aria-hidden />

        {/* What the day was actually spent doing. */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <span className="micro-caps text-faint">
              What you changed today
            </span>
            <span className="shrink-0 text-[12px] text-faint">
              {changedToday === 0
                ? "no setup changes recorded"
                : `${changedToday} ${changedToday === 1 ? "change" : "changes"} · newest first`}
            </span>
          </div>
          <ul>
            {strip.map((run, i) => (
              <li
                key={run.runId}
                className={cn(
                  "flex items-start gap-4 py-2.5",
                  i < strip.length - 1 && "border-b border-border/70",
                )}
              >
                <span className="w-[104px] shrink-0 truncate text-[12.5px] text-muted-foreground">
                  {run.runLabel}
                </span>
                <span className="w-[52px] shrink-0 text-[13px] tabular-nums text-faint">
                  {run.carRating != null ? `${run.carRating}/10` : "—"}
                </span>
                <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-foreground">
                  {run.changedRows.length === 0 ? (
                    <span className="text-faint">no changes</span>
                  ) : (
                    <ChangeSummary rows={run.changedRows} />
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-faint">
                  {run.timeLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The one thing missing, and the door straight to it — landing on the run once the
          laps are in, not back on this card with nothing left to say. */}
      <Link
        href={lapImportHref(latest.runId)}
        prefetch={false}
        className="tap-active flex items-center gap-2 border-t border-border px-6 py-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        Add lap times to {latest.runLabel} for a pace read
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        <span className="ml-auto text-[11.5px] font-normal text-faint">
          best lap, consistency and the pace chart all need laps
        </span>
      </Link>
    </SurfaceCard>
  );
}

/** Up is better here, unlike a lap time — a higher rating is a better car. */
function RatingDeltaChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="rounded-md bg-muted-foreground/[.12] px-2.5 py-1 text-[13px] font-bold tabular-nums text-muted-foreground">
        ±0
      </span>
    );
  }
  const better = delta > 0;
  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 text-[13px] font-bold tabular-nums",
        better ? "bg-gain/[.12] text-gain" : "bg-destructive/[.12] text-destructive",
      )}
    >
      {better ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

/** Two changes named in full, the rest counted — the same rule the ledger card uses. */
function ChangeSummary({
  rows,
}: {
  rows: DashboardHomeModel["todayStrip"][number]["changedRows"];
}) {
  const shown = rows.slice(0, 2);
  const extra = rows.length - shown.length;
  return (
    <>
      {shown.map((row, i) => (
        <span key={row.key}>
          {i > 0 ? <span className="text-faint"> · </span> : null}
          <span className="text-muted-foreground">{row.label} </span>
          <span className="tabular-nums">
            {row.previous != null ? `${row.previous} → ${row.current}` : row.current}
            {row.unit ? ` ${row.unit}` : ""}
          </span>
        </span>
      ))}
      {extra > 0 ? <span className="text-faint"> +{extra} more</span> : null}
    </>
  );
}
