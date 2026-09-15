import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { todayBoundsInTimeZone } from "@/lib/eventActive";

/**
 * The timing sweep's schedule, kept OUTSIDE Postgres so a quiet five-minute tick never wakes the
 * database. Two documents live in Blob storage (`blobStore.ts`):
 *
 *   plan.json          — rebuilt nightly: who is listening (paid, with a chip or a LiveRC name),
 *                        which tracks they race, each track's timing URLs and clock.
 *   armed/<trackId>    — a track someone is at TODAY: who armed it and how, what the poller has
 *                        already seen there, when it last looked, and any back-off.
 *
 * Everything in this file is pure so the rules are unit-tested; the DB is the truth for runs and
 * claims, these documents are only a schedule and may be lost without harm.
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
  /** Evening pass bookkeeping: track id → the track-local day it last ran for. */
  evening: Record<string, { doneYmd: string }>;
};

export type ArmedBy = "draft" | "run" | "app_open" | "chip";

/**
 * Who armed the track and how — with enough identity to poll for them even when the nightly
 * plan does not list them yet (a chip saved this afternoon, a first visit to a track).
 */
export type ArmedTrackUser = {
  armedBy: ArmedBy;
  armedAtIso: string;
  chips: string[];
  liveRcName: string | null;
};

/** The track facts a tick needs when the plan does not know the track (timing URL added today). */
export type ArmedTrackFacts = {
  name: string;
  speedhiveUrl: string | null;
  liveRcUrl: string | null;
  timeZone: string;
};

export type ArmedTrackDoc = {
  v: typeof SWEEP_DOC_VERSION;
  trackId: string;
  track: ArmedTrackFacts;
  /** Track-local midnight after the day it was armed; the doc is dead past this. */
  armedUntilIso: string;
  users: Record<string, ArmedTrackUser>;
  lastPolledIso: Record<SweepSource, string | null>;
  /** Session keys already handled (`user:activity:block`, `user:url`). Capped; oldest drop first. */
  seen: string[];
  backoff: { fails: number; nextTryIso: string | null };
  /** Track-local day a parser-suspect warning was already raised for. */
  parserSuspectYmd: string | null;
};

export const SPEEDHIVE_POLL_MS = 5 * 60 * 1000;
export const LIVERC_POLL_MS = 10 * 60 * 1000;
/** A cron that fires at :05 and :10 measures 4m59s between them; don't skip a tick over seconds. */
const DUE_SLACK_MS = 30 * 1000;
export const SEEN_CAP = 300;
export const EVENING_HOUR = 20;
export const EVENING_WINDOW_MINUTES = 10;

export function pollIntervalMs(source: SweepSource): number {
  return source === "speedhive" ? SPEEDHIVE_POLL_MS : LIVERC_POLL_MS;
}

export function trackLocalYmd(timeZone: string, now: Date): string {
  return calendarYmdInTimeZone(now, timeZone);
}

/** Track-local midnight at the end of the day `now` falls in. */
export function armedUntilForDay(timeZone: string, now: Date): Date {
  return todayBoundsInTimeZone(timeZone, now).end;
}

export function newArmedTrackDoc(track: { id: string } & ArmedTrackFacts, now: Date): ArmedTrackDoc {
  return {
    v: SWEEP_DOC_VERSION,
    trackId: track.id,
    track: {
      name: track.name,
      speedhiveUrl: track.speedhiveUrl,
      liveRcUrl: track.liveRcUrl,
      timeZone: track.timeZone,
    },
    armedUntilIso: armedUntilForDay(track.timeZone, now).toISOString(),
    users: {},
    lastPolledIso: { speedhive: null, liverc: null },
    seen: [],
    backoff: { fails: 0, nextTryIso: null },
    parserSuspectYmd: null,
  };
}

export function isArmedDocExpired(doc: Pick<ArmedTrackDoc, "armedUntilIso">, now: Date): boolean {
  const until = new Date(doc.armedUntilIso).getTime();
  return Number.isNaN(until) || until <= now.getTime();
}

export function isSourceDue(
  doc: Pick<ArmedTrackDoc, "armedUntilIso" | "lastPolledIso" | "backoff">,
  source: SweepSource,
  now: Date,
): boolean {
  if (isArmedDocExpired(doc, now)) return false;
  if (doc.backoff.nextTryIso && new Date(doc.backoff.nextTryIso).getTime() > now.getTime()) {
    return false;
  }
  const last = doc.lastPolledIso[source];
  if (!last) return true;
  const lastT = new Date(last).getTime();
  if (Number.isNaN(lastT)) return true;
  return now.getTime() - lastT >= pollIntervalMs(source) - DUE_SLACK_MS;
}

/** 5, 10, 20, 40, then 60 minutes — a rate-limited site is left alone, not hammered. */
export function backoffAfterFailure(
  prev: Pick<ArmedTrackDoc["backoff"], "fails">,
  now: Date,
): ArmedTrackDoc["backoff"] {
  const minutes = Math.min(60, 5 * 2 ** prev.fails);
  return { fails: prev.fails + 1, nextTryIso: new Date(now.getTime() + minutes * 60 * 1000).toISOString() };
}

export const NO_BACKOFF: ArmedTrackDoc["backoff"] = { fails: 0, nextTryIso: null };

export function rememberSeen(seen: string[], key: string): string[] {
  if (seen.includes(key)) return seen;
  const next = [...seen, key];
  return next.length > SEEN_CAP ? next.slice(next.length - SEEN_CAP) : next;
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

/**
 * The evening pass runs once per track per day, in the first ten minutes after 8 pm track time.
 * A five-minute cron lands inside that window at least once; `plan.evening` stops a second run.
 */
export function eveningWindowOpen(timeZone: string, now: Date): boolean {
  const { hour, minute } = localHourMinute(timeZone, now);
  return hour === EVENING_HOUR && minute < EVENING_WINDOW_MINUTES;
}

/**
 * The plan as a tick should see it for one armed track: the nightly plan plus whoever armed the
 * doc since, and the track's own facts when the plan has none. Pure.
 */
export function planViewForArmedDoc(
  plan: SweepPlanDoc,
  doc: ArmedTrackDoc,
): { users: Record<string, SweepPlanUser>; chips: Record<string, string[]>; track: SweepPlanTrack } {
  const users: Record<string, SweepPlanUser> = { ...plan.users };
  const chips: Record<string, string[]> = {};
  for (const [chip, ids] of Object.entries(plan.chips)) chips[chip] = [...ids];
  for (const [id, u] of Object.entries(doc.users)) {
    if (!users[id]) {
      users[id] = { id, email: null, timeZone: null, chips: u.chips, liveRcName: u.liveRcName, tier: "unknown" };
    }
    for (const chip of u.chips) {
      const ids = chips[chip] ?? [];
      if (!ids.includes(id)) ids.push(id);
      chips[chip] = ids;
    }
  }
  const planned = plan.tracks[doc.trackId];
  const track: SweepPlanTrack = planned ?? {
    id: doc.trackId,
    name: doc.track.name,
    speedhiveUrl: doc.track.speedhiveUrl,
    liveRcUrl: doc.track.liveRcUrl,
    timeZone: doc.track.timeZone,
    userIds: Object.keys(doc.users),
  };
  return { users, chips, track };
}
