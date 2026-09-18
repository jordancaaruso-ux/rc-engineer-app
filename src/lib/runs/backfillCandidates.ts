import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { isWallClockAsUtcTimingSource, type LapTimingSource } from "@/lib/lapImport/labels";
import { isUtcOffsetMinutes, trackClockTime } from "@/lib/lapImport/trackClock";
import { groupOutings, type OutingSession } from "@/lib/runs/groupOutings";
import {
  estimateDurationSeconds,
  outingKindFor,
  sameTimeOnTrack,
  spanFrom,
  timeAnchorFor,
  type Span,
} from "@/lib/runs/outingSpan";

/**
 * One of the day's other timing sessions the driver can have filed as a run beside the one they
 * are logging ("Add N other runs from today", lap step). Carries the import id when this account
 * already holds the parse, so the save can skip the trip to the timing site for it.
 */
export type BackfillCandidate = {
  sessionUrl: string;
  importedSessionId: string | null;
  sessionCompletedAtIso: string;
  timingSource: LapTimingSource | null;
  /** Speedhive practice: the track's offset from UTC, so the session reads on the track's clock. */
  sessionUtcOffsetMinutes?: number | null;
};

/**
 * The offer as the form holds it: every session the scan found for the day, whether the driver
 * said yes, and the ones they unticked in the sheet. `sessions` is re-mirrored from the scan while
 * the step is open, so the driver's choice is kept as EXCLUSIONS — a session the next scan adds is
 * in by default, the way the whole offer is.
 */
export type BackfillOffer = {
  ticked: boolean;
  sessions: BackfillCandidate[];
  excludedUrls?: string[] | null;
};

/** The sessions the driver wants filed, ignoring whether the line is ticked — the label counts these. */
export function chosenBackfillSessions<T extends { sessionUrl: string }>(
  offer: { sessions: readonly T[]; excludedUrls?: readonly string[] | null } | null | undefined
): T[] {
  if (!offer) return [];
  const excluded = new Set((offer.excludedUrls ?? []).map((u) => u.trim()));
  if (excluded.size === 0) return [...offer.sessions];
  return offer.sessions.filter((s) => !excluded.has(s.sessionUrl.trim()));
}

/** What the picker already knows about a session before it is imported. */
export type BackfillCandidateMeta = { lapCount: number | null; bestLapSeconds: number | null };

/** One row of the offer sheet: one time on track, however many timing sessions posted it. */
export type BackfillOuting = { primaryUrl: string; sessionUrls: string[] };

/**
 * The offer as outings, so the sheet and its count say "3 other runs" when the timing sites
 * posted five sessions for three times on track (founder ruling 2026-09-15, one run per time on
 * track). Same rule the save applies with the real payloads (`createBackfilledRuns`); here the
 * window is estimated from lap count × best lap, and a session the scan knows nothing about is a
 * point in time. The offer's `sessions` stay the raw list — the save needs every id to link the
 * extras to the run it makes.
 *
 * Judged on the track's clock (`lapImport/trackClock.ts`), so where the phone is does not matter.
 * `fallbackTimeZone` only reads a practice session that came without the track's offset.
 */
export function groupBackfillCandidates(
  sessions: readonly BackfillCandidate[],
  metaFor: (sessionUrl: string) => BackfillCandidateMeta | null,
  fallbackTimeZone: string | null
): BackfillOuting[] {
  const outingSessions: OutingSession[] = [];
  for (const s of sessions) {
    const meta = metaFor(s.sessionUrl);
    const span = backfillCandidateSpan(s, meta, fallbackTimeZone);
    if (!span) continue;
    outingSessions.push({
      id: s.sessionUrl,
      kind: outingKindFor(null, s.sessionUrl),
      ...span,
      driverCount: 0,
      lapCount: meta?.lapCount ?? 0,
    });
  }
  return groupOutings(outingSessions).map((o) => ({ primaryUrl: o.primaryId, sessionUrls: o.sessionIds }));
}

/**
 * A scanned session's window on the track's clock, as the sheet can estimate it before import:
 * lap count × best lap, else a point in time. Null when the scan gave no usable time.
 */
export function backfillCandidateSpan(
  s: BackfillCandidate,
  meta: BackfillCandidateMeta | null,
  fallbackTimeZone: string | null
): Span | null {
  const onTrack = trackClockTime({
    iso: s.sessionCompletedAtIso,
    timingSource: s.timingSource,
    sourceUrl: s.sessionUrl,
    utcOffsetMinutes: s.sessionUtcOffsetMinutes,
    fallbackTimeZone,
  });
  if (!onTrack) return null;
  const duration = estimateDurationSeconds(meta?.lapCount, meta?.bestLapSeconds) ?? 0;
  return spanFrom(onTrack, duration, timeAnchorFor(null, s.sessionUrl));
}

