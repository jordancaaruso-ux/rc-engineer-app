import type { UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

/**
 * What the dashboard's Setups card shows: one row per car, naming the setup that car is
 * actually on (docs/DASHBOARD_NORTH_STAR.md — the card is a verdict, not a library index).
 *
 * "On" means the last run's own snapshot (founder call 2026-07-29) — exactly what was on the
 * car, including tweaks made in the run form that never went back to a baseline. This replaced
 * the old definition ("the library baseline the last run was merged from"), which could never
 * match in practice: run snapshots chain to other run snapshots, so the lookup found nothing
 * and every row read "No setup yet" on an account with hundreds of runs.
 *
 * The newest saved library baseline is only the fallback for a car that has never been run.
 *
 * Pure on purpose: the DB reads live in `getDashboardSetups.ts`.
 */

/** The last run's snapshot for a car — the loader pre-formats the session label. */
export type LastRunSetupRef = {
  setupSnapshotId: string;
  /** e.g. "Race · TFTR · Whale"; empty string when the run has no session/track facts. */
  sessionLabel: string;
  at: Date;
};

export type CurrentSetupCandidate = {
  id: string;
  name: string | null;
  createdAt: Date;
};

export type DashboardSetupCar = UploadSetupCar & {
  current: { id: string; name: string; dateLabel: string; fromRun: boolean } | null;
};

export type DashboardSetups = {
  cars: DashboardSetupCar[];
  /**
   * False when nothing in the account counts as a setup yet — the card wears the "add a setup"
   * ask instead of the list (docs/ONBOARDING_NORTH_STAR.md). A logged run counts: its snapshot
   * is the setup the car is on.
   */
  hasAnySetup: boolean;
};

export function pickCurrentSetup(input: {
  lastRun: LastRunSetupRef | null;
  /** The car's saved baselines, newest first. */
  librarySetups: CurrentSetupCandidate[];
}): { id: string; name: string | null; createdAt: Date; fromRun: boolean } | null {
  if (input.lastRun) {
    return {
      id: input.lastRun.setupSnapshotId,
      name: input.lastRun.sessionLabel || null,
      createdAt: input.lastRun.at,
      fromRun: true,
    };
  }
  const newestSaved = input.librarySetups[0];
  return newestSaved ? { ...newestSaved, fromRun: false } : null;
}

export function buildDashboardSetupCar(input: {
  car: UploadSetupCar;
  lastRun: LastRunSetupRef | null;
  librarySetups: CurrentSetupCandidate[];
  formatDate: (at: Date) => string;
}): DashboardSetupCar {
  const current = pickCurrentSetup(input);
  return {
    ...input.car,
    current: current
      ? {
          id: current.id,
          name: current.name ?? (current.fromRun ? "Last run's setup" : "Untitled setup"),
          dateLabel: input.formatDate(current.createdAt),
          fromRun: current.fromRun,
        }
      : null,
  };
}
