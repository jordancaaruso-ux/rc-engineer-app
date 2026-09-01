import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The sheet PAPER a calibration reads — an edition blank's id, or null for the primary.
 *
 * The stamp `SetupSnapshot.sheetBlankId` is minted here, once, at import: a setup read through an
 * edition's calibration was born on that edition's paper, and the founder's ruling (2026-08-31) is
 * that the paper a driver uploaded is the paper they see, always. Every other snapshot writer
 * INHERITS an existing stamp rather than calling this — copies must not re-derive provenance.
 *
 * An edition is recognised by its blank: the same uploaded document is both the calibration's
 * example and the edition blank's source (see `createSheetEditionForModel`). A primary
 * calibration's example document backs no edition blank, so this returns null for it.
 */
export async function editionBlankIdForCalibration(
  calibrationId: string | null | undefined
): Promise<string | null> {
  if (!calibrationId) return null;
  const calibration = await prisma.setupSheetCalibration.findUnique({
    where: { id: calibrationId },
    select: { exampleDocumentId: true },
  });
  if (!calibration?.exampleDocumentId) return null;
  const editionBlank = await prisma.setupSheetBlank.findFirst({
    where: { setupDocumentId: calibration.exampleDocumentId, isEdition: true },
    select: { id: true },
  });
  return editionBlank?.id ?? null;
}
