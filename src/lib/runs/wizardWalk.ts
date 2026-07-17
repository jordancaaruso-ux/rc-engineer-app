/**
 * Log-run wizard step model (founder interviews 2026-07-16 → 2026-07-17 v5).
 *
 * Six steps. Session (car + day type + event/track) is the old entry screen
 * folded into the wizard as its first tab (2026-07-17): the Continue / New-log
 * choice happens there, and every later step is walked on every run —
 * continuing prefills the steps instead of skipping them (the "what changed"
 * chips + filtered-walk logic retired with that decision). Laps · Feel are
 * after-run (laps BEFORE feel — import the data, then rate it). The `preRun`
 * flag only places the dashed divider on the step bar/rail — the "Run
 * completed?" interstitial that used to fire on crossing it was retired in v5
 * (tabs are primary nav; end-of-step rows carry the walk-away moment).
 */

export type WizardStepId = "session" | "equipment" | "prep" | "setup" | "laps" | "feel";

export type WizardStepDef = {
  id: WizardStepId;
  label: string;
  /** Before the pre-run→after-run boundary (dashed divider on the step bar). */
  preRun: boolean;
};

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: "session", label: "Session", preRun: true },
  // Label renamed Equipment → Tires (founder 2026-07-17); the id stays
  // "equipment" because step ids ride in wizard payloads and jump targets.
  { id: "equipment", label: "Tires", preRun: true },
  { id: "prep", label: "Prep", preRun: true },
  { id: "setup", label: "Setup", preRun: true },
  { id: "laps", label: "Laps", preRun: false },
  // Label renamed Feel → Feedback (founder 2026-07-16); the id stays "feel"
  // because step ids ride in wizard payloads and jump targets.
  { id: "feel", label: "Feedback", preRun: false },
] as const;

/** Every run walks every step, in order (continue = prefilled, fresh = blank). */
export function walkStepIds(): WizardStepId[] {
  return WIZARD_STEPS.map((s) => s.id);
}

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function stepLabel(id: WizardStepId): string {
  return WIZARD_STEPS[stepIndex(id)].label;
}

/** Next walk step after `current` in global step order (null = at the end). */
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

