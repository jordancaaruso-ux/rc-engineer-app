import {
  runLocalDayKey,
  runSessionSortInstant,
  trackKey,
  type RunForHistoryGroup,
  type RunGroupZoneOptions,
} from "@/lib/runs/buildRunHistoryGroups";

/**
 * What a debrief hangs off: the meeting, as the Sessions list already defines it.
 *
 * `meetingKey` is the group id verbatim (`event-<id>` or `day-<yyyy-mm-dd>-name:<track>`) and
 * is the unique key. The other three are the same identity spelled out, stored so a note can
 * still be found when its group changes key — an eventless test day whose runs later join an
 * event flips from `day-…` to `event-…`, and the note written under the old key must come with
 * it. `loadDebrief` reads all three in that order of trust.
 *
 * Pure: no Prisma, no dates in the reader's zone. The day is the DRIVER's day
 * (`runLocalDayKey`), the instant is `sortAt` first, exactly as grouping does — otherwise the
 * note and the day it was written about could disagree by one midnight.
 */
export type DebriefIdentity = {
  meetingKey: string;
  eventId: string | null;
  localDayKey: string;
  trackKey: string;
};

const EVENT_KEY_PREFIX = "event-";
const EVENT_KEY = /^event-[A-Za-z0-9_-]{1,64}$/;
const DAY_KEY = /^day-\d{4}-\d{2}-\d{2}-(?:name:.{1,200}|no-track)$/;
const LOCAL_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TRACK_KEY = /^(?:name:.{1,200}|no-track)$/;

/** Longest note the API accepts — a weekend's worth of thoughts, not a document. */
export const DEBRIEF_TEXT_MAX_LENGTH = 20_000;

export function isValidMeetingKey(value: unknown): value is string {
  return typeof value === "string" && (EVENT_KEY.test(value) || DAY_KEY.test(value));
}

export function isValidLocalDayKey(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DAY_KEY.test(value);
}

export function isValidTrackKey(value: unknown): value is string {
  return typeof value === "string" && TRACK_KEY.test(value);
}

/** The event an `event-<id>` meeting key names; null for a day key. Never trusted from a body. */
export function eventIdFromMeetingKey(meetingKey: string): string | null {
  return meetingKey.startsWith(EVENT_KEY_PREFIX) ? meetingKey.slice(EVENT_KEY_PREFIX.length) : null;
}

/**
 * The identity of one Sessions group. `runs` may be in any order; the day and track are read
 * off the EARLIEST run, so a two-day event keys on its first day whichever run was listed first.
 * Null for a group with no runs — there is nothing for a debrief to hang off.
 */
export function debriefIdentityForGroup(
  group: { id: string; runs: readonly RunForHistoryGroup[] },
  zones?: RunGroupZoneOptions
): DebriefIdentity | null {
  if (group.runs.length === 0) return null;
  const earliest = group.runs.reduce((a, b) =>
    runSessionSortInstant(b).getTime() < runSessionSortInstant(a).getTime() ? b : a
  );
  return {
    meetingKey: group.id,
    eventId: eventIdFromMeetingKey(group.id),
    localDayKey: runLocalDayKey(earliest, zones),
    trackKey: trackKey(earliest),
  };
}

/**
 * The text as stored: unix newlines, trimmed, and null when there is nothing left — an empty
 * box deletes the row rather than saving a blank one.
 */
export function normalizeDebriefText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  return text.length > 0 ? text : null;
}
