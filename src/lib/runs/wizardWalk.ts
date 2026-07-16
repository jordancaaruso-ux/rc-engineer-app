/**
 * Log-run wizard step model + filtered-walk logic (founder interviews 2026-07-16,
 * v2 after the walkthrough-artifact session).
 *
 * Five steps: Equipment (tires + battery) · Prep · Setup are before-run and
 * declarable — when continuing a copied run they only join the walk if flagged
 * "changed" on the entry screen. Laps · Feel are after-run and always walked
 * (laps BEFORE feel — import the data, then rate it). A fresh log walks
 * everything. Carried steps stay reachable via the icon rail and the
 * live-header summary rows.
 *
 * Entry chips are finer-grained than steps (Tires and Battery are separate
 * chips but share the Equipment step) — `CHIP_TO_STEP` maps them down.
 */

export type WizardStepId = "equipment" | "prep" | "setup" | "laps" | "feel";

/** Entry-screen "what changed" chips (copy flow). */
export type WizardChangeChip = "tires" | "battery" | "setup" | "prep";

export const CHIP_TO_STEP: Record<WizardChangeChip, WizardStepId> = {
  tires: "equipment",
  battery: "equipment",
  setup: "setup",
  prep: "prep",
};

export type WizardStepDef = {
  id: WizardStepId;
  label: string;
  /** Walked every run (after-run data); false = declarable via entry chips. */
  always: boolean;
  /** Before the pre-run→after-run seam ("Run completed?" interstitial). */
  preRun: boolean;
};

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: "equipment", label: "Equipment", always: false, preRun: true },
  { id: "prep", label: "Prep", always: false, preRun: true },
  { id: "setup", label: "Setup", always: false, preRun: true },
  { id: "laps", label: "Laps", always: true, preRun: false },
  { id: "feel", label: "Feel", always: true, preRun: false },
] as const;

/** Steps in this run's walk, in global order. */
export function walkStepIds(
  continuing: boolean,
  changedChips: ReadonlySet<string>,
): WizardStepId[] {
  const changedSteps = new Set(
    [...changedChips].map((c) => CHIP_TO_STEP[c as WizardChangeChip]).filter(Boolean),
  );
  return WIZARD_STEPS.filter(
    (s) => !continuing || s.always || changedSteps.has(s.id),
  ).map((s) => s.id);
}

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

/**
 * Next walk step after `current` in global step order. Works from a carried
 * (off-walk) step too — Next resumes the walk at the first walk step past it.
 */
export function nextWalkStep(
  current: WizardStepId,
  walk: readonly WizardStepId[],
): WizardStepId | null {
  const ci = stepIndex(current);
  for (const id of walk) {
    if (stepIndex(id) > ci) return id;
  }
  return null;
}

/** Previous walk step before `current` in global step order (null = at the start). */
export function prevWalkStep(
  current: WizardStepId,
  walk: readonly WizardStepId[],
): WizardStepId | null {
  const ci = stepIndex(current);
  let prev: WizardStepId | null = null;
  for (const id of walk) {
    if (stepIndex(id) < ci) prev = id;
    else break;
  }
  return prev;
}

/**
 * True when advancing current→next crosses the pre-run→after-run boundary —
 * the moment the "Run completed?" interstitial appears (once per run).
 */
export function crossesSeam(current: WizardStepId, next: WizardStepId): boolean {
  const cur = WIZARD_STEPS[stepIndex(current)];
  const nxt = WIZARD_STEPS[stepIndex(next)];
  return Boolean(cur?.preRun) && !nxt?.preRun;
}
