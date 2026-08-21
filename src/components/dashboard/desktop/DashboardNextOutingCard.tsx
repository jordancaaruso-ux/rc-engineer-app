import Link from "next/link";
import { ArrowUpRight, CalendarPlus, ChevronRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * The booked race, on desktop (2026-08-18).
 *
 * Until now `xl` said almost nothing about an upcoming event: the only trace was
 * `"Next out: <name>"` at the foot of the run button — no date, no countdown, no
 * track, no last visit, and no way through to the event. A meeting that had already
 * STARTED said nothing at all, where the phone reads "day 2 of 3". Measured on a real
 * account at 1440×900, the desktop dashboard named a race four days away without ever
 * printing its date.
 *
 * Not the phone's `DashboardNextOutingCard`, deliberately. That one is a hero surface
 * built around a 40px numeral; dropped into this column it would sit between two cards
 * drawn in the tower vocabulary (micro-caps eyebrow, hairline rows, a figure in the
 * top-right) and read as a screenshot pasted in. Same three states, same destinations,
 * same model fields — this is the frame `DashboardListCard` uses, so the three cards in
 * the column agree with each other.
 *
 * It costs no query. `featuredEvent` is built on every dashboard load and desktop was
 * already reading one field off it, so everything here was loaded and thrown away.
 */
export function DashboardNextOutingCard({
  event,
  todayRunCount = 0,
}: {
  /** The featured event ("next" before it starts, "active" while it runs); null when nothing is booked. */
  event: NonNullable<DashboardHomeModel["featuredEvent"]> | null;
  /** Runs logged today — shown only while the meeting is running. */
  todayRunCount?: number;
}) {
  // Nothing booked: the card IS the nudge, one row on the same surface. It always
  // exists — it degrades, it never disappears (same rule as the phone card).
  //
  // This link used to live permanently at the foot of the Ideas card, where it went on
  // asking you to book a track day while a booked track day sat four days out, named in
  // the button above it. Here it can only appear when it is true.
  if (!event) {
    return (
      <SurfaceCard contentClassName="p-0" className="rounded-xl">
        <Link
          href="/events"
          prefetch
          className="tap-active flex items-center gap-2 px-[18px] py-3.5 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <CalendarPlus aria-hidden className="size-[15px]" strokeWidth={2.2} />
          Book your next track day
          <ChevronRight aria-hidden className="ml-auto size-4 text-faint" strokeWidth={2.2} />
        </Link>
      </SurfaceCard>
    );
  }

  const isActive = event.status === "active";

  // `dateLabel` ships as "22 Aug 2026 – 23 Aug 2026 · in 4 days" — the relative half is
  // already the figure in the header, so keep only the range. The range itself is joined
  // with an en dash, never " · ", so this split cannot eat part of a date.
  const dateRange = event.dateLabel.split(" · ")[0];

  // The figure in the top-right corner, where the two list cards put their count:
  // days remaining before the meeting, which day of it you are on once it starts.
  const figure = isActive
    ? (event.dayOfMeeting ?? "—")
    : event.daysUntilStart == null
      ? "—"
      : event.daysUntilStart;
  const figureUnit = isActive
    ? event.totalDays && event.totalDays > 1
      ? `of ${event.totalDays} days`
      : "day at the track"
    : event.daysUntilStart === 0
      ? "starts today"
      : event.daysUntilStart === 1
        ? "day out"
        : "days out";

  // Same destination rule as the phone card (founder call 2026-07-29): once you have run
  // at a meeting the useful place is those runs — run history already groups an event's
  // runs as one "Event". Before the first run there is nothing there, so the event
  // page stays the target.
  const hasRuns = event.runCount > 0;
  const heroHref = hasRuns
    ? `/runs/history?eventId=${encodeURIComponent(event.id)}`
    : `/events/${encodeURIComponent(event.id)}`;

  return (
    <SurfaceCard contentClassName="p-0" className="rounded-xl">
      <div className="flex items-baseline gap-3 border-b border-border px-[18px] py-3.5">
        <span className="micro-caps text-faint">{isActive ? "At the track" : "Next outing"}</span>
        <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
          <span className="text-[15px] font-bold tabular-nums leading-none text-foreground">
            {figure}
          </span>
          <span className="text-[11.5px] text-faint">{figureUnit}</span>
        </span>
      </div>

      <Link
        href={heroHref}
        prefetch
        aria-label={hasRuns ? "View your sessions at this meeting" : "View event"}
        className="tap-active block px-[18px] py-3 transition hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="block truncate text-[14.5px] font-bold leading-tight tracking-tight text-foreground">
          {event.name}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {[event.trackLabel, dateRange].filter(Boolean).join(" · ")}
        </span>
      </Link>

      {/* One hairline row of history — the whole of what remains of the retired
          last-session digest card. While the meeting runs it carries today instead. */}
      {isActive ? (
        <div className="flex items-baseline gap-3 border-t border-border px-[18px] py-2.5 text-[12.5px]">
          <span className="micro-caps text-faint">Today</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {todayRunCount} {todayRunCount === 1 ? "run" : "runs"} logged
          </span>
        </div>
      ) : event.lastVisit ? (
        <div className="flex items-baseline gap-3 border-t border-border px-[18px] py-2.5 text-[12.5px]">
          <span className="micro-caps text-faint">Last visit</span>
          <span className="ml-auto text-muted-foreground">
            best{" "}
            <span className="tabular-nums text-foreground/80">
              {formatLap(event.lastVisit.bestLap)}
            </span>{" "}
            · {event.lastVisit.runCount} {event.lastVisit.runCount === 1 ? "run" : "runs"} ·{" "}
            <RelativeTime
              iso={event.lastVisit.dateIso}
              fallback={formatAppTimestampUtc(event.lastVisit.dateIso)}
            />
          </span>
        </div>
      ) : event.trackLabel ? (
        <div className="flex items-baseline gap-3 border-t border-border px-[18px] py-2.5 text-[12.5px]">
          <span className="micro-caps text-faint">Last visit</span>
          <span className="ml-auto text-muted-foreground">first time at this track</span>
        </div>
      ) : null}

      <Link
        href="/events"
        prefetch={false}
        className="tap-active flex items-center gap-2 border-t border-border px-[18px] py-3 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        All events
        <ArrowUpRight className="ml-auto size-3.5 text-faint" aria-hidden />
      </Link>
    </SurfaceCard>
  );
}
