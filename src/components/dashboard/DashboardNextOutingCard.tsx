import Link from "next/link";
import { CalendarDays, CalendarPlus, ChevronRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * Off-day lead: the next outing (docs/DASHBOARD_NORTH_STAR.md v2, founder-locked
 * 2026-07-19 via artifact board — "countdown hero"). Event countdown + what you
 * ran there last time, and the way into the full events list.
 *
 * ── Split, 2026-08-18 ────────────────────────────────────────────────────────
 * This card used to carry the driver's Ideas list and an "N to-dos open" chip as
 * well, which made it a phone-screen-tall stack of two unrelated jobs. Founder
 * call: the outing is one card, the Ideas list is its own card beside it
 * (`DashboardHome`). The chip is gone for good — it counted the Things-to-do
 * list, which already has its own card on the same page.
 *
 * That split also fixed a wobble: the Ideas list used to live INSIDE this card
 * when a meeting was running and in a standalone card otherwise, so it moved on
 * the driver depending on the data. Now it is the same card every day.
 *
 * No event on the calendar → the card degrades to the single "book your next
 * track day" nudge. It always exists.
 *
 * A meeting that has STARTED keeps the same card (2026-07-29). It used to
 * vanish the moment `featuredStatus` flipped to "active", which read as the app
 * forgetting where you were — the countdown just becomes "Day 2 of 3" and the
 * second line carries today's run count instead of the last visit.
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
  const days = event?.daysUntilStart ?? null;
  const isActive = event?.status === "active";
  const dayOfMeeting = event?.dayOfMeeting ?? null;
  const totalDays = event?.totalDays ?? null;

  // Once you've run at a meeting, the useful destination is the runs — not the
  // event's dates and spec tire (founder call 2026-07-29). Run history already
  // groups an event's runs as one "Race Meeting", so the filtered Sessions list
  // is the meeting view. Before the first run there's nothing to see, so the
  // event page stays the target.
  const hasRuns = (event?.runCount ?? 0) > 0;
  const heroHref = event
    ? hasRuns
      ? `/runs/history?eventId=${encodeURIComponent(event.id)}`
      : `/events/${encodeURIComponent(event.id)}`
    : "/events";

  // Nothing booked: no countdown to draw, so the card IS the nudge — one row,
  // same surface, rather than an empty hero with a link under it.
  if (!event) {
    return (
      <SurfaceCard variant="hero">
        <Link
          href="/events"
          prefetch
          className="tap-active -mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <CalendarPlus aria-hidden className="size-[15px]" strokeWidth={2.2} />
          Book your next track day
          <ChevronRight aria-hidden className="ml-auto size-4 text-faint" strokeWidth={2.2} />
        </Link>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard variant="hero">
      <div className="eyebrow-root mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="eyebrow-label">{isActive ? "At the track" : "Next outing"}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {[event.name, event.trackLabel].filter(Boolean).join(" · ")}
        </span>
      </div>

      <Link
        href={heroHref}
        prefetch
        aria-label={hasRuns ? "View your sessions at this meeting" : "View event"}
        className="tap-active -mx-1.5 flex items-center gap-3.5 rounded-lg px-1.5 py-2.5 transition hover:bg-white/[0.03]"
      >
        <span className="flex items-baseline gap-1.5">
          <span className="text-[40px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {isActive
              ? (dayOfMeeting ?? "—")
              : days == null
                ? "—"
                : days === 0
                  ? "0"
                  : days}
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {isActive
              ? totalDays && totalDays > 1
                ? `of ${totalDays} days`
                : "day at the track"
              : days === 0
                ? "starts today"
                : days === 1
                  ? "day out"
                  : "days out"}
          </span>
        </span>
        <span className="min-w-0 text-[12px] leading-relaxed text-muted-foreground">
          <span className="block">{event.dateLabel}</span>
          {isActive ? (
            <span className="block">
              {todayRunCount} {todayRunCount === 1 ? "run" : "runs"} logged today
            </span>
          ) : event.lastVisit ? (
            <span className="block">
              last visit: best{" "}
              <span className="tabular-nums text-foreground/80">
                {formatLap(event.lastVisit.bestLap)}
              </span>{" "}
              · {event.lastVisit.runCount} {event.lastVisit.runCount === 1 ? "run" : "runs"} ·{" "}
              <RelativeTime
                iso={event.lastVisit.dateIso}
                fallback={formatAppTimestampUtc(event.lastVisit.dateIso)}
              />
            </span>
          ) : event.trackLabel ? (
            <span className="block">first time at this track</span>
          ) : null}
        </span>
        <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-faint" strokeWidth={2.2} />
      </Link>

      {/* The way into the full list, at the foot of the card (founder call
          2026-07-29) — it used to be a small header link. */}
      <div className="mt-2 border-t border-border/70 pt-2.5">
        <Link
          href="/events"
          prefetch
          className="tap-active flex items-center gap-2 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <CalendarDays aria-hidden className="size-[15px]" strokeWidth={2.2} />
          All events
          <ChevronRight aria-hidden className="ml-auto size-4 text-faint" strokeWidth={2.2} />
        </Link>
      </div>
    </SurfaceCard>
  );
}
