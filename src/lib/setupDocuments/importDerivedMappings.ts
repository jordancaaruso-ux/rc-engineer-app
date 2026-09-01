import "server-only";

import { prisma } from "@/lib/prisma";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

/**
 * The mappings for the printed boxes a calibration does not name, for one import.
 *
 * They live on a BLANK, not in the calibration, because they must be read raw — see
 * `unionDerivedWithCalibration.ts`. Which blank depends on whose file the calibration reads:
 *
 *   - the PRIMARY calibration reads the original sheet, so the primary blank's union mappings
 *     apply (they name the original file's fields);
 *   - an EDITION's calibration reads the rebuilt file, so only the edition blank's own derived
 *     mappings apply. The primary's would name fields the rebuilt file does not have — and any
 *     name it coincidentally does have would read a wrong box. An edition starts with none;
 *     an edition ALIGNED to the canonical vocabulary (see `alignEditionByGeometry`) carries the
 *     primary's union mappings re-addressed to its own field names.
 *
 * The edition is recognised by its blank: the same uploaded document is both the calibration's
 * example and the edition blank's source. See `createSheetEditionForModel`.
 */
export async function derivedMappingsForImport(input: {
  setupSheetModelId: string | null | undefined;
  calibrationExampleDocumentId: string | null | undefined;
}): Promise<Record<string, PdfFormFieldMappingRule>> {
  if (input.calibrationExampleDocumentId) {
    const editionBlank = await prisma.setupSheetBlank.findFirst({
      where: { setupDocumentId: input.calibrationExampleDocumentId, isEdition: true },
      select: { derivedMappingsJson: true },
    });
    if (editionBlank) {
      return (editionBlank.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>;
    }
  }
  if (!input.setupSheetModelId) return {};
  const primaryBlank = await prisma.setupSheetBlank.findFirst({
    where: { setupSheetModelId: input.setupSheetModelId, isEdition: false },
    orderBy: { createdAt: "asc" },
    select: { derivedMappingsJson: true },
  });
  return (primaryBlank?.derivedMappingsJson ?? {}) as Record<string, PdfFormFieldMappingRule>;
}
