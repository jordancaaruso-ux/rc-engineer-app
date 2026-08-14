import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import type { VenueRecord } from "@/lib/events/seasonTypes";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Your record at each venue in the scope on screen.
 *
 * No yellow tab: secondary cards don't get one — the timeline is the only hero on the page.
 */
export function VenueRecordsCard({
  venues,
  year,
  hasOtherYears,
}: {
  venues: VenueRecord[];
  year: number | null;
  /** Whether an "All time" scope exists to point at — with one season it does not. */
  hasOtherYears: boolean;
}) {
  return (
    <SurfaceCard contentClassName="p-0" className="rounded-xl">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="micro-caps text-muted-foreground">
          Your record by venue
        </span>
      </div>

      <div className="px-5 pb-2 pt-1.5">
        {venues.length === 0 ? (
          <p className="py-4 text-[12.5px] text-muted-foreground">
            No venues yet {year == null ? "" : `in ${year}`}.
          </p>
        ) : (
          venues.map((venue, i) => (
            <div
              key={venue.trackId}
              className={cn(
                "flex items-center gap-3 py-3.5",
                i < venues.length - 1 && "border-b border-[rgb(40,39,38)]/70"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold tracking-[-.01em] text-foreground">
                  {venue.name}
                </span>
                {/* "days", not the handoff's "visits": a visit sounds like a meeting, and
                    on this account most runs have no event attached, so a meeting count
                    and a day count are wildly different numbers. Days you turned a wheel
                    is the one that is always true and always derivable. */}
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[
                    venue.location,
                    `${venue.visits} ${venue.visits === 1 ? "day" : "days"}`,
                    `${venue.laps.toLocaleString()} laps`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] tabular-nums text-foreground">
                  {formatLap(venue.bestLapSeconds)}
                </span>
                <span className="block tabular-nums text-[10px] tracking-[.08em] text-muted-foreground">
                  {venue.bestYmd ? shortStamp(venue.bestYmd) : "NO TIMED LAPS"}
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Don't point at "All time" unless that scope is actually on screen — with a single
          season the year toggle is hidden, and the sentence would name a control the
          driver cannot find. */}
      <p className="border-t border-border px-5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
        {year == null
          ? "Your best lap at each venue, across every season."
          : hasOtherYears
            ? `Your best lap at each venue in ${year}. Tracks you haven't run this season sit under All time.`
            : `Your best lap at each venue in ${year}.`}
      </p>
    </SurfaceCard>
  );
}

function shortStamp(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${String(d ?? 1).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]}`;
}
