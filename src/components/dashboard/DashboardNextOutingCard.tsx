import Link from "next/link";
import { CalendarDays, CalendarPlus, ChevronRight } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * Off-day lead: plan the next outing (docs/DASHBOARD_NORTH_STAR.md v2,
 * founder-locked 2026-07-19 via artifact board — "countdown hero"). One card
 * owns the forward plan: event countdown + what you ran there last time, open
 * to-dos, and the test plan (the Things-to-try list, live and editable).
 * Replaces the next-event-prep card AND the last-session digest — the digest's
 * story survives as the single "last visit" line under the countdown.
 *
 * No event on the calendar → the same card degrades to plan-only: the test
 * plan leads and the footer becomes the "book your next track day" nudge.
 *
 * A meeting that has STARTED keeps the same card (2026-07-29). It used to
 * vanish the moment `featuredStatus` flipped to "active", which read as the app
 * forgetting where you were — the countdown just becomes "Day 2 of 3" and the
 * second line carries today's run count instead of the last visit.
 */
export function DashboardNextOutingCard({
  event,
  thingsToTry,
  openTodoCount,
  todayRunCount = 0,
}: {
  /** The featured event ("next" before it starts, "active" while it runs); null when nothing is booked. */
  event: NonNullable<DashboardHomeModel["featuredEvent"]> | null;
  thingsToTry: DashboardHomeModel["thingsToTry"];
  openTodoCount: number;
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

  return (
    // Carries the Things-to-try list on the phone, so it is the walkthrough's last stop there
    // — the desktop's `test-plan` card does not exist below xl.
    <SurfaceCard variant="hero" dataTour="things-to-try">
      {event ? (
        <>
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

          {openTodoCount > 0 ? (
            <div className="pb-1 pt-0.5">
              <span className="inline-flex items-center rounded-md border border-border bg-white/[0.03] px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground">
                {openTodoCount} {openTodoCount === 1 ? "to-do" : "to-dos"} open
              </span>
            </div>
          ) : null}

          <div className="mt-2 border-t border-border/70 pt-3">
            <ActionItemListPanel
              list="try"
              title="Test plan"
              addPlaceholder="Add something to test…"
              initialItems={thingsToTry}
              embedded
            />
          </div>

          {/* The way into the full list, at the foot of the card in every state
              (founder call 2026-07-29) — it used to be a small header link that
              only existed when something was booked. */}
          <div className="mt-3 border-t border-border/70 pt-2.5">
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
        </>
      ) : (
        <>
          {/* Plan-only degrade: no event booked — the test plan leads. */}
          <ActionItemListPanel
            list="try"
            title="Test plan"
            hint="Ideas to test next time you're on track."
            addPlaceholder="Add something to test…"
            initialItems={thingsToTry}
            embedded
          />
          <div className="mt-3 border-t border-border/70 pt-2.5">
            <Link
              href="/events"
              prefetch
              className="tap-active flex items-center gap-2 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <CalendarPlus aria-hidden className="size-[15px]" strokeWidth={2.2} />
              Book your next track day
              <ChevronRight aria-hidden className="ml-auto size-4 text-faint" strokeWidth={2.2} />
            </Link>
          </div>
        </>
      )}
    </SurfaceCard>
  );
}
