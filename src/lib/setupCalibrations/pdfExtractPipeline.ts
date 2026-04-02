import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import { normalizeCalibrationData, type SetupSheetCalibrationData } from "@/lib/setupCalibrations/types";
import { applyAllTextFieldMappings, normalizeTemplateExtractedValue } from "@/lib/setupCalibrations/applyTextTemplate";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { interpretAwesomatixSetupSnapshot } from "@/lib/setupDocuments/awesomatixImportPostProcess";
import {
  extractPdfFormFields,
  type PdfFormFieldsExtraction,
  type PdfFormImportDebugRow,
  applyPdfFormFieldMappingsFromExtraction,
} from "@/lib/setupDocuments/pdfFormFields";
import {
  buildPdfTextStructure,
  extractPdfPageContents,
  type PdfRawPage,
  type PdfTextStructureDocument,
} from "@/lib/setupDocuments/pdfTextStructure";

type StageHook = (stage: string, event: "start" | "finish", data?: Record<string, unknown>) => void | Promise<void>;

async function withStageTimeout<T>(
  stage: string,
  ms: number,
  fn: () => Promise<T>,
  onStage?: StageHook
): Promise<T> {
  const t0 = Date.now();
  await onStage?.(stage, "start");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`Timeout after ${ms}ms (${stage})`)), ms);
    });
    const out = await Promise.race([fn(), timeout]);
    await onStage?.(stage, "finish", { ms: Date.now() - t0 });
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    a.x + a.width < b.x
    || b.x + b.width < a.x
    || a.y + a.height < b.y
    || b.y + b.height < a.y
  );
}

export type PdfRawExtraction = {
  version: 1;
  extractionMode: "form_fields_only" | "form_fields_plus_text";
  extractionReason: string;
  pageCount: number;
  tokenCount: number;
  hasFormFields: boolean;
  formFields: PdfFormFieldsExtraction;
  rawPages?: PdfRawPage[];
  textStructure?: PdfTextStructureDocument;
  /** When set, pdf2json returned no pages — text/region rules were skipped. */
  textExtractionFailure?: "zero_pages" | "token_limit";
};

