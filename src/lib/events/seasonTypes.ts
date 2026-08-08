/**
 * Everything the Events page's *views* need from the season model — the shapes and the one
 * formatter — in a module with no Prisma and no `server-only` import.
 *
 * This split is load-bearing, not tidiness. `EventsView` is a client component (it owns the
 * add-form disclosure), so every card it renders becomes a client module too. When
 * `SeasonTimeline` imported `formatWheelTime` as a value from `seasonModel`, that dragged
 * `prisma` and `legacyTrackSnapshot` — both `server-only` — across the boundary, and the
 * page failed to compile. Types alone would have been fine (they erase); one value import
 * was enough to break it.
 *
 * Rule for this folder: views import from here, the server read imports from `seasonModel`.
 */
export type { SeasonEventRow } from "@/lib/events/seasonEventRow";
export type { CadenceRead } from "@/lib/events/seasonCadence";

export type SeasonScope = { year: number | null };

export type VenueRecord = {
  trackId: string;
  name: string;
  location: string | null;
  visits: number;
  laps: number;
  bestLapSeconds: number | null;
  /** UTC calendar day the best lap was set. */
  bestYmd: string | null;
};

export type SeasonStat = {
  value: number | null;
  /** Same figure for the previous year; null when there is no previous year to compare. */
  prior: number | null;
};

export type SeasonStrip = {
  events: SeasonStat;
  daysOnTrack: SeasonStat;
  laps: SeasonStat;
  wheelSeconds: SeasonStat;
  venues: SeasonStat;
  bestLapSeconds: SeasonStat;
  /** True when the run scan hit its cap and the volume figures are a floor, not a total. */
  truncated: boolean;
};

export type NextUp = {
  event: import("@/lib/events/seasonEventRow").SeasonEventRow;
  daysUntil: number;
  /** Lifetime best at this venue — the number to beat, not a scope-limited one. */
  toBeatSeconds: number | null;
  visitsHere: number;
  /** What they finished the last visit here on. Null when they have never run this venue. */
  carriedSetup: { carName: string | null; ymd: string } | null;
  openTestPlanCount: number;
};

export type EventsSeasonModel = {
  scope: SeasonScope;
  /** Years with at least one event, newest first — the year toggle's real options. */
  years: number[];
  events: import("@/lib/events/seasonEventRow").SeasonEventRow[];
  booked: import("@/lib/events/seasonEventRow").SeasonEventRow[];
  logged: import("@/lib/events/seasonEventRow").SeasonEventRow[];
  venues: VenueRecord[];
  strip: SeasonStrip;
  nextUp: NextUp | null;
  cadence: import("@/lib/events/seasonCadence").CadenceRead | null;
  todayYmd: string;
};

/** `13h 04m` — the strip's wheel-time cell. */
export function formatWheelTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds - h * 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
