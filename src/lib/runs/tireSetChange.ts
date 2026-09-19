/**
 * Tire indicator for run lists (Sessions rows + Analysis recent runs): what
 * compound a run went out on, how many runs were on that rubber (its wear at a
 * glance — "1" reads as new tires), and whether the tires differ from the
 * previous run on the same car.
 *
 * Identity is the *stint* — one continuous life of rubber — not a named set.
 * Runs with no compound carry no signal; they are skipped rather than treated
 * as a change. Keep this file Prisma-free; it runs client-side and in offline tests.
 *
 * FRONT AND REAR (2026-09-19). An off-road run carries two tires, each with its own life of
 * rubber. The un-prefixed fields are then the REAR and `front*` the other end; the indicator
 * grows a `front`, and `changed` means EITHER end went onto different rubber — a driver who
 * fitted new fronts did change tires, and the row should say so. A run is front/rear because it
 * has a front tire, never because of what its car races today.
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
  /** The front end of a front/rear car — same meanings as the four fields above. */
  frontTireRunNumber?: number | null;
  frontTireStintId?: string | null;
  frontTireAgeKnown?: boolean | null;
  frontTireType?: { id: string; displayName: string } | null;
};

/** One end's tire: what it is, how worn, and whether it is different rubber from last time. */
export type RunTireEndIndicator = {
  /** Compound name, e.g. "Sweep D32 32R". */
  tireLabel: string;
  /** Runs on this rubber as of this run; null when the run predates the counter. */
  runNumber: number | null;
  /** False when the driver didn't know the tires' age — the count is relative. */
  ageKnown: boolean;
  /** True when the rubber differs from the previous same-car run that logged tires. */
  changed: boolean;
  /** The compound THIS end replaced; set exactly when this end's own rubber changed. */
  previousTireLabel: string | null;
};

/**
 * The run's tires. The top-level fields are the rear — or the only tire — in the shape they had
 * before front/rear existed, so a single-tire run reads the same to every caller. On a front/rear
 * run the top-level `changed` is true when EITHER end is on different rubber; which end it was
 * is in each end's own `previousTireLabel`.
 */
export type RunTireIndicator = RunTireEndIndicator & {
  /** The front tire of a front/rear run; absent or null on a single-tire run. */
  front?: RunTireEndIndicator | null;
};

/** runId → indicator for every run with a car + logged compound, from a newest-first list (cars may be mixed). */
export function computeTireIndicatorsByRunId(
  runsDescending: TireIndicatorSourceRun[]
): Map<string, RunTireIndicator> {
  type Last = { stintId: string | null; label: string };
  const indicators = new Map<string, RunTireIndicator>();
  const lastRearByCar = new Map<string, Last>();
  const lastFrontByCar = new Map<string, Last>();

  /** One end against the last run on this car that logged that end. */
  const readEnd = (
    carId: string,
    last: Map<string, Last>,
    tire: { displayName: string },
    runNumber: number | null | undefined,
    stintIdRaw: string | null | undefined,
    ageKnown: boolean | null | undefined
  ): RunTireEndIndicator => {
    const stintId = stintIdRaw ?? null;
    const prev = last.get(carId);
    // A different stint is different rubber. Two runs both missing a stint id are
    // legacy rows — treat them as continuous rather than manufacturing a change.
    const changed =
      prev != null && (stintId != null || prev.stintId != null) && prev.stintId !== stintId;
    last.set(carId, { stintId, label: tire.displayName });
    return {
      tireLabel: tire.displayName,
      runNumber: typeof runNumber === "number" && runNumber > 0 ? runNumber : null,
      ageKnown: ageKnown !== false,
      changed,
      previousTireLabel: changed ? prev.label : null,
    };
  };

  for (let i = runsDescending.length - 1; i >= 0; i--) {
    const run = runsDescending[i];
    if (!run.carId || !run.tireType) continue;
    const rear = readEnd(
      run.carId,
      lastRearByCar,
      run.tireType,
      run.tireRunNumber,
      run.tireStintId,
      run.tireAgeKnown
    );
    const front = run.frontTireType
      ? readEnd(
          run.carId,
          lastFrontByCar,
          run.frontTireType,
          run.frontTireRunNumber,
          run.frontTireStintId,
          run.frontTireAgeKnown
        )
      : null;
    indicators.set(run.id, {
      ...rear,
      changed: rear.changed || Boolean(front?.changed),
      ...(front ? { front } : {}),
    });
  }
  return indicators;
}

/** " · run 3", " · run 1 (new)", " · run 3 (age unknown)", or "" when nothing is known. */
function formatTireWearSuffix(indicator: RunTireEndIndicator): string {
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
  const rear = `${indicator.tireLabel}${formatTireWearSuffix(indicator)}`;
  if (!indicator.front) return rear;
  // Front first, as the form asks for them and as a driver reads a car: nose to tail.
  return `F ${indicator.front.tireLabel}${formatTireWearSuffix(indicator.front)} / R ${rear}`;
}

function formatEndTitle(end: RunTireEndIndicator): string {
  const wear = formatTireWearSuffix(end);
  return end.previousTireLabel
    ? `${end.previousTireLabel} → ${end.tireLabel}${wear}`
    : `${end.tireLabel}${wear}`;
}

export function formatTireIndicatorTitle(indicator: RunTireIndicator): string {
  if (!indicator.front) {
    const wear = formatTireWearSuffix(indicator);
    if (indicator.changed && indicator.previousTireLabel) {
      return `Tires changed · ${indicator.previousTireLabel} → ${indicator.tireLabel}${wear}`;
    }
    return `${indicator.tireLabel}${wear}`;
  }
  const ends = `Front ${formatEndTitle(indicator.front)} / Rear ${formatEndTitle(indicator)}`;
  return indicator.changed ? `Tires changed · ${ends}` : ends;
}
