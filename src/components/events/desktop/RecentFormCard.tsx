import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import type { SeasonEventRow } from "@/lib/events/seasonTypes";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const GRID = "grid-cols-[74px_minmax(0,1fr)_84px_92px_92px]";

/**
 * Recent form — the same events as the timeline, in full.
 *
 * This is where the removed `Planned` badge is replaced. What tells twelve identical
 * "Clubday · Boronia" rows apart is their evidence: how many runs, what you ran, and
 * whether it beat what you'd done there before. A badge that said `Planned` on a club
 * day you raced in April told you nothing and was actively wrong.
 */
export function RecentFormCard({
  events,
  totalCount,
  limit = 7,
}: {
  events: SeasonEventRow[];
  totalCount: number;
  limit?: number;
}) {
  const rows = events.slice(0, limit);
  const hidden = totalCount - rows.length;

  return (
    <SurfaceCard contentClassName="p-0" className="rounded-xl">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span className="micro-caps text-muted-foreground">
          Recent form
        </span>
        {hidden > 0 ? (
          <span className="ml-auto text-[11px] tabular-nums text-faint">
            {rows.length} of {totalCount}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "grid gap-3 border-b border-border bg-background/35 px-5 py-2.5 micro-caps text-muted-foreground",
          GRID
        )}
      >
        <span>Date</span>
        <span>Event</span>
        <span className="text-right">Runs</span>
        <span className="text-right">Best lap</span>
        <span className="text-right">Vs venue</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-[12.5px] text-muted-foreground">
          No meetings logged in this window yet.
        </p>
      ) : (
        rows.map((event, i) => (
          <Link
            key={event.id}
            href={`/events/${event.id}`}
            prefetch={false}
            className={cn(
              "tap-active grid items-center gap-3 px-5 py-2.5 transition hover:bg-white/[.02] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30",
              GRID,
              i < rows.length - 1 && "border-b border-[rgb(40,39,38)]/70",
              // A meeting with no runs attached has nothing to say yet. It stays in the
              // table — it is real, and its emptiness is itself worth seeing — but it
              // steps back so the eye lands on the rows carrying evidence.
              event.runCount === 0 && "opacity-55"
            )}
          >
        <span className="micro-caps text-muted-foreground">
              {shortStamp(event.startYmd)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold tracking-[-.01em] text-foreground">
                {event.name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {[event.trackName, event.dayCount > 1 ? `${event.dayCount} days` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="text-right text-[13px] tabular-nums text-muted-foreground">
              {event.runCount}
            </span>
            <span className="text-right text-[13px] tabular-nums text-foreground">
              {formatLap(event.bestLapSeconds)}
            </span>
            <span className="text-right">
              <VsVenue seconds={event.vsVenueSeconds} hasPace={event.bestLapSeconds != null} />
            </span>
          </Link>
        ))
      )}
    </SurfaceCard>
  );
}

/**
 * Event best against the venue best as it stood the day before. Negative is faster, so it
 * reads green — the same direction rule the dashboard hero uses. A first visit has nothing
 * to compare against and says so rather than printing a zero.
 */
function VsVenue({ seconds, hasPace }: { seconds: number | null; hasPace: boolean }) {
  if (seconds == null) {
    return (
      <span className="tabular-nums text-[11px] text-faint">{hasPace ? "first visit" : "—"}</span>
    );
  }
  if (Math.abs(seconds) < 0.0005) {
    return <span className="text-[12px] tabular-nums text-muted-foreground">±0</span>;
  }
  const faster = seconds < 0;
  return (
    <span
      className={cn(
        "text-[12px] font-bold tabular-nums",
        faster ? "text-gain" : "text-destructive"
      )}
    >
      {faster ? "▼" : "▲"} {Math.abs(seconds).toFixed(3)}
    </span>
  );
}

function shortStamp(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${String(d ?? 1).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]}`;
}
