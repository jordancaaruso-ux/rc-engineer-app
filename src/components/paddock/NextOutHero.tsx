import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { formatLap } from "@/lib/runLaps";
import { formatDaysUntil } from "@/lib/paddock/paddockModel";
import type { NextUp } from "@/lib/events/seasonTypes";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** `YYYY-MM-DD` → "Saturday 30 August". Parsed as UTC, like every date on the events surfaces. */
function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday} ${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/** `YYYY-MM-DD` → "19 July". No weekday — this one sits in a line that is already long. */
function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/**
 * The top of Paddock: the next meeting, and what you already know about it.
 *
 * This band is why the page can carry meetings at all. Folding events into a page about
 * equipment risked burying the only forward-looking surface in the app, so it goes first
 * and it counts down — which also makes Paddock different every time it is opened, the one
 * thing `/more` could never be.
 *
 * The whole card is the link. An earlier draft put a "Plan this meeting" bar across the
 * foot, which was a verb attached to no action: the meeting already exists, so the only
 * thing that bar could do was open it. Booking a NEW one is the `+` on the Meetings band,
 * where adding lives on every other band too.
 *
 * The meeting name is Sora 700 at hero size — the same voice as every other card title. Since
 * 2026-09-05 that is the only voice in the app: Space Grotesk is deleted and `.page-title` is
 * Sora too, separated from a card title by size (26–32px vs 20–22px), not by a second typeface.
 */
export function NextOutHero({ nextUp }: { nextUp: NextUp }) {
  const { event } = nextUp;
  const venue = [
    event.trackName,
    event.trackLocation ? `(${event.trackLocation})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <Link
        href={`/events/${encodeURIComponent(event.id)}`}
        className="tap-active block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="min-w-0">
            <p className="micro-caps text-primary-ink">Next out</p>
            <p className="ui-title mt-1.5 truncate text-[19px] font-bold leading-tight tracking-tight text-foreground">
              {event.name}
            </p>
            {/*
              Two spans, not one joined string. As one line the venue ate the width and the
              WHEN got truncated away — "TFTR (Melbourne, Australia) · Sunday 30 Au…" — which
              is precisely backwards on a card whose job is the date. The venue truncates; the
              date never does.
            */}
            <p className="mt-1 flex items-baseline gap-1 text-[12px] text-muted-foreground">
              {venue ? <span className="min-w-0 truncate">{venue}</span> : null}
              {venue ? <span aria-hidden>·</span> : null}
              <span className="shrink-0">
                {event.dayCount > 1
                  ? `${event.dayCount} days`
                  : longDate(event.startYmd)}
              </span>
            </p>
          </div>
          {/* The countdown, not the date: "12 days" is the fact you act on, and the date is
              already spelled out on the line above it. */}
          <div className="shrink-0 text-right">
            <span className="block text-[25px] font-semibold leading-none tabular-nums text-foreground">
              {nextUp.daysUntil === 0 ? "—" : nextUp.daysUntil}
            </span>
            <span className="micro-caps text-muted-foreground">
              {nextUp.daysUntil === 0
                ? "today"
                : nextUp.daysUntil === 1
                  ? "day"
                  : "days"}
            </span>
          </div>
        </div>

        {/* Every chip is evidence the app already holds about this venue — the point of the
            hero is that it answers "am I ready" without opening anything. */}
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 pt-2.5">
          <Chip>
            {nextUp.toBeatSeconds != null ? (
              <>
                to beat{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {formatLap(nextUp.toBeatSeconds)}
                </span>
              </>
            ) : (
              "first visit"
            )}
          </Chip>
          {nextUp.visitsHere > 0 ? (
            <Chip>
              <span className="font-semibold tabular-nums text-foreground">
                {nextUp.visitsHere}
              </span>{" "}
              {nextUp.visitsHere === 1 ? "day here" : "days here"}
            </Chip>
          ) : null}
          {nextUp.openTestPlanCount > 0 ? (
            <Chip>
              <span className="font-semibold tabular-nums text-foreground">
                {nextUp.openTestPlanCount}
              </span>{" "}
              {nextUp.openTestPlanCount === 1 ? "idea open" : "ideas open"}
            </Chip>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">
            {/* `shortDate`, not the raw `ymd`: it is a YYYY-MM-DD string, and it rendered as
                "A800RR · 2026-07-19" — a machine timestamp shown to a driver. */}
            {nextUp.carriedSetup
              ? `Finished last visit on ${[
                  nextUp.carriedSetup.carName,
                  shortDate(nextUp.carriedSetup.ymd),
                ]
                  .filter(Boolean)
                  .join(" · ")}`
              : "You have not run this venue before"}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </div>
      </Link>
    </SurfaceCard>
  );
}

/**
 * Nothing booked.
 *
 * The hero does not disappear — a page whose first band vanishes reads as broken, and the
 * absence of a meeting is itself the most useful thing Paddock can tell you. It becomes the
 * invitation instead, and takes the screen's only yellow.
 */
export function NothingBookedHero({
  lastOuting,
}: {
  lastOuting: { trackName: string | null; label: string } | null;
}) {
  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="px-4 pb-3.5 pt-3.5">
        <p className="micro-caps text-muted-foreground">Nothing booked</p>
        <p className="ui-title mt-1.5 text-[19px] font-bold leading-tight tracking-tight text-foreground">
          No meeting planned
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {lastOuting
            ? `You last ran ${lastOuting.trackName ? `at ${lastOuting.trackName}` : "on track"}, ${lastOuting.label}.`
            : "Book one and this becomes a countdown, with what you have to beat there."}
        </p>
      </div>
      <div className="border-t border-border px-4 py-3">
        <ButtonLink href="/events">New event</ButtonLink>
      </div>
    </SurfaceCard>
  );
}

/**
 * `gap-1`, not the `{" "}` between the label and its figure.
 *
 * The chip is `inline-flex`, which makes each text node a flex item — and whitespace
 * BETWEEN flex items is discarded. The first build read "to beat14.927" and "3ideas open"
 * for exactly that reason. The gap is the fix that survives; a non-breaking space would
 * work today and break the moment someone reorders the children.
 */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}
