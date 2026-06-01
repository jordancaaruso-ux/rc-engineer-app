import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/** Setup sheet identity used to match cars/runs for cross-driver compare. */
export type SetupSheetScope = {
  setupSheetModelId: string | null;
  setupSheetTemplate: string | null;
};

export function setupSheetScopeFromCar(
  car: {
    setupSheetModelId?: string | null;
    setupSheetTemplate?: string | null;
  } | null
  | undefined
): SetupSheetScope | null {
  if (!car) return null;
  const setupSheetModelId = car.setupSheetModelId?.trim() || null;
  const setupSheetTemplate = canonicalSetupSheetTemplateId(car.setupSheetTemplate ?? null);
  if (!setupSheetModelId && !setupSheetTemplate) return null;
  return { setupSheetModelId, setupSheetTemplate };
}

export function carsShareSetupSheetScope(a: SetupSheetScope, b: SetupSheetScope): boolean {
  if (a.setupSheetModelId && b.setupSheetModelId) {
    return a.setupSheetModelId === b.setupSheetModelId;
  }
  if (a.setupSheetTemplate && b.setupSheetTemplate) {
    return a.setupSheetTemplate === b.setupSheetTemplate;
  }
  return false;
}

export function carMatchesSetupSheetScope(
  car: {
    setupSheetModelId?: string | null;
    setupSheetTemplate?: string | null;
  } | null
  | undefined,
  scope: SetupSheetScope
): boolean {
  const other = setupSheetScopeFromCar(car ?? null);
  if (!other) return false;
  return carsShareSetupSheetScope(scope, other);
}
