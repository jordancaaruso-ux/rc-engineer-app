"use client";

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { formatLap } from "@/lib/runLaps";
import type { CadenceRead, NextUp } from "@/lib/events/seasonTypes";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function splitYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { day: String(d ?? 1).padStart(2, "0"), month: MONTHS[(m ?? 1) - 1] ?? "", year: y ?? 0 };
}

function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  ]!;
}

/**
 * The dossier for the next meeting: what you're rolling out on, what you have to beat,
 * and what you said you'd test. Everything here is evidence the app already holds — the
 * point of the card is that it answers "am I ready" without you opening anything.
 */
export function NextUpCard({ nextUp }: { nextUp: NextUp }) {
  const { event } = nextUp;
  const date = splitYmd(event.startYmd);

  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="micro-caps text-foreground">
          Next up
        </span>
        <span className="ml-auto micro-caps text-muted-foreground">
          Booked
        </span>
      </div>

      <div className="px-5 pb-4 pt-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-lg border border-border bg-background/45 px-3 py-2 text-center">
            <div className="text-[26px] font-medium leading-none tabular-nums text-foreground">
              {date.day}
            </div>
            <div className="mt-1 tabular-nums text-[10px] tracking-[.1em] text-muted-foreground">
              {date.month}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-bold leading-[1.15] tracking-[-.02em] text-foreground">
              {event.name}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {[
                // Venue and its town are one phrase — "Boronia (Melbourne)" — not two
                // dot-separated facts, or the line reads "Boronia · (Melbourne) · Saturday".
                event.trackName
                  ? event.trackLocation
                    ? `${event.trackName} (${event.trackLocation})`
                    : event.trackName
                  : null,
                event.dayCount > 1 ? `${event.dayCount} days` : weekdayOf(event.startYmd),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="mt-2 micro-caps text-muted-foreground">
              {nextUp.daysUntil === 0
                ? "Today"
                : `In ${nextUp.daysUntil} ${nextUp.daysUntil === 1 ? "day" : "days"}`}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-background/45">
          <div className="border-r border-border px-3 py-2.5">
            <div className="text-[10.5px] font-semibold text-muted-foreground">To beat here</div>
            <div className="mt-1 text-[18px] font-medium tabular-nums text-foreground">
              {formatLap(nextUp.toBeatSeconds)}
            </div>
          </div>
          <div className="px-3 py-2.5">
            {/* "Days here", not the handoff's "visits": the records card beside this one
                counts days you turned a wheel, and two different numbers for Boronia on
                one screen is worse than the smaller one being right. */}
            <div className="text-[10.5px] font-semibold text-muted-foreground">Days here</div>
            <div className="mt-1 text-[18px] font-medium tabular-nums text-foreground">
              {nextUp.visitsHere}
            </div>
          </div>
        </div>

        <div className="mt-3.5">
          {/* The handoff printed a final-drive ratio and pinion here. Setup values live in a
              per-chassis JSON blob whose field names are not reliable across kits, so naming
              a ratio would be a guess dressed as a fact. The car and the day you last ran
              this venue are both certain, and answer the same question. */}
          <CarryRow
            label="Setup you finished on"
            value={
              nextUp.carriedSetup
                ? [nextUp.carriedSetup.carName, shortDate(nextUp.carriedSetup.ymd)]
                    .filter(Boolean)
                    .join(" · ")
                : "First visit"
            }
            divider
          />
          <CarryRow
            label="Test-plan ideas open"
            value={String(nextUp.openTestPlanCount).padStart(2, "0")}
          />
        </div>
      </div>

      <Link
        href={`/events/${event.id}`}
        prefetch={false}
        className="tap-active flex items-center gap-2.5 border-t border-border px-5 py-3 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        Open the event
        <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-faint" aria-hidden />
      </Link>
    </SurfaceCard>
  );
}

function CarryRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-2.5${
        divider ? " border-b border-[rgb(40,39,38)]/70" : ""
      }`}
    >
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[13px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function shortDate(ymd: string): string {
  const { day, month } = splitYmd(ymd);
  return `${Number(day)} ${month.charAt(0)}${month.slice(1).toLowerCase()}`;
}

/**
 * What sits in the Next up slot with nothing booked — the founder's own state (16 logged,
 * 0 upcoming), so this is the common case rather than an edge one.
 *
 * It reads the racing rhythm out of logged events and names it, then offers the date that
 * rhythm implies. "No upcoming events" would be true and useless; "you've raced Boronia
 * five of the last six Saturdays" is the same fact turned into a reason to book.
 */
export function NothingBookedCard({
  cadence,
  onNewEvent,
}: {
  cadence: CadenceRead;
  onNewEvent: (suggestedYmd: string | null) => void;
}) {
  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="micro-caps text-foreground">
          Nothing booked
        </span>
      </div>

      <div className="px-5 pb-6 pt-5">
        <p className="text-pretty text-[20px] font-bold leading-[1.2] tracking-[-.02em] text-foreground">
          {cadence.headline}
        </p>
        <p className="mt-2 max-w-[44ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Put the next one in and this becomes the dossier — the lap to beat, the setup you
          finished on, and what you said you&rsquo;d test.
        </p>

        {cadence.suggestedLabel ? (
          <p className="mt-3 micro-caps text-muted-foreground">
            Next one would be {cadence.suggestedLabel}
          </p>
        ) : null}

        <div className="mt-5 flex items-center gap-3.5">
          <button
            type="button"
            onClick={() => onNewEvent(cadence.suggestedYmd)}
            className="tap-active inline-flex min-h-[38px] items-center gap-2 rounded-lg primary-face bg-primary px-4 text-[13px] font-semibold tracking-[-.01em] whitespace-nowrap text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Plus className="size-4" strokeWidth={2.6} aria-hidden />
            {cadence.suggestedYmd ? `Book ${weekdayOf(cadence.suggestedYmd)}` : "New event"}
          </button>
          <Link
            href="/runs/new"
            prefetch={false}
            className="whitespace-nowrap text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            Log a past meeting
          </Link>
        </div>
      </div>
    </SurfaceCard>
  );
}
