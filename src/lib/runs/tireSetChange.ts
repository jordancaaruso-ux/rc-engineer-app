/**
 * Tire indicator for run lists (Sessions rows + Analysis recent runs): what
 * compound a run went out on, how many runs were on that rubber (its wear at a
 * glance — "1" reads as new tires), and whether the tires differ from the
 * previous run on the same car.
 *
 * Identity is the *stint* — one continuous life of rubber — not a named set.
 * Runs with no compound carry no signal; they are skipped rather than treated
 * as a change. Keep this file Prisma-free; it runs client-side and in offline tests.
 */

export type TireIndicatorSourceRun = {
  id: string;
  carId: string | null;
  /** Nth run on this rubber as logged on the run (wear counter). */
  tireRunNumber?: number | null;
  /** Groups runs sharing one life of rubber. Null on runs logged before the counter. */
  tireStintId?: string | null;
  /** False when the driver said "not sure how many runs" — the count is relative. */
  tireAgeKnown?: boolean | null;
  tireType?: { id: string; displayName: string } | null;
};

export type RunTireIndicator = {
  /** Compound name, e.g. "Sweep D32 32R". */
  tireLabel: string;
  /** Runs on this rubber as of this run; null when the run predates the counter. */
  runNumber: number | null;
  /** False when the driver didn't know the tires' age — the count is relative. */
  ageKnown: boolean;
  /** True when the rubber differs from the previous same-car run that logged tires. */
  changed: boolean;
  /** The compound it replaced; only set when `changed`. */
  previousTireLabel: string | null;
};

/** runId → indicator for every run with a car + logged compound, from a newest-first list (cars may be mixed). */
export function computeTireIndicatorsByRunId(
  runsDescending: TireIndicatorSourceRun[]
): Map<string, RunTireIndicator> {
  const indicators = new Map<string, RunTireIndicator>();
  const lastByCar = new Map<string, { stintId: string | null; label: string }>();
  for (let i = runsDescending.length - 1; i >= 0; i--) {
    const run = runsDescending[i];
    if (!run.carId || !run.tireType) continue;
    const label = run.tireType.displayName;
    const stintId = run.tireStintId ?? null;
    const prev = lastByCar.get(run.carId);
    // A different stint is different rubber. Two runs both missing a stint id are
    // legacy rows — treat them as continuous rather than manufacturing a change.
    const changed =
      prev != null && (stintId != null || prev.stintId != null) && prev.stintId !== stintId;
    indicators.set(run.id, {
      tireLabel: label,
      runNumber:
        typeof run.tireRunNumber === "number" && run.tireRunNumber > 0
          ? run.tireRunNumber
          : null,
      ageKnown: run.tireAgeKnown !== false,
      changed,
      previousTireLabel: changed ? prev.label : null,
    });
    lastByCar.set(run.carId, { stintId, label });
  }
  return indicators;
}

/** " · run 3", " · run 1 (new)", " · run 3 (age unknown)", or "" when nothing is known. */
function formatTireWearSuffix(indicator: RunTireIndicator): string {
  if (indicator.runNumber != null) {
    let wear = ` · run ${indicator.runNumber}`;
    if (!indicator.ageKnown) wear += " (age unknown)";
    else if (indicator.runNumber === 1) wear += " (new)";
    return wear;
  }
  return indicator.ageKnown ? "" : " · age unknown";
}

/**
 * Compound + wear, the one phrasing used wherever tires are named on screen —
 * "Sweep D32 32R · run 3". No changed-from: that belongs in the icon's tooltip,
 * where the bright/faint ring is already making the same point.
 */
export function formatTireIdentityLine(indicator: RunTireIndicator): string {
  return `${indicator.tireLabel}${formatTireWearSuffix(indicator)}`;
}

export function formatTireIndicatorTitle(indicator: RunTireIndicator): string {
  const wear = formatTireWearSuffix(indicator);
  if (indicator.changed && indicator.previousTireLabel) {
    return `Tires changed · ${indicator.previousTireLabel} → ${indicator.tireLabel}${wear}`;
  }
  return `${indicator.tireLabel}${wear}`;
}
