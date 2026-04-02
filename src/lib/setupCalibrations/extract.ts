import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetCalibrationData } from "@/lib/setupCalibrations/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import type { PdfFormImportDebugRow } from "@/lib/setupDocuments/pdfFormFields";
import { extractPdfRawDataFromFile, mapExtractedPdfWithCalibration } from "@/lib/setupCalibrations/pdfExtractPipeline";

export async function applyCalibrationToPdf(input: {
  file: File;
  calibrationDataJson: unknown;
}): Promise<{
  parsedData: SetupSnapshotData;
  importedKeys: string[];
  calibrationData: SetupSheetCalibrationData;
  formImportDebug?: PdfFormImportDebugRow[];
}> {
  // Kept for backwards compatibility (UI "Apply template" path).
  // New pipeline extracts PDF once and maps from extracted representation (no PDF reload in mapping).
  const extracted = await extractPdfRawDataFromFile({ file: input.file, calibrationDataJsonForMeta: input.calibrationDataJson });
  const mapped = await mapExtractedPdfWithCalibration({ extracted, calibrationDataJson: input.calibrationDataJson });
  return {
    parsedData: mapped.parsedData,
    importedKeys: mapped.importedKeys,
    calibrationData: mapped.calibrationData,
    formImportDebug: mapped.formImportDebug,
  };
}
