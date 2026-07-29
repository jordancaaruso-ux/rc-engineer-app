import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/** Chassis identity carried by an imported setup document. */
export type SetupDocumentScope = {
  carId: string | null;
  setupSheetModelId: string | null;
  setupSheetTemplate: string | null;
};

/** Chassis identity of the car the driver is logging on. */
export type PickerCarScope = {
  /** Chassis type (`SetupSheetModel.id`) of the car, or null when it has none. */
  setupSheetModelId: string | null;
  /** Canonical template key for the car (model slug, or the legacy `setupSheetTemplate`). */
  setupSheetTemplate: string | null;
  /** Cars of this user sharing the same chassis type — their documents are interchangeable. */
  siblingCarIds: ReadonlySet<string>;
};

function sameKey(a: string | null, b: string | null): boolean {
  return a != null && b != null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Should an imported setup document appear in the saved-setups picker for this car?
 *
 * Chassis identity is checked most-specific-first, so a sheet tagged as another chassis
 * (a Mugen MTC3 import) never shows on a different car — including when it was uploaded
 * without a car attached. Only a document with *no* identity at all falls back to
 * "applies to anything", and then only on a car that has no chassis type either.
 */
export function setupDocumentBelongsToCar(
  doc: SetupDocumentScope,
  car: PickerCarScope | null
): boolean {
  if (!car) return true; // No car selected yet — nothing to scope against.

  const docModelId = doc.setupSheetModelId?.trim() || null;
  const docTemplate = canonicalSetupSheetTemplateId(doc.setupSheetTemplate);

  if (docModelId && car.setupSheetModelId) return docModelId === car.setupSheetModelId;
  if (docTemplate) return sameKey(docTemplate, car.setupSheetTemplate);
  // Typed document, car identified by something we can't compare against: don't guess.
  if (docModelId) return false;

  if (doc.carId) return car.siblingCarIds.has(doc.carId);

  const carIsTyped = car.setupSheetModelId != null || car.setupSheetTemplate != null;
  return !carIsTyped;
}
