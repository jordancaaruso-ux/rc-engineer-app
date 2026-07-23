/**
 * Tire indicator for run lists (Sessions rows + Analysis recent runs): which
 * set a run went out on, how many runs that set has done (its wear at a
 * glance — "1" reads as new tires), and whether the set differs from the
 * previous run on the same car that also had a logged set. Runs without a
 * tire set carry no signal — they are skipped rather than treated as a change.
 * Keep this file Prisma-free; it runs client-side and in offline tests.
 */

import { formatMark } from "@/lib/tires/tireMark";

export type TireIndicatorSourceRun = {
  id: string;
  carId: string | null;
  /** Nth run on the set as logged on the run (wear counter). */
  tireRunNumber?: number | null;
  tireSet?: { id: string; label: string; mark?: string | null } | null;
};

export type RunTireIndicator = {
  setLabel: string;
  /** Runs this set has done as of this run; null when the run predates the counter. */
  runNumber: number | null;
  /** True when the set differs from the previous same-car run with a logged set. */
  changed: boolean;
  /** The set it replaced; only set when `changed`. */
  previousSetLabel: string | null;
};

/** runId → indicator for every run with a car + logged set, from a newest-first list (cars may be mixed). */
export function computeTireIndicatorsByRunId(
  runsDescending: TireIndicatorSourceRun[]
): Map<string, RunTireIndicator> {
  const indicators = new Map<string, RunTireIndicator>();
  const lastSetByCar = new Map<string, { id: string; label: string }>();
  for (let i = runsDescending.length - 1; i >= 0; i--) {
    const run = runsDescending[i];
    if (!run.carId || !run.tireSet) continue;
    // A physical mark ("Marked 7") is the real-world identity; unmarked sets fall back to the compound label.
    const label = formatMark(run.tireSet.mark) ?? run.tireSet.label;
    const prev = lastSetByCar.get(run.carId);
    const changed = prev != null && prev.id !== run.tireSet.id;
    indicators.set(run.id, {
      setLabel: label,
      runNumber:
        typeof run.tireRunNumber === "number" && run.tireRunNumber > 0
          ? run.tireRunNumber
          : null,
      changed,
      previousSetLabel: changed ? prev.label : null,
    });
    lastSetByCar.set(run.carId, { id: run.tireSet.id, label });
  }
  return indicators;
}

export function formatTireIndicatorTitle(indicator: RunTireIndicator): string {
  const wear =
    indicator.runNumber != null
      ? ` · run ${indicator.runNumber}${indicator.runNumber === 1 ? " (new)" : ""}`
      : "";
  if (indicator.changed && indicator.previousSetLabel) {
    return `Tire set changed · ${indicator.previousSetLabel} → ${indicator.setLabel}${wear}`;
  }
  return `${indicator.setLabel}${wear}`;
}
