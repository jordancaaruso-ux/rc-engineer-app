import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatLap } from "@/lib/runLaps";
import {
  formatWheelTime,
  type SeasonEventRow,
  type SeasonStat,
  type SeasonStrip,
  type VenueRecord,
} from "@/lib/events/seasonTypes";
import {
  buildTimelineDomain,
  positionPct,
  tickColumns,
  widthPct,
  type TimelineDomain,
} from "@/lib/events/seasonTimeline";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * The season timeline — the page's hero (design handoff "Events / Season", 2026-08-08).
 *
 * One lane per venue, marks placed on the real date, so a year of racing reads as a shape
 * rather than a list. This is the answer to the page's actual failure: twelve identical
 * "Clubday · Boronia" rows told you nothing, and a mark on 29 July next to a gap through
 * August tells you plenty.
 *
 * Marks are real links, in a real list, with real labels — see the a11y note on `Marker`.
 * A 7px rectangle is not a control anyone can hit or read, so the row table below carries
 * the same events in full; the timeline is the overview, never the only route.
 */
export function SeasonTimeline({
  year,
  years,
  events,
  venues,
  strip,
  todayYmd,
}: {
  year: number | null;
  years: number[];
  events: SeasonEventRow[];
  venues: VenueRecord[];
  strip: SeasonStrip;
  todayYmd: string;
}) {
  const domain = buildTimelineDomain({ year, years, todayYmd });

  /* One lane per venue that has events, busiest first.
     Venues with runs but no meetings are deliberately NOT laned — this is a timeline of
     events, and an empty lane is a row of nothing with a name on it. They still appear
     in the records card, which is about pace rather than meetings, so that card can be
     longer than this one. It also sorts differently (by days there, not events), because
     they are answering different questions. Events with no track get a final lane rather
     than silently vanishing. */
  const lanes = venues
    .map((v) => ({
      key: v.trackId,
      name: v.name,
      events: events.filter((e) => e.trackId === v.trackId),
    }))
    .filter((lane) => lane.events.length > 0)
    .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name));
  const orphans = events.filter((e) => !e.trackId);
  if (orphans.length) lanes.push({ key: "none", name: "No track", events: orphans });

  const columns = tickColumns(domain);
  const logged = events.filter((e) => e.status === "logged").length;
  const booked = events.filter((e) => e.status === "booked").length;

  return (
    <SurfaceCard variant="hero" contentClassName="p-0" className="rounded-2xl">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="h-3.5 w-[3px] shrink-0 skew-x-[-21deg] rounded-sm bg-primary" aria-hidden />
        <span className="micro-caps text-foreground">
          {year == null ? "All time" : `Season ${year}`}
        </span>
        <span className="truncate text-[12px] text-faint">
          {[
            domain.ticks.length === 12 ? "Jan – Dec" : `${domain.ticks[0]?.label} – ${domain.ticks.at(-1)?.label}`,
            `${logged} logged`,
            `${booked} booked`,
          ].join(" · ")}
        </span>
        <Legend />
      </div>

      <div className="flex gap-0 px-6 pb-[18px] pt-5">
        {/* Lane labels sit outside the track area so the marks all share one origin. */}
        <div className="w-[104px] shrink-0" aria-hidden>
          <div className="h-4" />
          {lanes.map((lane) => (
            <div key={lane.key} className="flex h-[34px] flex-col justify-center">
              <span className="truncate micro-caps text-foreground">
                {lane.name}
              </span>
              <span className="tabular-nums text-[9px] tracking-[.08em] text-muted-foreground">
                {lane.events.length} {lane.events.length === 1 ? "EVENT" : "EVENTS"}
              </span>
            </div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="relative h-4">
            {domain.todayPct != null ? (
              <span
                className="absolute -translate-x-1/2 tabular-nums text-[9px] font-bold tracking-[.14em] text-muted-foreground"
                style={{ left: `${domain.todayPct}%` }}
              >
                TODAY
              </span>
            ) : null}
          </div>

          <div className="relative">
            {lanes.length === 0 ? (
              <p className="flex h-[68px] items-center text-[12.5px] text-muted-foreground">
                No meetings {year == null ? "logged yet" : `in ${year}`}.
              </p>
            ) : null}
            {lanes.map((lane) => (
              <ul
                key={lane.key}
                aria-label={`${lane.name} — ${lane.events.length} events`}
                className="relative m-0 h-[34px] list-none border-b border-[rgb(40,39,38)]/70 p-0"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: columns }}
                >
                  {domain.ticks.map((tick, i) => (
                    <span key={i} className="border-l border-[rgb(40,39,38)]/70" />
                  ))}
                </span>
                {lane.events.map((event) => (
                  <Marker key={event.id} event={event} domain={domain} />
                ))}
              </ul>
            ))}
            {domain.todayPct != null ? (
              <span
                aria-hidden
                className="absolute inset-y-0 w-px"
                style={{
                  left: `${domain.todayPct}%`,
                  background:
                    "repeating-linear-gradient(180deg, rgb(100,98,94) 0 3px, transparent 3px 7px)",
                }}
              />
            ) : null}
          </div>

          <div
            aria-hidden
            className="mt-2 grid tabular-nums text-[10px] tracking-[.1em] text-muted-foreground"
            style={{ gridTemplateColumns: columns }}
          >
            {domain.ticks.map((tick, i) => (
              <span key={i} className={cn("text-center", tick.current && "text-foreground")}>
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <StatStrip strip={strip} />
    </SurfaceCard>
  );
}

function Legend() {
  const items: Array<{ label: string; className: string; tall?: boolean }> = [
    { label: "logged", className: "bg-muted-foreground" },
    { label: "booked", className: "border border-faint" },
    { label: "venue best", className: "bg-primary" },
    { label: "multi-day", className: "bg-foreground", tall: true },
  ];
  return (
    <div className="ml-auto hidden shrink-0 items-center gap-4 2xl:flex">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            aria-hidden
            className={cn("rounded-sm", item.className, item.tall ? "h-5 w-3" : "h-3.5 w-[7px]")}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * One event on a lane.
 *
 * Accessibility over fidelity in three places the prototype could not address:
 *
 *  - it is an `<a>` in an `<li>`, not a positioned `<span>`, so the lane is a list of
 *    links a screen reader can walk and a keyboard can reach;
 *  - the `aria-label` spells out everything the shape and fill encode — "Clubday,
 *    Boronia, 29 July, best lap 16.284, your best here";
 *  - the hit area is padded out to 16px wide and the full lane height while the visible
 *    mark stays 7px, because a 7px target is not clickable with a real mouse.
 *
 * Booked vs logged survives greyscale: booked is an outline, logged is filled.
 */
function Marker({ event, domain }: { event: SeasonEventRow; domain: TimelineDomain }) {
  const left = positionPct(domain, event.startYmd);
  if (left == null) return null;

  const multiDay = event.dayCount > 1;
  const booked = event.status === "booked";
  const width = multiDay ? Math.max(widthPct(domain, event.dayCount), 0.55) : null;

  const fill = booked
    ? "border border-faint bg-transparent"
    : event.isVenueBest
      ? "bg-primary"
      : multiDay
        ? "bg-foreground"
        : "bg-muted-foreground";

  return (
    <li
      className="absolute inset-y-0"
      style={
        width != null
          ? { left: `${left}%`, width: `${width}%` }
          : { left: `${left}%`, transform: "translateX(-50%)" }
      }
    >
      <Link
        href={`/events/${event.id}`}
        prefetch={false}
        aria-label={markerLabel(event)}
        title={markerLabel(event)}
        className="group/mark absolute inset-y-0 -left-2 -right-2 flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span
          aria-hidden
          className={cn(
            "block rounded-sm transition-[transform,box-shadow] group-hover/mark:scale-y-110",
            fill,
            multiDay ? "h-[22px] w-full min-w-[12px]" : "h-4 w-[7px]"
          )}
        />
      </Link>
    </li>
  );
}

function markerLabel(event: SeasonEventRow): string {
  const parts = [event.name, event.trackName, longDate(event.startYmd)];
  if (event.dayCount > 1) parts.push(`${event.dayCount} days`);
  if (event.status === "booked") parts.push("booked");
  else {
    parts.push(`${event.runCount} ${event.runCount === 1 ? "run" : "runs"}`);
    if (event.bestLapSeconds != null) parts.push(`best lap ${formatLap(event.bestLapSeconds)}`);
    if (event.isVenueBest) parts.push("your best here");
  }
  return parts.filter(Boolean).join(", ");
}

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTH_LONG[(m ?? 1) - 1]} ${y}`;
}

/**
 * Six hairline cells under the timeline.
 *
 * Volume deltas (events, days, laps, wheel time) carry a plain ↑/↓ in neutral ink — more
 * is not better and less is not failure, which is an existing app rule. Only the pace cell
 * goes green or red, because a lap time genuinely has a good direction.
 */
function StatStrip({ strip }: { strip: SeasonStrip }) {
  const cells: Array<{
    label: string;
    value: string;
    stat: SeasonStat;
    format: (n: number) => string;
    pace?: boolean;
  }> = [
    { label: "Events", value: String(strip.events.value ?? 0), stat: strip.events, format: (n) => String(Math.round(n)) },
    { label: "Days on track", value: String(strip.daysOnTrack.value ?? 0), stat: strip.daysOnTrack, format: (n) => String(Math.round(n)) },
    { label: "Laps", value: (strip.laps.value ?? 0).toLocaleString(), stat: strip.laps, format: (n) => Math.round(n).toLocaleString() },
    { label: "Wheel time", value: formatWheelTime(strip.wheelSeconds.value ?? 0), stat: strip.wheelSeconds, format: formatWheelTime },
    { label: "Venues", value: String(strip.venues.value ?? 0), stat: strip.venues, format: (n) => String(Math.round(n)) },
    { label: "Season best", value: formatLap(strip.bestLapSeconds.value), stat: strip.bestLapSeconds, format: (n) => n.toFixed(3), pace: true },
  ];

  return (
    <div className="grid grid-cols-6 border-t border-border">
      {cells.map((cell, i) => (
        <div key={cell.label} className={cn("px-5 py-3", i < cells.length - 1 && "border-r border-border")}>
          <div className="text-[10.5px] font-semibold text-muted-foreground">{cell.label}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[18px] font-medium tabular-nums text-foreground">
              {cell.value}
            </span>
            {cell.pace ? (
              <PaceDelta stat={cell.stat} />
            ) : (
              <VolumeDelta stat={cell.stat} format={cell.format} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function VolumeDelta({ stat, format }: { stat: SeasonStat; format: (n: number) => string }) {
  if (stat.value == null || stat.prior == null) return null;
  const diff = stat.value - stat.prior;
  if (Math.abs(diff) < 0.5) return <span className="text-[10.5px] text-muted-foreground">±0</span>;
  return (
    <span className="text-[10px] tabular-nums text-muted-foreground">
      {diff > 0 ? "↑" : "↓"} {format(Math.abs(diff))}
    </span>
  );
}

/** Pace against the same figure a year ago — lower is faster, so a drop is green. */
function PaceDelta({ stat }: { stat: SeasonStat }) {
  if (stat.value == null || stat.prior == null) return null;
  const diff = stat.value - stat.prior;
  if (Math.abs(diff) < 0.0005) return null;
  const faster = diff < 0;
  return (
    <span
      className={cn(
        "text-[11px] font-bold tabular-nums",
        faster ? "text-gain" : "text-destructive"
      )}
    >
      {faster ? "▼" : "▲"} {Math.abs(diff).toFixed(3)}
    </span>
  );
}
