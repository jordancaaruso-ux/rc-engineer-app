import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { todayBoundsInTimeZone, wallClockAsUtcToInstant } from "@/lib/eventActive";
import type { LapTimingSource } from "@/lib/lapImport/labels";
import { timingSessionDayKey } from "@/lib/runs/backfillCandidates";

/**
 * "Get my day" day rules (founder call 2026-09-15). Pure, and shared by the sheet (which days to
 * offer) and the route (which day was asked for, and which sessions belong to it).
 */

/** Today and the four days before it: the morning after a meeting, and the weekend from midweek. */
export const GET_MY_DAY_DAYS = 5;

export type DayChoice = { ymd: string; label: string };

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Today, Yesterday, then short weekday names — newest first, in `timeZone`'s calendar. */
export function recentDayChoices(
  now: Date,
  timeZone: string,
  count: number = GET_MY_DAY_DAYS,
): DayChoice[] {
  const [y, m, d] = calendarYmdInTimeZone(now, timeZone).split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" });
  const out: DayChoice[] = [];
  for (let i = 0; i < count; i++) {
    const noon = new Date(Date.UTC(y!, m! - 1, d! - i, 12));
    out.push({
      ymd: noon.toISOString().slice(0, 10),
      label: i === 0 ? "Today" : i === 1 ? "Yesterday" : weekday.format(noon),
    });
  }
  return out;
}

/** Whole days from `timeZone`'s today to `ymd`: 0 today, −1 yesterday, 1 tomorrow. Null if not a date. */
export function daysFromToday(ymd: string, now: Date, timeZone: string): number | null {
  if (!isValidYmd(ymd)) return null;
  const today = calendarYmdInTimeZone(now, timeZone);
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** [start, end) of a calendar day at the track, as instants. DST days run 23 or 25 hours. */
export function dayBoundsForYmd(ymd: string, timeZone: string): { start: Date; end: Date } {
  const noon = wallClockAsUtcToInstant(new Date(`${ymd}T12:00:00.000Z`), timeZone);
  return todayBoundsInTimeZone(timeZone, noon);
}

export type DayCandidate = {
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  linkedRunId: string | null;
};

/**
 * One discovery's sessions for the day, split into what still needs filing and what is already on
 * a run. Speedhive's times are instants, read in the track's zone; LiveRC's are the track's wall
 * clock stored as UTC, so their UTC date IS the track's date (`timingSessionDayKey`). A session
 * with no time cannot be placed on a day and is left out; each URL counts once.
 */
export function splitDayCandidates<T extends DayCandidate>(
  candidates: readonly T[],
  ymd: string,
  source: LapTimingSource,
  timeZone: string,
): { toFile: T[]; alreadyOnRuns: number } {
  const seen = new Set<string>();
  const toFile: T[] = [];
  let alreadyOnRuns = 0;
  for (const c of candidates) {
    const url = c.sessionUrl.trim();
    if (!url || seen.has(url) || !c.sessionCompletedAtIso) continue;
    if (timingSessionDayKey(c.sessionCompletedAtIso, source, timeZone) !== ymd) continue;
    seen.add(url);
    if (c.linkedRunId) alreadyOnRuns += 1;
    else toFile.push(c);
  }
  return { toFile, alreadyOnRuns };
}
