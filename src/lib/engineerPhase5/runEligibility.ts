import "server-only";

/** Shared eligibility for Engineer artifacts (hints, dashboard suggestions). */
export function isRunEligibleForEngineerArtifacts(run: {
  loggingComplete: boolean;
  loggingCompletedAt: Date | null;
  carId: string | null;
}): boolean {
  if (!run.carId) return false;
  return Boolean(run.loggingCompletedAt) || run.loggingComplete;
}

export const engineerEligibleRunWhere = {
  carId: { not: null },
  OR: [{ loggingCompletedAt: { not: null } }, { loggingComplete: true }],
};
