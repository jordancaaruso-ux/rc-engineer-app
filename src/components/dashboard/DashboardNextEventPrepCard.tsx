import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, HubRowTitle, PanelSubtitle } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatAppTimestampUtc } from "@/lib/formatDate";

function countdownLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return "starts today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * Off-day lead: what's coming up — the next event, how far out it is, and what
 * you ran at that track last time. Absorbs the old race-meeting card
 * (docs/DASHBOARD_NORTH_STAR.md, 2026-07-16). Renders only for an upcoming
 * event; on an active event day the dashboard is in track-day mode instead.
 */
export function DashboardNextEventPrepCard({
  event,
}: {
  event: NonNullable<DashboardHomeModel["featuredEvent"]>;
}) {
  const countdown = countdownLabel(event.daysUntilStart);

  return (
    <CardPanel className="relative">
      <Link
        href={`/events/${encodeURIComponent(event.id)}`}
        prefetch
        aria-label="View event"
        className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="pointer-events-none relative z-10">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Eyebrow className="mb-0">Next race meeting</Eyebrow>
          {countdown ? (
            <span className="text-[12px] font-semibold text-foreground">{countdown}</span>
          ) : null}
        </div>

        <div className="mt-1.5 min-w-0">
          <HubRowTitle as="h3">{event.name}</HubRowTitle>
          <PanelSubtitle className="mt-1 text-foreground">
            {[event.dateLabel, event.trackLabel ?? "Track not set — link one on the event"]
              .filter(Boolean)
              .join(" · ")}
          </PanelSubtitle>
        </div>

        {event.lastVisit ? (
          <div className="mt-2.5 border-t border-border/70 pt-2.5">
            <div className="type-data-label">Last time at this track</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted-foreground">
              <span className="lap-figure text-[14px] font-medium text-foreground">
                {formatLap(event.lastVisit.bestLap)}
              </span>
              <span>
                best · {event.lastVisit.runCount}{" "}
                {event.lastVisit.runCount === 1 ? "run" : "runs"} ·{" "}
                <RelativeTime
                  iso={event.lastVisit.dateIso}
                  fallback={formatAppTimestampUtc(event.lastVisit.dateIso)}
                />
              </span>
            </div>
          </div>
        ) : event.trackLabel ? (
          <PanelSubtitle className="mt-2.5 border-t border-border/70 pt-2.5">
            First time at this track — no previous visit logged.
          </PanelSubtitle>
        ) : null}
      </div>
    </CardPanel>
  );
}
