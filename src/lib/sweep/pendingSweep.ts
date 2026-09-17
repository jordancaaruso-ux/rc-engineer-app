/**
 * What the dashboard offers beside "Start a run" when the timing sweep left something for the
 * driver today: a placeholder run to fill in, or sessions that still need a car.
 */
export type DashboardPendingSweep =
  | { kind: "placeholder"; runId: string; position: number }
  | {
      kind: "loose";
      importedLapTimeSessionId: string;
      count: number;
      /** The track and day the "Which car?" sheet asks about; null track → no sheet to open. */
      trackId?: string | null;
      ymd?: string | null;
    };

/**
 * Asking which car is one question, so it is asked in a sheet, not a form (founder, 2026-09-16 —
 * he tapped through and landed in the whole log-run page). The flag opens `WhichCarSheet` over the
 * dashboard; answering it files every one of that day's sessions and lands on the day.
 *
 * Without a track there is nothing to ask about, so that session keeps the old route: the log-run
 * page with its laps attached (`wizard=1` — the walk, not the scrolling form).
 */
export function whichCarSheetHref(trackId: string, ymd: string): string {
  return `/?whichCar=${encodeURIComponent(trackId)}&ymd=${encodeURIComponent(ymd)}`;
}

export function pendingSweepHref(p: DashboardPendingSweep): string {
  if (p.kind === "placeholder") {
    return `/runs/${encodeURIComponent(p.runId)}/edit?back=${encodeURIComponent(
      `/runs/history?openGroup=${p.runId}&level=day`,
    )}`;
  }
  if (p.trackId && p.ymd) return whichCarSheetHref(p.trackId, p.ymd);
  return `/runs/new?importedLapTimeSessionId=${encodeURIComponent(p.importedLapTimeSessionId)}&wizard=1`;
}

export function pendingSweepLabel(p: DashboardPendingSweep): string {
  if (p.kind === "placeholder") return `Fill in run ${p.position}`;
  const found = p.count === 1 ? "1 session found" : `${p.count} sessions found`;
  // Only a session the sheet can ask about is a car question; one with no track or no time on
  // track opens by hand, and "which car?" there was a promise the tap could not keep.
  return p.trackId && p.ymd ? `${found} · which car?` : found;
}

/** A session the sweep imported onto no run, with the track-local day it ran on when that is known. */
export type LooseImportForPending = { id: string; trackId: string | null; ymd: string | null };

/**
 * The dashboard's "which car?" row from the loose sessions filed today. The question is about the
 * day the sessions RAN, not today: an import of last weekend asked about today, found nothing
 * waiting, and the sheet shut the moment it opened (2026-09-16). One track and day at a time,
 * oldest first — answering it files that day, and the next day's row takes its place.
 */
export function pendingLooseFromImports(rows: readonly LooseImportForPending[]): DashboardPendingSweep | null {
  const askable = rows.find((r) => r.trackId && r.ymd);
  if (askable) {
    const sameDay = rows.filter((r) => r.trackId === askable.trackId && r.ymd === askable.ymd);
    return {
      kind: "loose",
      importedLapTimeSessionId: askable.id,
      count: sameDay.length,
      trackId: askable.trackId,
      ymd: askable.ymd,
    };
  }
  const first = rows[0];
  if (!first) return null;
  return { kind: "loose", importedLapTimeSessionId: first.id, count: rows.length, trackId: null, ymd: null };
}