/**
 * The offer without the sessions that ARE the run being logged: the same race posted by a second
 * timing site is not another run from the day. Offered, it made the sheet say "Log them as 3 runs"
 * and the save make 2 (the server links it onto this run instead). Only a window the scan can
 * measure is judged — a session with no known laps stays in, and the save still links it if it
 * turns out to be the same race. `runSpans` are on the track's clock (`blockOutingSpan`).
 */
export function withoutRunsOwnOutings(
  sessions: readonly BackfillCandidate[],
  metaFor: (sessionUrl: string) => BackfillCandidateMeta | null,
  fallbackTimeZone: string | null,
  runSpans: readonly Span[]
): BackfillCandidate[] {
  if (runSpans.length === 0) return [...sessions];
  return sessions.filter((s) => {
    const span = backfillCandidateSpan(s, metaFor(s.sessionUrl), fallbackTimeZone);
    return !span || !runSpans.some((own) => sameTimeOnTrack(own, span));
  });
}

export type BackfillCandidateRow = {
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  timingSource?: LapTimingSource | null;
  /** Speedhive practice: the track's offset from UTC (see `BackfillCandidate`). */
  sessionUtcOffsetMinutes?: number | null;
  /** Set when this account already holds the parse (the "already imported" list). */
  importedSessionId?: string | null;
  /** A session already filed under a run is never offered — it has one. */
  linkedRunId?: string | null;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The calendar day a timing session belongs to at the track, as YYYY-MM-DD.
 *
 * LiveRC, MyRCM and Speedhive's race results publish the track's wall clock and the parsers store
 * it as-if-UTC, so its UTC date IS the track's date. Speedhive's practice loop publishes real
 * instants with the track's offset beside them, which date exactly. Only a real instant that came
 * without its offset needs a zone — the driver's, or the device's when none is known.
 */
export function timingSessionDayKey(
  iso: string,
  source: LapTimingSource | null | undefined,
  timeZone: string | null,
  session?: { sessionUrl?: string | null; sessionUtcOffsetMinutes?: number | null } | null
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (isWallClockAsUtcTimingSource(source, { sourceUrl: session?.sessionUrl })) {
    return d.toISOString().slice(0, 10);
  }
  const offset = session?.sessionUtcOffsetMinutes;
  if (isUtcOffsetMinutes(offset)) return new Date(d.getTime() + offset * 60_000).toISOString().slice(0, 10);
  if (timeZone) return calendarYmdInTimeZone(d, timeZone);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Which of the scanned sessions can be filed beside the picked one.
 *
 * Same day at the track as the picked session (earlier AND later — logging run 4 late still fills
 * in 5 and 6), not already on this run, not already on any run, and each URL once, preferring the
 * copy that carries an import id. Sorted earliest first on the track's clock so the count reads in
 * the day's order. `timeZone` only dates a real instant that came without the track's offset.
 */
export function selectBackfillCandidates(input: {
  picked: {
    sessionUrl: string;
    sessionCompletedAtIso: string | null;
    timingSource: LapTimingSource | null;
    sessionUtcOffsetMinutes?: number | null;
  } | null;
  rows: readonly BackfillCandidateRow[];
  attachedUrls: ReadonlySet<string>;
  timeZone: string | null;
}): { dayKey: string; sessions: BackfillCandidate[] } | null {
  const picked = input.picked;
  if (!picked || !picked.sessionCompletedAtIso) return null;
  const dayKey = timingSessionDayKey(picked.sessionCompletedAtIso, picked.timingSource, input.timeZone, picked);
  if (!dayKey) return null;
  const pickedUrl = picked.sessionUrl.trim();

  const byUrl = new Map<string, BackfillCandidate>();
  for (const row of input.rows) {
    const url = row.sessionUrl?.trim() ?? "";
    if (!url || url === pickedUrl || input.attachedUrls.has(url)) continue;
    if (row.linkedRunId) continue;
    const iso = row.sessionCompletedAtIso?.trim();
    if (!iso) continue;
    const source = row.timingSource ?? null;
    if (timingSessionDayKey(iso, source, input.timeZone, row) !== dayKey) continue;
    const importedSessionId = row.importedSessionId?.trim() || null;
    const existing = byUrl.get(url);
    if (existing && (existing.importedSessionId || !importedSessionId)) continue;
    byUrl.set(url, {
      sessionUrl: url,
      importedSessionId,
      sessionCompletedAtIso: iso,
      timingSource: source,
      sessionUtcOffsetMinutes: row.sessionUtcOffsetMinutes ?? null,
    });
  }

  const onTrackMs = (s: BackfillCandidate) =>
    (
      trackClockTime({
        iso: s.sessionCompletedAtIso,
        timingSource: s.timingSource,
        sourceUrl: s.sessionUrl,
        utcOffsetMinutes: s.sessionUtcOffsetMinutes,
        fallbackTimeZone: input.timeZone,
      }) ?? new Date(s.sessionCompletedAtIso)
    ).getTime();
  const sessions = [...byUrl.values()].sort((a, b) => onTrackMs(a) - onTrackMs(b));
  return { dayKey, sessions };
}
