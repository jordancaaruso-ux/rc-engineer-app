import { calendarYmdInTimeZone } from "@/lib/formatDate";

/**
 * The timing sweep's schedule, kept OUTSIDE Postgres so a quiet five-minute tick never wakes the
 * database. Documents live in Blob storage (`blobStore.ts`):
 *
 *   plan.json          — rebuilt nightly: who is listening (paid, with a chip or a LiveRC name),
 *                        which tracks they race, each track's timing URLs and clock.
 *   evening/<track>.json — one per track: which day it last looked at and how far that look got
 *                        (`SweepTrackDayDoc`). Written by the tick when it hands a track off and
 *                        by the worker when it finishes, so two workers never share a document.
 *
 * There is no daytime polling (founder ruling 2026-09-15: "your day arrived tonight" is the
 * product; no mid-day calls). The `armed/` documents and the 5/10-minute pollers that used them
 * were deleted with that ruling. Everything here is pure so the rules are unit-tested; the DB is
 * the truth for runs and claims, these documents are only a schedule and may be lost without harm.
 */

export const SWEEP_DOC_VERSION = 1 as const;

export type SweepSource = "speedhive" | "liverc";

export type SweepPlanUser = {
  id: string;
  email: string | null;
  timeZone: string | null;
  /** Normalised transponder codes (`normalizeSpeedhiveTransponderNumber`). Empty when loaner-flagged. */
  chips: string[];
  liveRcName: string | null;
  tier: string;
};

export type SweepPlanTrack = {
  id: string;
  name: string;
  speedhiveUrl: string | null;
  liveRcUrl: string | null;
  /** Resolved IANA zone — never null in the plan (`resolveTrackTimeZone`). */
  timeZone: string;
  /** Listening users who raced here in the last ~90 days. */
  userIds: string[];
};

export type SweepPlanDoc = {
  v: typeof SWEEP_DOC_VERSION;
  builtIso: string;
  users: Record<string, SweepPlanUser>;
  /** chip code → user ids (a club chip may be saved by more than one driver). */
  chips: Record<string, string[]>;
  tracks: Record<string, SweepPlanTrack>;
};

/** Which look of the day a track job is: the 8 pm one, or the 8 am one that a late night owes. */
export type SweepSlot = "evening" | "morning";

/** One unit of work: one track, one track-local day, one look. What the tick hands a worker. */
export type SweepTrackJob = { trackId: string; ymd: string; slot: SweepSlot };

/**
 * A track's bookkeeping for its most recent day (`evening/<trackId>.json`):
 *
 *   evening-claimed → the tick handed the 8 pm look to a worker (written BEFORE the work, so a
 *                     tick that overlaps or a worker that dies can never send a day twice);
 *   done            → the day is finished; nothing more happens for it;
 *   morning-owed    → the 8 pm look found the track still racing (a session at or after 7:30 pm),
 *                     so the drivers it held back get their summary at 8 am the next day;
 *   morning-claimed → the tick handed that 8 am look to a worker.
 */
export type SweepTrackDayState = "evening-claimed" | "done" | "morning-owed" | "morning-claimed";

export type SweepTrackDayDoc = {
  v: typeof SWEEP_DOC_VERSION;
  ymd: string;
  state: SweepTrackDayState;
  claimedIso: string;
  /** Drivers already handed this day's summary, so the 8 am look does not send it again. */
  notifiedUserIds: string[];
};

export function trackDayDocKey(trackId: string): string {
  return `evening/${trackId}.json`;
}

export const EVENING_HOUR = 20;
export const MORNING_HOUR = 8;
/**
 * A look is due for the first thirty minutes after its hour. A five-minute cron lands inside that
 * six times, and the tick hands off a bounded number of tracks per landing (`runSweepTick`), so a
 * zone with more tracks than one tick takes still gets every one of them that half hour.
 */
export const SLOT_WINDOW_MINUTES = 30;
/**
 * Founder ruling 2026-09-16: 8 pm is the summary only if the driver has been off the track for
 * this long. A session at or after 7:30 pm means they are still racing — file it quietly, hold the
 * summary, and send the whole night at 8 am.
 */
export const QUIET_MINUTES = 30;

export function trackLocalYmd(timeZone: string, now: Date): string {
  return calendarYmdInTimeZone(now, timeZone);
}

/** The track-local day before the one `now` falls in. */
export function previousLocalYmd(timeZone: string, now: Date): string {
  const [y, m, d] = trackLocalYmd(timeZone, now).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1, 12)).toISOString().slice(0, 10);
}

/** Local hour and minute in a zone, on a 24-hour clock. */
export function localHourMinute(timeZone: string, now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
}

function slotWindowOpen(timeZone: string, now: Date, hour: number): boolean {
  const local = localHourMinute(timeZone, now);
  return local.hour === hour && local.minute < SLOT_WINDOW_MINUTES;
}

/** 20:00–20:29 track time: the 8 pm look is due. */
export function eveningWindowOpen(timeZone: string, now: Date): boolean {
  return slotWindowOpen(timeZone, now, EVENING_HOUR);
}

/** 08:00–08:29 track time: the 8 am look is due for a track that owes one. */
export function morningWindowOpen(timeZone: string, now: Date): boolean {
  return slotWindowOpen(timeZone, now, MORNING_HOUR);
}

/**
 * Was the driver still on track into the evening? True when their latest session of `ymd` (the
 * instant the timing site gave it) falls at or after 7:30 pm track time on that day. Null (no
 * session found) is "not racing".
 */
export function racedIntoTheEvening(latest: Date | null, timeZone: string, ymd: string): boolean {
  if (!latest) return false;
  if (trackLocalYmd(timeZone, latest) !== ymd) return false;
  const { hour, minute } = localHourMinute(timeZone, latest);
  return hour * 60 + minute >= EVENING_HOUR * 60 - QUIET_MINUTES;
}
