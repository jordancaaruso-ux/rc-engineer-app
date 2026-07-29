import type { UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

/**
 * What the dashboard's Setups card shows: one row per car, naming the baseline that car is
 * actually running (docs/DASHBOARD_NORTH_STAR.md — the card is a verdict, not a library index;
 * the full library lives in Garage).
 *
 * "Running" means the baseline the car's most recent run was built from. That's a stronger claim
 * than "most recently saved" — a setup you typed but never ran isn't what the car is on — so the
 * newest saved baseline is only the fallback.
 *
 * Pure on purpose: the DB reads live in `getDashboardSetups.ts`.
 */

export type CurrentSetupCandidate = {
  id: string;
  name: string | null;
  createdAt: Date;
};

export type DashboardSetupCar = UploadSetupCar & {
  current: { id: string; name: string; dateLabel: string } | null;
};

export type DashboardSetups = {
  cars: DashboardSetupCar[];
  /**
   * False when nothing in the account counts as a setup yet — the card wears the "add a setup"
   * ask instead of the list (docs/ONBOARDING_NORTH_STAR.md).
   */
  hasAnySetup: boolean;
};

/**
 * @param lastRunBaselineId Baseline the car's most recent run was merged from, when it had one.
 * @param librarySetups The car's saved baselines, newest first.
 */
export function pickCurrentSetup(input: {
  lastRunBaselineId: string | null;
  librarySetups: CurrentSetupCandidate[];
}): CurrentSetupCandidate | null {
  // A baseline can be deleted while runs that used it survive, so a miss here falls through to the
  // newest saved one rather than showing the car as having no setup.
  if (input.lastRunBaselineId) {
    const used = input.librarySetups.find((s) => s.id === input.lastRunBaselineId);
    if (used) return used;
  }
  return input.librarySetups[0] ?? null;
}

export function buildDashboardSetupCar(input: {
  car: UploadSetupCar;
  lastRunBaselineId: string | null;
  librarySetups: CurrentSetupCandidate[];
  formatDate: (at: Date) => string;
}): DashboardSetupCar {
  const current = pickCurrentSetup(input);
  return {
    ...input.car,
    current: current
      ? {
          id: current.id,
          name: current.name ?? "Untitled setup",
          dateLabel: input.formatDate(current.createdAt),
        }
      : null,
  };
}
