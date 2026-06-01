import {
  carMatchesSetupSheetScope,
  setupSheetScopeFromCar,
  type SetupSheetScope,
} from "@/lib/setupCompare/setupSheetScope";

export type RunForSetupComparePicker = {
  id: string;
  userId?: string | null;
  carId?: string | null;
  car?: {
    id?: string;
    setupSheetModelId?: string | null;
    setupSheetTemplate?: string | null;
  } | null;
};

/**
 * Runs eligible in "Choose run" when comparing setup on team Sessions.
 * Includes runs on the anchor car plus the viewer's runs on cars with the same sheet scope.
 */
export function filterRunsForTeamSetupComparePicker<T extends RunForSetupComparePicker>(
  anchor: RunForSetupComparePicker,
  candidates: T[],
  viewerUserId: string
): T[] {
  const anchorCarId = anchor.car?.id ?? anchor.carId ?? null;
  const scope = setupSheetScopeFromCar(anchor.car ?? null);
  if (!anchorCarId && !scope) return candidates;

  const out: T[] = [];
  const seen = new Set<string>();
  for (const r of candidates) {
    if (seen.has(r.id) || r.id === anchor.id) continue;
    if (anchorCarId && (r.car?.id === anchorCarId || r.carId === anchorCarId)) {
      seen.add(r.id);
      out.push(r);
      continue;
    }
    if (
      scope &&
      r.userId === viewerUserId &&
      carMatchesSetupSheetScope(r.car ?? null, scope)
    ) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export { setupSheetScopeFromCar, type SetupSheetScope };