export async function extractPdfRawDataFromFile(input: {
  file: File;
  calibrationDataJsonForMeta?: unknown;
  onStage?: StageHook;
}): Promise<PdfRawExtraction> {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const calibrationData = normalizeCalibrationData(input.calibrationDataJsonForMeta ?? {});
  const epsilon = calibrationData.documentMeta?.lineGroupingEpsilon ?? 2.5;

  const formFields = await withStageTimeout(
    "pdf_form_fields_extract",
    12000,
    async () => extractPdfFormFields(buffer),
    input.onStage
  );

  const needsText = Object.keys(calibrationData.fieldMappings ?? {}).length > 0 || Object.keys(calibrationData.fields ?? {}).length > 0;
  const needsAnyMapping = Object.keys(calibrationData.formFieldMappings ?? {}).length > 0 || needsText;
  const formFieldCount = formFields.fields.length;
  const sufficientFormFields = formFields.hasFormFields && formFieldCount >= 20;
  const canSkipText = !needsText && needsAnyMapping && sufficientFormFields;

  // Default for these setup sheets: form-fields-first. Only extract pdf2json tokens if calibration requires it.
  if (canSkipText) {
    await input.onStage?.("decide_extraction_strategy", "finish", {
      extractionMode: "form_fields_only",
      reason: "Calibration has no text/region rules and form fields are sufficient; skipping pdf2json token extraction.",
      formFieldCount,
      expectedFormRules: Object.keys(calibrationData.formFieldMappings ?? {}).length,
    });
    return {
      version: 1,
      extractionMode: "form_fields_only",
      extractionReason:
        "Calibration has no text/region rules and form fields are sufficient; skipped pdf2json token extraction.",
      pageCount: calibrationData.documentMeta?.pageCount ?? 0,
      tokenCount: 0,
      hasFormFields: formFields.hasFormFields,
      formFields,
    };
  }

  await input.onStage?.("decide_extraction_strategy", "finish", {
    extractionMode: "form_fields_plus_text",
    reason: needsText
      ? "Calibration requires text/region rules; extracting pdf2json tokens."
      : "Form fields were not sufficient; extracting pdf2json tokens as fallback.",
    needsText,
    formFieldCount,
    expectedFormRules: Object.keys(calibrationData.formFieldMappings ?? {}).length,
    expectedTextRules: Object.keys(calibrationData.fieldMappings ?? {}).length,
    expectedRegionRules: Object.keys(calibrationData.fields ?? {}).length,
  });

  const rawPages = await withStageTimeout("pdf_text_tokens_extract", 20000, async () => extractPdfPageContents(buffer), input.onStage);
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    await input.onStage?.("decide_extraction_strategy", "finish", {
      extractionMode: "form_fields_only",
      reason: "pdf2json returned zero pages — continuing with form fields only.",
      formFieldCount,
    });
    return {
      version: 1,
      extractionMode: "form_fields_only",
      extractionReason:
        "PDF text token extraction returned zero pages; calibration text/region rules will be skipped. Form fields are still applied.",
      pageCount: 0,
      tokenCount: 0,
      hasFormFields: formFields.hasFormFields,
      formFields,
      textExtractionFailure: "zero_pages",
    };
  }
  const tokenCount = rawPages.reduce((sum, p) => sum + (p.tokens?.length ?? 0), 0);

  const maxTokens = 120_000;
  if (tokenCount > maxTokens) {
    await input.onStage?.("decide_extraction_strategy", "finish", {
      extractionMode: "form_fields_only",
      reason: `token count ${tokenCount} exceeds cap — skipping text tokens.`,
      formFieldCount,
    });
    return {
      version: 1,
      extractionMode: "form_fields_only",
      extractionReason: `PDF token count too large (${tokenCount} > ${maxTokens}); text/region rules skipped. Form fields are still applied.`,
      pageCount: rawPages.length,
      tokenCount,
      hasFormFields: formFields.hasFormFields,
      formFields,
      textExtractionFailure: "token_limit",
    };
  }

  const textStructure = await withStageTimeout("pdf_text_structure_build", 3000, async () => buildPdfTextStructure(rawPages, epsilon), input.onStage);

  return {
    version: 1,
    extractionMode: "form_fields_plus_text",
    extractionReason: needsText
      ? "Calibration requires text/region rules; extracted form fields + pdf2json tokens."
      : "Form fields were not sufficient; extracted form fields + pdf2json tokens.",
    pageCount: rawPages.length,
    tokenCount,
    hasFormFields: formFields.hasFormFields,
    formFields,
    rawPages,
    textStructure,
  };
}

export type CalibrationMappingDiagnostic = {
  calibrationProfileId?: string;
  templateType?: string;
  expected: { formRules: number; textRules: number; regionRules: number };
  used: { form: boolean; text: boolean; region: boolean };
  matched: { keys: number; keysSample: string[] };
  unmatched: {
    expectedFormKeys: string[];
    expectedTextKeys: string[];
    expectedRegionKeys: string[];
    presentPdfFieldNamesSample: string[];
  };
  /** Non-fatal pipeline issues (e.g. text extraction skipped). */
  pipelineWarnings?: string[];
};

