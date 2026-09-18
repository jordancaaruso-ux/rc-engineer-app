/**
 * What the dashboard offers beside "Start a run" when a read of the timing sites left runs the
 * driver did not log: one row, "N runs you didn't log", opening the sheet that lists them.
 * Nothing files itself (founder ruling 2026-09-18) — the row is the door, the tick is the act.
 */
export type DashboardPendingSweep = {
  kind: "unlogged";
  importedLapTimeSessionId: string;
  /** Times on track, not sessions: the same heat from two sites is one. */
  count: number;
  /** The track and day the sheet lists; null track → no sheet to open. */
  trackId?: string | null;
  ymd?: string | null;
};

/**
 * The sheet opens over the dashboard on this flag (`UnloggedRunsSheet`); ticking files that day's
 * chosen runs and lands on the day. Without a track there is nothing to list, so that session
 * keeps the old route: the log-run page with its laps attached (`wizard=1`).
 */
export function unloggedSheetHref(trackId: string, ymd: string): string {
  return `/?unlogged=${encodeURIComponent(trackId)}&ymd=${encodeURIComponent(ymd)}`;
}

export function pendingSweepHref(p: DashboardPendingSweep): string {
  if (p.trackId && p.ymd) return unloggedSheetHref(p.trackId, p.ymd);
  return `/runs/new?importedLapTimeSessionId=${encodeURIComponent(p.importedLapTimeSessionId)}&wizard=1`;
}

export function pendingSweepLabel(p: DashboardPendingSweep): string {
  if (p.trackId && p.ymd) return p.count === 1 ? "1 run you didn't log" : `${p.count} runs you didn't log`;
  return p.count === 1 ? "1 session found" : `${p.count} sessions found`;
}

/** One time on track the app imported onto no run, with the track-local day it ran on when known. */
export type LooseImportForPending = { id: string; trackId: string | null; ymd: string | null };

/**
 * The dashboard's row from the loose outings filed today. The question is about the day the
 * sessions RAN, not today: an import of last weekend asked about today, found nothing waiting, and
 * the sheet shut the moment it opened (2026-09-16). One track and day at a time, oldest first —
 * dealing with it clears that day, and the next day's row takes its place.
 */
export function pendingLooseFromImports(rows: readonly LooseImportForPending[]): DashboardPendingSweep | null {
  const askable = rows.find((r) => r.trackId && r.ymd);
  if (askable) {
    const sameDay = rows.filter((r) => r.trackId === askable.trackId && r.ymd === askable.ymd);
    return {
      kind: "unlogged",
      importedLapTimeSessionId: askable.id,
      count: sameDay.length,
      trackId: askable.trackId,
      ymd: askable.ymd,
    };
  }
  const first = rows[0];
  if (!first) return null;
  return { kind: "unlogged", importedLapTimeSessionId: first.id, count: rows.length, trackId: null, ymd: null };
}
