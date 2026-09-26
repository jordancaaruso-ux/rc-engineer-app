import { instantToWallClockAsUtc } from "@/lib/eventActive";
import {
  isWallClockAsUtcTimingSource,
  timingSourceFromParserId,
  timingSourceFromSourceUrl,
  type LapTimingSource,
  type TimingSessionRef,
} from "@/lib/lapImport/labels";

/**
 * A timing session's time on the TRACK's clock: what the timing screen at the track read.
 *
 * Every timing site posts it (checked live, 2026-09-17). LiveRC and the MyRCM PDF print the track's
 * local time with no zone; Speedhive's race results carry it zoneless; Speedhive's practice loop
 * sends a real instant with the track's offset on it ("2026-09-16T12:37:34.844+02:00"). So one race
 * reads the same track time on every site, and comparing track times needs no time zone at all —
 * not the phone's, which is wrong for a driver who flew home from the meeting before logging it
 * (founder, 2026-09-17: "they all post local time, can't we just use that?").
 *
 * Carried the way the parsers already store LiveRC and MyRCM: the wall-clock digits as-if-UTC.
 * Only for comparing sessions with each other. Anything asking what real time it was (weather, a
 * run's stamp, "today") still needs a zone.
 */

/** Real offsets run from UTC−12 to UTC+14. */
const MAX_OFFSET_MINUTES = 14 * 60;

export function isUtcOffsetMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_OFFSET_MINUTES
  );
}

const OFFSET_RE = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?([+-])(\d{2}):?(\d{2})$/;

/**
 * Minutes east of UTC from the offset a timestamp spells out ("+02:00" → 120, "-0700" → −420).
 * Null for a zoneless time and for "Z": a timestamp written in UTC says nothing about the clock at
 * the track.
 */
export function utcOffsetMinutesFromIso(iso: string | null | undefined): number | null {
  const m = OFFSET_RE.exec(iso?.trim() ?? "");
  if (!m) return null;
  const minutes = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return isUtcOffsetMinutes(minutes) ? minutes : null;
}

export type TrackClockInput = TimingSessionRef & {
  /** The session's stored or listed time, in its source's own convention. */
  iso: string | null | undefined;
  /** When the caller already knows it; otherwise read off `sourceUrl` / `parserId`. */
  timingSource?: LapTimingSource | null;
  /** For a real instant (Speedhive practice): the track's offset from UTC when the session ran. */
  utcOffsetMinutes?: number | null;
  /**
   * Only for a real instant that came with no offset (a practice session imported before offsets
   * were kept): the zone to read it in. Without one the instant is used as it is.
   */
  fallbackTimeZone?: string | null;
};

/** The session's time on the track's clock, as-if-UTC; null when it has no usable time. */
export function trackClockTime(input: TrackClockInput): Date | null {
  const raw = input.iso?.trim();
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  const source =
    input.timingSource ?? timingSourceFromSourceUrl(input.sourceUrl) ?? timingSourceFromParserId(input.parserId);
  if (isWallClockAsUtcTimingSource(source, input)) return at;
  if (isUtcOffsetMinutes(input.utcOffsetMinutes)) {
    return new Date(at.getTime() + input.utcOffsetMinutes * 60_000);
  }
  const zone = input.fallbackTimeZone?.trim();
  if (zone) {
    try {
      return instantToWallClockAsUtc(at, zone);
    } catch {
      // A zone Intl does not know: the instant as it is, as before offsets were kept.
    }
  }
  return at;
}

/** The calendar day of the session at the track (YYYY-MM-DD); null when it has no usable time. */
export function trackClockDayKey(input: TrackClockInput): string | null {
  return trackClockTime(input)?.toISOString().slice(0, 10) ?? null;
}

/**
 * A day with no clock: a timing site printed only the date, and the parser stored that day's
 * midnight on the track's clock. A LiveRC race page prints only its meeting's date when the
 * meeting's list can't be read (`livercRaceListedTime.ts`); a MyRCM file can print a date alone.
 * Nothing is timed at 00:00:00.000 to the millisecond, so in a source that stores the track's wall
 * clock it means "that day, time unknown": printed as a date, and never a reason to call two
 * sessions the same time on track. Races imported before the list was read are stored this way.
 */
export function isDateOnlyTrackTime(input: TrackClockInput): boolean {
  const raw = input.iso?.trim();
  if (!raw) return false;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return false;
  const source =
    input.timingSource ?? timingSourceFromSourceUrl(input.sourceUrl) ?? timingSourceFromParserId(input.parserId);
  if (!isWallClockAsUtcTimingSource(source, input)) return false;
  return (
    at.getUTCHours() === 0 &&
    at.getUTCMinutes() === 0 &&
    at.getUTCSeconds() === 0 &&
    at.getUTCMilliseconds() === 0
  );
}
