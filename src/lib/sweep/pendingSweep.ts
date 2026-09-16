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
  return p.count === 1 ? "1 session found · which car?" : `${p.count} sessions found · which car?`;
}
