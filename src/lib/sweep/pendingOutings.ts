import { groupOutings, type OutingSession } from "@/lib/runs/groupOutings";

/**
 * The runs the timing sheet holds that the driver did not log — as the sheet lists them and the
 * dashboard counts them. Founder ruling 2026-09-18: nothing files itself. The 8 pm look and
 * "Import your last runs" read the timing sites and keep what they find as LOOSE imports; the
 * driver ticks the ones they want in a sheet, and only a tick makes a run. So "pending" is every
 * loose session of the day, grouped into outings (one row per time on track, `groupOutings`),
 * minus the ones the driver already unticked (`detectionPromptDismissedAt`).
 *
 * Pure: the rows come in already read from the payloads (`getMyDay.ts` shapes them).
 */

export type PendingOutingSource = OutingSession & {
  /** The driver's own laps on this sheet, when the sheet names them. */
  ownLapCount: number | null;
  ownBestLapSeconds: number | null;
};

export type PendingOuting = {
  /** The primary session's id — what the sheet ticks and the log call names. */
  id: string;
  /** Primary first, then the sources that posted the same time on track. */
  sessionIds: string[];
  kind: "official" | "practice";
  start: Date;
  end: Date;
  lapCount: number | null;
  bestLapSeconds: number | null;
};

export function pendingOutingsFrom(sessions: readonly PendingOutingSource[]): PendingOuting[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return groupOutings(sessions).map((o) => {
    const members = o.sessionIds.map((id) => byId.get(id)!);
    const primary = byId.get(o.primaryId)!;
    // The official record's laps lead; a practice fragment of the same outing only fills a gap.
    const lapCount =
      primary.ownLapCount ??
      members.reduce<number | null>((max, m) => (m.ownLapCount != null && (max == null || m.ownLapCount > max) ? m.ownLapCount : max), null);
    const bestLapSeconds = members.reduce<number | null>(
      (min, m) =>
        m.ownBestLapSeconds != null && m.ownBestLapSeconds > 0 && (min == null || m.ownBestLapSeconds < min)
          ? m.ownBestLapSeconds
          : min,
      null,
    );
    return {
      id: o.primaryId,
      sessionIds: [...o.sessionIds],
      kind: o.kind,
      start: o.start,
      end: o.end,
      lapCount,
      bestLapSeconds,
    };
  });
}

/** Which of the day's pending outings the driver ticked or unticked, from the ids the sheet sent. */
export function splitChosen(
  pending: readonly PendingOuting[],
  keepIds: readonly string[],
  declineIds: readonly string[],
): { keep: PendingOuting[]; decline: PendingOuting[] } {
  const keep = new Set(keepIds);
  const decline = new Set(declineIds);
  return {
    keep: pending.filter((o) => keep.has(o.id)),
    // A row both ticked and unticked is ticked: losing a run the driver wanted is the worse slip.
    decline: pending.filter((o) => decline.has(o.id) && !keep.has(o.id)),
  };
}
