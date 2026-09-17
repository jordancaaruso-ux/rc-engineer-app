import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";

/**
 * Speedhive race sessions (`api2.mylaps.com/events/{id}/sessions`) carry `startTime` as the
 * track's wall clock with no zone — "2026-09-13T10:11:00". Parsed with `new Date` it became the
 * SERVER's zone, and read back in the track's zone an afternoon heat in Japan or Australia moved
 * to the next day and was left out of its own day's import. Pure, so the rules are tested.
 */

const ZONELESS_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** The track-local date a session ran on, or null when the time can't be read. */
export function speedhiveSessionLocalYmd(startTime: string | null | undefined, timeZone: string): string | null {
  const raw = startTime?.trim();
  if (!raw) return null;
  const zoneless = ZONELESS_RE.exec(raw);
  if (zoneless) return zoneless[1]!;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : calendarYmdInTimeZone(d, timeZone);
}

/** When the session ran, as a real instant — the wall clock read in the track's zone. */
export function speedhiveSessionInstant(startTime: string | null | undefined, timeZone: string): Date | null {
  const raw = startTime?.trim();
  if (!raw) return null;
  if (ZONELESS_RE.test(raw)) {
    const asUtc = new Date(`${raw}Z`);
    return Number.isNaN(asUtc.getTime()) ? null : wallClockAsUtcToInstant(asUtc, timeZone);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ymdShift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A multi-day meeting's Sunday sessions sit under an event that started days earlier, and the
 * date a club enters is not a boundary. An event that starts after the day cannot hold it.
 */
export const SPEEDHIVE_EVENT_LOOKBACK_DAYS = 7;
