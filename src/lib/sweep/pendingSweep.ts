/**
 * What the dashboard offers beside "Start a run" when the timing sweep left something for the
 * driver today: a placeholder run to fill in, or sessions that still need a car.
 */
export type DashboardPendingSweep =
  | { kind: "placeholder"; runId: string; position: number }
  | { kind: "loose"; importedLapTimeSessionId: string; count: number };

export function pendingSweepHref(p: DashboardPendingSweep): string {
  if (p.kind === "placeholder") {
    return `/runs/${encodeURIComponent(p.runId)}/edit?back=${encodeURIComponent(
      `/runs/history?openGroup=${p.runId}&level=day`,
    )}`;
  }
  return `/runs/new?importedLapTimeSessionId=${encodeURIComponent(p.importedLapTimeSessionId)}`;
}

export function pendingSweepLabel(p: DashboardPendingSweep): string {
  if (p.kind === "placeholder") return `Fill in run ${p.position}`;
  return p.count === 1 ? "1 session found · which car?" : `${p.count} sessions found · which car?`;
}
