import type { LapRow } from "@/lib/lapAnalysis";
import { getIncludedLaps, getBestLap, importedSetToLapRows } from "@/lib/lapAnalysis";
import { mergeImportedLapSetsByDriver } from "@/lib/lapImport/mergeImportedLapSets";

export type FieldImportDriverInput = {
  driverName: string;
  displayName?: string | null;
  isPrimaryUser?: boolean;
  laps: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
};

export type FieldImportDriverRow = {
  label: string;
  isPrimaryUser: boolean;
  rank: number;
  bestLapSeconds: number | null;
  gapToSessionBestSeconds: number | null;
  /** Mean(second half) − mean(first half) of included laps (chronological); positive ⇒ slower late in run. */
  fadeSeconds: number | null;
};

export type FieldImportSession = {
  driverCount: number;
  sessionBestLapSeconds: number | null;
  ranked: FieldImportDriverRow[];
};

/**
 * Mean lap time of the first vs second half of the stint (included laps only, by lap number).
 * Requires at least 4 included laps.
 */
export function computeStintFadeSeconds(rows: LapRow[]): number | null {
  const inc = getIncludedLaps(rows).sort((a, b) => a.lapNumber - b.lapNumber);
  if (inc.length < 4) return null;
  const mid = Math.floor(inc.length / 2);
  const first = inc.slice(0, mid);
  const second = inc.slice(mid);
  const mean = (xs: LapRow[]) =>
    xs.length === 0 ? null : xs.reduce((s, x) => s + x.lapTimeSeconds, 0) / xs.length;
  const m1 = mean(first);
  const m2 = mean(second);
  if (m1 == null || m2 == null) return null;
  return m2 - m1;
}

function labelForDriver(d: FieldImportDriverInput): string {
  const t = (d.displayName?.trim() || d.driverName || "").trim();
  return t || "Driver";
}

/**
 * Field ranking from the imported lap sets on one run.
 *
 * A run may hold more than one timing import — a session split by a quick break
 * comes back as two — and each import stores its own set per driver. Those are
 * joined by driver first, or every rival would be ranked twice on half a stint
 * each, and the fade figure would read the first half's decline as the whole
 * run's. Returns null when fewer than two *drivers* — no field comparison.
 */
export function computeFieldImportSessionFromSets(
  sets: FieldImportDriverInput[] | null | undefined
): FieldImportSession | null {
  if (!sets || sets.length < 2) return null;
  const merged = mergeImportedLapSetsByDriver(
    sets.map((s) => ({
      ...s,
      isPrimaryUser: Boolean(s.isPrimaryUser),
      laps: s.laps.map((l) => ({
        lapNumber: l.lapNumber,
        lapTimeSeconds: l.lapTimeSeconds,
        isIncluded: l.isIncluded !== false,
      })),
    }))
  );
  if (merged.length < 2) return null;

  type Work = {
    label: string;
    isPrimaryUser: boolean;
    best: number | null;
    fade: number | null;
  };

  const work: Work[] = [];
  for (const s of merged) {
    const rows = importedSetToLapRows(s.laps);
    work.push({
      label: labelForDriver(s),
      isPrimaryUser: Boolean(s.isPrimaryUser),
      best: getBestLap(rows),
      fade: computeStintFadeSeconds(rows),
    });
  }

  const finiteBests = work.map((w) => w.best).filter((x): x is number => x != null && Number.isFinite(x));
  const sessionBest = finiteBests.length ? Math.min(...finiteBests) : null;

  const sorted = [...work].sort((a, b) => {
    const ab = a.best;
    const bb = b.best;
    if (ab == null && bb == null) return a.label.localeCompare(b.label);
    if (ab == null) return 1;
    if (bb == null) return -1;
    if (ab !== bb) return ab - bb;
    return a.label.localeCompare(b.label);
  });

  let pos = 1;
  const ranked: FieldImportDriverRow[] = sorted.map((w, i) => {
    if (i > 0) {
      const prevBest = sorted[i - 1]!.best;
      const curBest = w.best;
      if (prevBest !== curBest) {
        pos = i + 1;
      }
    }
    const gap =
      sessionBest != null && w.best != null && Number.isFinite(w.best)
        ? w.best - sessionBest
        : null;
    return {
      label: w.label,
      isPrimaryUser: w.isPrimaryUser,
      rank: pos,
      bestLapSeconds: w.best,
      gapToSessionBestSeconds: gap,
      fadeSeconds: w.fade,
    };
  });

  return {
    driverCount: ranked.length,
    sessionBestLapSeconds: sessionBest,
    ranked,
  };
}
