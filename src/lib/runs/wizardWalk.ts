/**
 * Log-run wizard step model (founder interviews 2026-07-16 → 2026-07-17 v5).
 *
 * FIVE steps since 2026-09-16: Prep folded INTO Tires (founder — "everything
 * that is currently in prep needs to be in tires"). Nothing was dropped — the
 * additive picker and the applications list now sit beneath the compound on
 * one page, which is the stack the classic (non-wizard) Tires face has always
 * used. The merge also retires a trap: Prep counted as done only when warmers
 * or an additive were logged, so a driver who ran neither had a step that
 * never ticked and a draft that reopened on that empty page every time.
 *
 * Session (car + day type + event/track) is the old entry screen
 * folded into the wizard as its first tab (2026-07-17): the Continue / New-log
 * choice happens there, and every later step is walked on every run —
 * continuing prefills the steps instead of skipping them (the "what changed"
 * chips + filtered-walk logic retired with that decision). Laps · Feel are
 * after-run (laps BEFORE feel — import the data, then rate it). The `preRun`
 * flag only places the dashed divider on the step bar/rail — the "Run
 * completed?" interstitial that used to fire on crossing it was retired in v5
 * (tabs are primary nav; end-of-step rows carry the walk-away moment).
 */

export type WizardStepId = "session" | "equipment" | "setup" | "laps" | "feel";

/** Per-step status rendered by the wizard chrome (ticks + track sectors). */
export type WizardStepStatus = {
  /** The step's key data is in — its track sector fills. */
  done?: boolean;
  /** Required data still missing at Run complete — amber dot on the tick. */
  attention?: boolean;
};

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
  // Carries tire prep as well since the 2026-09-16 merge: compound + age on
  // top, additive + applications beneath.
  { id: "equipment", label: "Tires", preRun: true },
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

/**
 * Landing step when the wizard hosts an EXISTING run (draft resume / edit —
 * founder 2026-07-17: "finishing a draft opens the wizard at the first
 * unfinished step"). Walks the step order and returns the first step whose
 * data is still missing; a fully-logged run (editing a completed one) lands
 * back on Session for a top-down review.
 */
export function firstUnfinishedStep(
  doneById: Partial<Record<WizardStepId, boolean>>,
): WizardStepId {
  for (const s of WIZARD_STEPS) {
    if (!doneById[s.id]) return s.id;
  }
  return "session";
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


/**
 * G1 coach line for the driver's very first run — docs/ONBOARDING_NORTH_STAR.md
 * (founder-locked 2026-07-22, chosen over a one-time tip card and over no copy
 * at all). One quiet line per step, worded so it reassures rather than
 * instructs: the recurring worry on a first run is "have I broken something by
 * leaving this blank", and the honest answer is almost always no.
 */
export function firstRunCoachLine(step: WizardStepId): string {
  switch (step) {
    case "session":
      return "First run — five tabs, and none of them can stop you. Save a draft any time.";
    case "equipment":
      return "Tires aren’t required to save. Pick what you’re on; prep below only if you ran it.";
    case "setup":
      return "Attach a sheet now if you have one. From run two it copies forward on its own.";
    case "laps":
      return "Laps attach on their own when your timing name matches. Paste a link or leave it.";
    case "feel":
      return "A rating is the only thing standing between this and a complete run.";
    default:
      return "";
  }
}
