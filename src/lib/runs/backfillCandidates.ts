import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { isWallClockAsUtcTimingSource, type LapTimingSource } from "@/lib/lapImport/labels";
import { groupOutings, type OutingSession } from "@/lib/runs/groupOutings";
import { estimateDurationSeconds, outingKindFor, spanFrom, timeAnchorFor } from "@/lib/runs/outingSpan";

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
 */
export function groupBackfillCandidates(
  sessions: readonly BackfillCandidate[],
  metaFor: (sessionUrl: string) => BackfillCandidateMeta | null,
  timeZone: string | null
): BackfillOuting[] {
  const outingSessions: OutingSession[] = [];
  for (const s of sessions) {
    const raw = new Date(s.sessionCompletedAtIso);
    if (Number.isNaN(raw.getTime())) continue;
    const instant =
      isWallClockAsUtcTimingSource(s.timingSource) && timeZone ? wallClockAsUtcToInstant(raw, timeZone) : raw;
    const meta = metaFor(s.sessionUrl);
    const duration = estimateDurationSeconds(meta?.lapCount, meta?.bestLapSeconds) ?? 0;
    outingSessions.push({
      id: s.sessionUrl,
      kind: outingKindFor(null, s.sessionUrl),
      ...spanFrom(instant, duration, timeAnchorFor(null, s.sessionUrl)),
      driverCount: 0,
      lapCount: meta?.lapCount ?? 0,
    });
  }
  return groupOutings(outingSessions).map((o) => ({ primaryUrl: o.primaryId, sessionUrls: o.sessionIds }));
}

export type BackfillCandidateRow = {
  sessionUrl: string;
  sessionCompletedAtIso: string | null;
  timingSource?: LapTimingSource | null;
  /** Set when this account already holds the parse (the "already imported" list). */
  importedSessionId?: string | null;
  /** A session already filed under a run is never offered — it has one. */
  linkedRunId?: string | null;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The calendar day a timing session belongs to, as YYYY-MM-DD.
 *
 * Two clocks, on purpose: LiveRC and MyRCM publish the track's wall clock and the parsers store
 * it as-if-UTC, so its UTC date IS the track's date. Speedhive publishes real instants, which
 * only become a date in a zone — the driver's, or the device's when none is known.
 */
export function timingSessionDayKey(
  iso: string,
  source: LapTimingSource | null | undefined,
  timeZone: string | null
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (isWallClockAsUtcTimingSource(source)) return d.toISOString().slice(0, 10);
  if (timeZone) return calendarYmdInTimeZone(d, timeZone);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Which of the scanned sessions can be filed beside the picked one.
 *
 * Same day as the picked session (earlier AND later — logging run 4 late still fills in 5 and 6),
 * not already on this run, not already on any run, and each URL once, preferring the copy that
 * carries an import id. Sorted earliest first so the count reads in the day's order.
 */
export function selectBackfillCandidates(input: {
  picked: {
    sessionUrl: string;
    sessionCompletedAtIso: string | null;
    timingSource: LapTimingSource | null;
  } | null;
  rows: readonly BackfillCandidateRow[];
  attachedUrls: ReadonlySet<string>;
  timeZone: string | null;
}): { dayKey: string; sessions: BackfillCandidate[] } | null {
  const picked = input.picked;
  if (!picked || !picked.sessionCompletedAtIso) return null;
  const dayKey = timingSessionDayKey(picked.sessionCompletedAtIso, picked.timingSource, input.timeZone);
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
    if (timingSessionDayKey(iso, source, input.timeZone) !== dayKey) continue;
    const importedSessionId = row.importedSessionId?.trim() || null;
    const existing = byUrl.get(url);
    if (existing && (existing.importedSessionId || !importedSessionId)) continue;
    byUrl.set(url, { sessionUrl: url, importedSessionId, sessionCompletedAtIso: iso, timingSource: source });
  }

  const sessions = [...byUrl.values()].sort(
    (a, b) => new Date(a.sessionCompletedAtIso).getTime() - new Date(b.sessionCompletedAtIso).getTime()
  );
  return { dayKey, sessions };
}
