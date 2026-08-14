import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import type {
  PdfFormFieldMappingRule,
  SetupSheetCalibrationData,
} from "@/lib/setupCalibrations/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import type { PdfFormImportDebugRow } from "@/lib/setupDocuments/pdfFormFields";
import { extractPdfRawDataFromFile, mapExtractedPdfWithCalibration } from "@/lib/setupCalibrations/pdfExtractPipeline";

export async function applyCalibrationToPdf(input: {
  file: File;
  calibrationDataJson: unknown;
  /**
   * The chassis blank's mappings for the printed boxes the calibration doesn't name. Passed on so a
   * re-apply reads the same sheet the original import did — without it, `parsedDataMerge: "replace"`
   * would quietly drop every value that came from an unnamed box.
   */
  derivedMappings?: Record<string, PdfFormFieldMappingRule>;
}): Promise<{
  parsedData: SetupSnapshotData;
  importedKeys: string[];
  calibrationData: SetupSheetCalibrationData;
  formImportDebug?: PdfFormImportDebugRow[];
}> {
  // Kept for backwards compatibility (UI "Apply template" path).
  // New pipeline extracts PDF once and maps from extracted representation (no PDF reload in mapping).
  const extracted = await extractPdfRawDataFromFile({ file: input.file, calibrationDataJsonForMeta: input.calibrationDataJson });
  const mapped = await mapExtractedPdfWithCalibration({
    extracted,
    calibrationDataJson: input.calibrationDataJson,
    derivedMappings: input.derivedMappings,
  });
  return {
    parsedData: mapped.parsedData,
    importedKeys: mapped.importedKeys,
    calibrationData: mapped.calibrationData,
    formImportDebug: mapped.formImportDebug,
  };
}