export async function mapExtractedPdfWithCalibration(input: {
  extracted: PdfRawExtraction;
  calibrationDataJson: unknown;
  calibrationProfileId?: string;
  onStage?: StageHook;
}): Promise<{
  parsedData: SetupSnapshotData;
  importedKeys: string[];
  calibrationData: SetupSheetCalibrationData;
  formImportDebug?: PdfFormImportDebugRow[];
  diagnostic: CalibrationMappingDiagnostic;
}> {
  const calibrationData = normalizeCalibrationData(input.calibrationDataJson);
  const parsedData: SetupSnapshotData = {};
  const importedKeys: string[] = [];
  const pipelineWarnings: string[] = [];

  const formMappings = calibrationData.formFieldMappings ?? {};
  let formImportDebug: PdfFormImportDebugRow[] | undefined;
  if (Object.keys(formMappings).length > 0) {
    const mapped = await withStageTimeout(
      "map_form_fields",
      15000,
      async () =>
        applyPdfFormFieldMappingsFromExtraction({
          extraction: input.extracted.formFields,
          formFieldMappings: formMappings,
        }),
      input.onStage
    );
    Object.assign(parsedData, mapped.parsedData);
    importedKeys.push(...mapped.importedKeys);
    formImportDebug = mapped.debugRows.length ? mapped.debugRows : undefined;
  }

  const textMappings = calibrationData.fieldMappings ?? {};
  if (Object.keys(textMappings).length > 0) {
    if (!input.extracted.textStructure) {
      pipelineWarnings.push(
        "text_mapping_skipped_no_text_structure: calibration has text field rules but PDF text tokens were not available (extraction skipped or empty)."
      );
    } else {
    const textStructure = input.extracted.textStructure;
    const { parsedData: textData, importedKeys: textKeys } = await withStageTimeout(
      "map_text_fields",
      8000,
      async () => applyAllTextFieldMappings(textStructure, textMappings),
      input.onStage
    );
    for (const [k, v] of Object.entries(textData)) {
      const existing = parsedData[k];
      if (existing != null && String(existing).trim() !== "") continue;
      if (v == null || String(v).trim() === "") continue;
      parsedData[k] = v;
      if (!importedKeys.includes(k)) importedKeys.push(k);
    }
    importedKeys.push(...textKeys.filter((k) => !importedKeys.includes(k)));
    }
  }

  // Region fallback: use raw pages (already extracted)
  const regionRules = calibrationData.fields ?? {};
  if (Object.keys(regionRules).length > 0) {
    if (!input.extracted.rawPages?.length) {
      pipelineWarnings.push(
        "region_mapping_skipped_no_tokens: calibration has region rules but PDF text tokens were not available."
      );
    } else {
    const rawPages = input.extracted.rawPages;
    await withStageTimeout(
      "map_region_fields",
      8000,
      async () => {
        for (const [fieldKey, region] of Object.entries(regionRules)) {
          const existing = parsedData[fieldKey];
          if (existing != null && String(existing).trim() !== "") continue;
          const page = rawPages[region.page - 1];
          if (!page) continue;
          const hits = page.tokens
            .filter((token) =>
              intersects(region, { x: token.x, y: token.y, width: Math.max(token.w, 0.8), height: 0.8 })
            )
            .map((token) => token.text)
            .filter(Boolean);
          const rawJoined = hits.join(" ").replace(/\s+/g, " ").trim();
          const fieldKind = getCalibrationFieldKind(fieldKey);
          const joined =
            fieldKind === "text" || fieldKind === "documentMetadata"
              ? rawJoined
              : normalizeTemplateExtractedValue(rawJoined);
          if (!joined) continue;
          parsedData[fieldKey] = joined;
          if (!importedKeys.includes(fieldKey)) importedKeys.push(fieldKey);
        }
      },
      input.onStage
    );
    }
  }

  const interpreted = await withStageTimeout(
    "build_structured_setup_snapshot",
    1500,
    async () => interpretAwesomatixSetupSnapshot(parsedData),
    input.onStage
  );

  const presentPdfFieldNamesSample = input.extracted.formFields.fields
    .map((f) => f.name)
    .slice(0, 50);

  const diag: CalibrationMappingDiagnostic = {
    calibrationProfileId: input.calibrationProfileId,
    templateType: calibrationData.templateType,
    expected: {
      formRules: Object.keys(formMappings).length,
      textRules: Object.keys(textMappings).length,
      regionRules: Object.keys(regionRules).length,
    },
    used: {
      form: Object.keys(formMappings).length > 0,
      text: Boolean(input.extracted.textStructure) && Object.keys(textMappings).length > 0,
      region: Boolean(input.extracted.rawPages?.length) && Object.keys(regionRules).length > 0,
    },
    matched: { keys: importedKeys.length, keysSample: importedKeys.slice(0, 50) },
    unmatched: {
      expectedFormKeys: Object.keys(formMappings).filter((k) => !importedKeys.includes(k)).slice(0, 60),
      expectedTextKeys: Object.keys(textMappings).filter((k) => !importedKeys.includes(k)).slice(0, 60),
      expectedRegionKeys: Object.keys(regionRules).filter((k) => !importedKeys.includes(k)).slice(0, 60),
      presentPdfFieldNamesSample,
    },
    pipelineWarnings: pipelineWarnings.length ? pipelineWarnings : undefined,
  };

  return {
    parsedData: interpreted,
    importedKeys,
    calibrationData,
    formImportDebug,
    diagnostic: diag,
  };
}

