import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { utcOffsetMinutesFromIso } from "@/lib/lapImport/trackClock";

/**
 * Speedhive race sessions (`api2.mylaps.com/events/{id}/sessions`) carry `startTime` as the
 * track's wall clock with no zone — "2026-09-13T10:11:00". Parsed with `new Date` it became the
 * SERVER's zone, and read back in the track's zone an afternoon heat in Japan or Australia moved
 * to the next day and was left out of its own day's import. The lap crossings on the same results
 * are the track's clock too (checked live 2026-09-17), so a race result's times are kept the way
 * LiveRC's are: the wall clock as-if-UTC (`lapImport/labels.ts`). Pure, so the rules are tested.
 */

const ZONELESS_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?$/;

/** The track-local date a session ran on, or null when the time can't be read. */
export function speedhiveSessionLocalYmd(startTime: string | null | undefined, timeZone: string): string | null {
  const raw = startTime?.trim();
  if (!raw) return null;
  const zoneless = ZONELESS_RE.exec(raw);
  if (zoneless) return zoneless[1]!;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : calendarYmdInTimeZone(d, timeZone);
}

/**
 * When a race session ran by the track's clock, stored as-if-UTC ("2026-09-13T10:11:00" →
 * "2026-09-13T10:11:00.000Z") — the convention its imported result keeps, so the list's time and
 * the session's own agree wherever they meet. A time that spells out a zone keeps its digits.
 */
export function speedhiveSessionWallClockIso(startTime: string | null | undefined): string | null {
  const m = WALL_CLOCK_RE.exec(startTime?.trim() ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The track's offset from UTC off a practice run's own timestamps ("…12:37:34.844+02:00" → 120):
 * the run's start, else any lap's. Kept beside the practice loop's real instant so the same race on
 * another timing site can be matched on the track's clock (`lapImport/trackClock.ts`).
 */
export function speedhivePracticeUtcOffsetMinutes(
  blocks: ReadonlyArray<{
    dateTimeStart?: string | null;
    laps?: ReadonlyArray<{ dateTimeStart?: string | null }> | null;
  }>
): number | null {
  for (const block of blocks) {
    const offset = utcOffsetMinutesFromIso(block.dateTimeStart);
    if (offset != null) return offset;
    for (const lap of block.laps ?? []) {
      const lapOffset = utcOffsetMinutesFromIso(lap.dateTimeStart);
      if (lapOffset != null) return lapOffset;
    }
  }
  return null;
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
