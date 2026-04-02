import "server-only";

import { prisma } from "@/lib/prisma";
import { parseSetupDocumentFile } from "@/lib/setupDocuments/parser";
import { loadSetupDocumentFileFromStorage, sourceTypeFromMime } from "@/lib/setupDocuments/storage";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { getEffectiveCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { extractPdfRawDataFromFile, mapExtractedPdfWithCalibration } from "@/lib/setupCalibrations/pdfExtractPipeline";
import { SetupDocumentImportStages, type SetupDocumentImportStage } from "@/lib/setupDocuments/importStages";
import type { SetupDocumentParsedResult } from "@/lib/setupDocuments/types";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { computeA800rrDerived } from "@/lib/setupCalculations/a800rrDerived";
import { computeDetailedDerivedFieldStatuses } from "@/lib/setup/derivedFields";

type ImportStatus = "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED" | "COMPLETED_WITH_WARNINGS";
type DebugLogEntry = {
  at: string;
  stage: string;
  event: "start" | "finish" | "info" | "error";
  ms?: number;
  data?: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

function capObject(input: Record<string, unknown>, maxChars = 4000): Record<string, unknown> {
  try {
    const s = JSON.stringify(input);
    if (s.length <= maxChars) return input;
    return { ...input, _truncated: true };
  } catch {
    return { _unserializable: true };
  }
}

async function appendDebugLog(docId: string, entry: DebugLogEntry) {
  const doc = await prisma.setupDocument.findUnique({
    where: { id: docId },
    select: { importDebugLogJson: true },
  });
  const cur = Array.isArray(doc?.importDebugLogJson) ? (doc!.importDebugLogJson as unknown[]) : [];
  const next = [...cur, entry];
  const capped = next.length > 80 ? next.slice(next.length - 80) : next;
  await prisma.setupDocument.update({
    where: { id: docId },
    data: { importDebugLogJson: capped as unknown as object },
  });
}

async function startStage(input: {
  docId: string;
  stage: string;
  status?: ImportStatus;
  extra?: Record<string, unknown>;
}) {
  const tail = input.extra ? ` ${JSON.stringify(input.extra)}` : "";
  console.log(`[setup-import] doc=${input.docId} stage=${input.stage} start${tail}`);
  await appendDebugLog(input.docId, {
    at: nowIso(),
    stage: input.stage,
    event: "start",
    data: input.extra ? capObject(input.extra) : undefined,
  });
  await prisma.setupDocument.update({
    where: { id: input.docId },
    data: {
      importStatus: input.status,
      currentStage: input.stage,
      stageStartedAt: new Date(),
      stageFinishedAt: null,
    },
  });
}

async function finishStage(input: {
  docId: string;
  stage: string;
  status?: ImportStatus;
  ms?: number;
  extra?: Record<string, unknown>;
}) {
  const tail = input.extra ? ` ${JSON.stringify(input.extra)}` : "";
  console.log(`[setup-import] doc=${input.docId} stage=${input.stage} finish${tail}`);
  await appendDebugLog(input.docId, {
    at: nowIso(),
    stage: input.stage,
    event: "finish",
    ms: input.ms,
    data: input.extra ? capObject(input.extra) : undefined,
  });
  await prisma.setupDocument.update({
    where: { id: input.docId },
    data: {
      importStatus: input.status,
      lastCompletedStage: input.stage,
      stageFinishedAt: new Date(),
    },
  });
}

async function failImport(input: { docId: string; stage: string; error: unknown }) {
  const msg = input.error instanceof Error ? input.error.message : String(input.error);
  console.error(`[setup-import] doc=${input.docId} FAILED stage=${input.stage} error=${msg}`);
  await appendDebugLog(input.docId, {
    at: nowIso(),
    stage: input.stage,
    event: "error",
    data: { error: msg.slice(0, 2000) },
  });
  await prisma.setupDocument.update({
    where: { id: input.docId },
    data: {
      importStatus: "FAILED",
      importOutcome: "PARTIAL_DIAGNOSTIC",
      currentStage: input.stage,
      importErrorMessage: msg.slice(0, 2000),
      stageFinishedAt: new Date(),
      parseFinishedAt: new Date(),
      // Keep parseStatus explicit: failed import is not a trusted parse.
      parseStatus: "PARTIAL",
    },
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`Timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

const procDbg = () => process.env.DEBUG_SETUP_PROCESS_TIMING === "1";

export async function processSetupDocumentImport(input: { docId: string; userId: string }) {
  const tAll = procDbg() ? performance.now() : 0;
  const doc = await prisma.setupDocument.findFirst({
    where: { id: input.docId, userId: input.userId },
    select: {
      id: true,
      userId: true,
      originalFilename: true,
      storagePath: true,
      mimeType: true,
      sourceType: true,
      calibrationProfileId: true,
    },
  });
  if (!doc) throw new Error("Setup document not found");
  if (procDbg()) console.log(`[setup-process-timing] doc=${doc.id} after initial findFirst`);

  let stage: SetupDocumentImportStage = SetupDocumentImportStages.UPLOAD_RECEIVED;
  await prisma.setupDocument.update({
    where: { id: doc.id },
    data: {
      importStatus: "PROCESSING",
      parseStartedAt: new Date(),
      parseFinishedAt: null,
      importErrorMessage: null,
    },
  });

  try {
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.UPLOAD_RECEIVED, status: "PROCESSING" });
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.UPLOAD_RECEIVED, status: "PROCESSING" });

    const tLoad = procDbg() ? performance.now() : 0;
    const file = await loadSetupDocumentFileFromStorage({
      storagePath: doc.storagePath,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
    });
    if (procDbg()) {
      console.log(`[setup-process-timing] doc=${doc.id} loadSetupDocumentFileFromStorage ${(performance.now() - tLoad).toFixed(1)}ms bytes=${file.size}`);
    }
    const sourceType = doc.sourceType ?? sourceTypeFromMime(doc.mimeType);
    stage = SetupDocumentImportStages.PDF_LOADED;
    await startStage({
      docId: doc.id,
      stage,
      status: "PROCESSING",
      extra: { filename: doc.originalFilename, mimeType: doc.mimeType, sourceType },
    });
    await finishStage({ docId: doc.id, stage, status: "PROCESSING" });

    const tCal = procDbg() ? performance.now() : 0;
    const effectiveCalibration = await getEffectiveCalibrationProfileId({
      userId: doc.userId,
      storedCalibrationId: doc.calibrationProfileId,
      context: `setupDocumentImport:${doc.id}:${doc.originalFilename}`,
    });
    if (procDbg()) {
      console.log(`[setup-process-timing] doc=${doc.id} getEffectiveCalibrationProfileId ${(performance.now() - tCal).toFixed(1)}ms`);
    }
    if (!effectiveCalibration.calibrationId) {
      await prisma.setupDocument.update({
        where: { id: doc.id },
        data: {
          importStatus: "PENDING",
          parseStatus: "PENDING",
          currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
          calibrationResolvedProfileId: null,
          calibrationResolvedSource: effectiveCalibration.source,
          calibrationResolvedDebug: effectiveCalibration.debug,
          calibrationUsedIsForcedDefault: false,
        },
      });
      await appendDebugLog(doc.id, {
        at: nowIso(),
        stage: SetupDocumentImportStages.AWAITING_CALIBRATION,
        event: "info",
        data: { message: "No calibration selected. Waiting for explicit calibration selection." },
      });
      return;
    }
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        calibrationResolvedProfileId: effectiveCalibration.calibrationId,
        calibrationResolvedSource: effectiveCalibration.source,
        calibrationResolvedDebug: effectiveCalibration.debug,
        calibrationUsedIsForcedDefault: false,
        // Keep sticky calibration in sync only when an effective calibration exists.
        calibrationProfileId:
          !doc.calibrationProfileId && effectiveCalibration.calibrationId
            ? effectiveCalibration.calibrationId
            : undefined,
      },
    });
    stage = SetupDocumentImportStages.CALIBRATION_SELECTED;
    await startStage({
      docId: doc.id,
      stage,
      status: "PROCESSING",
      extra: {
        calibrationProfileId: effectiveCalibration.calibrationId ?? null,
        calibrationSource: effectiveCalibration.source,
        usedForcedDefault: false,
      },
    });
    await finishStage({ docId: doc.id, stage, status: "PROCESSING" });

    // Basic parse (OCR/text extraction + heuristics). For PDF + calibration, skip: extractPdfRawDataFromFile already
    // runs pdf-lib + pdf2json as needed — parseSetupDocumentFile would duplicate a full pdf2json text pass (~10–40s).
    const skipBasicPdfForCalibration = sourceType === "PDF" && Boolean(effectiveCalibration.calibrationId);
    const tBasic = procDbg() ? performance.now() : 0;
    let basic: SetupDocumentParsedResult;
    if (skipBasicPdfForCalibration) {
      basic = {
        parserType: "awesomatix_v1",
        parseStatus: "PARTIAL",
        extractedText: null,
        parsedData: {},
        note: "Basic text parse skipped when calibration runs; see calibration pipeline for extraction.",
        mappedFieldKeys: [],
        mappedFieldCount: 0,
      };
      if (procDbg()) {
        console.log(`[setup-process-timing] doc=${doc.id} parseSetupDocumentFile SKIPPED (PDF+calibration) 0ms`);
      }
    } else {
      basic = await withTimeout(
        parseSetupDocumentFile({
          file,
          sourceType,
          debug: {
            docId: doc.id,
            filename: doc.originalFilename,
            onStage: async (s, e) => {
              if (e === "start") await startStage({ docId: doc.id, stage: `parser:${s}`, status: "PROCESSING" });
              else await finishStage({ docId: doc.id, stage: `parser:${s}`, status: "PROCESSING" });
            },
            onInfo: async (s, data) => {
              await appendDebugLog(doc.id, { at: nowIso(), stage: `parser:${s}`, event: "info", data: capObject(data ?? {}) });
            },
          },
        }),
        25000,
        "parseSetupDocumentFile"
      );
      if (procDbg()) {
        console.log(`[setup-process-timing] doc=${doc.id} parseSetupDocumentFile ${(performance.now() - tBasic).toFixed(1)}ms`);
      }
    }
    stage = SetupDocumentImportStages.RAW_FORM_FIELDS_EXTRACTED;
    await startStage({
      docId: doc.id,
      stage,
      status: "PROCESSING",
      extra: {
        parserType: basic.parserType,
        parseStatus: basic.parseStatus,
        mappedFieldCount: basic.mappedFieldCount,
        ...(skipBasicPdfForCalibration ? { skippedBasicPdfParse: true } : {}),
      },
    });
    await finishStage({ docId: doc.id, stage, status: "PROCESSING" });

    stage = SetupDocumentImportStages.NORMALIZATION_STARTED;
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.NORMALIZATION_STARTED, status: "PROCESSING" });
    let normalizedParsedData = normalizeParsedSetupData(basic.parsedData);
    stage = SetupDocumentImportStages.NORMALIZATION_COMPLETED;
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.NORMALIZATION_STARTED, status: "PROCESSING" });
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.NORMALIZATION_COMPLETED, status: "PROCESSING" });
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.NORMALIZATION_COMPLETED, status: "PROCESSING" });

    // Persist non-destructive base parse so the document is inspectable even if calibration mapping fails.
    const tBaseDb = procDbg() ? performance.now() : 0;
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        parserType: basic.parserType,
        parseStatus: basic.parseStatus,
        extractedText: basic.extractedText,
        parsedDataJson: (normalizedParsedData ?? {}) as object,
        parsedSetupManuallyEdited: false,
      },
    });
    if (procDbg()) {
      console.log(`[setup-process-timing] doc=${doc.id} prisma base parse persist ${(performance.now() - tBaseDb).toFixed(1)}ms`);
    }

    // Calibration parse for PDFs (more accurate).
    if (sourceType === "PDF" && effectiveCalibration.calibrationId) {
      const calRow = await prisma.setupSheetCalibration.findFirst({
        where: { id: effectiveCalibration.calibrationId },
        select: { calibrationDataJson: true, name: true },
      });
      if (!calRow) throw new Error(`Calibration not found: ${effectiveCalibration.calibrationId}`);

      // Extract once, then map calibrations against the extracted dataset (no PDF re-read during mapping).
      const tExtract = procDbg() ? performance.now() : 0;
      const raw = await withTimeout(
        extractPdfRawDataFromFile({
          file,
          calibrationDataJsonForMeta: calRow.calibrationDataJson,
          onStage: async (s, e, data) => {
            const label = `pdf_extract:${s}`;
            if (e === "start") {
              stage = label as any;
              await startStage({ docId: doc.id, stage: label, status: "PROCESSING" });
            } else {
              await finishStage({ docId: doc.id, stage: label, status: "PROCESSING", extra: data });
            }
          },
        }),
        30000,
        "extractPdfRawDataFromFile"
      );
      if (procDbg()) {
        console.log(
          `[setup-process-timing] doc=${doc.id} extractPdfRawDataFromFile ${(performance.now() - tExtract).toFixed(1)}ms mode=${raw.extractionMode} pages=${raw.pageCount} tokens=${raw.tokenCount}`
        );
      }

      await prisma.setupDocument.update({
        where: { id: doc.id },
        data: {
          importDiagnosticJson: {
            kind: "pdf_import_diagnostic_v1",
            filename: doc.originalFilename,
            pageCount: raw.pageCount,
            tokenCount: raw.tokenCount,
            hasFormFields: raw.hasFormFields,
            pdfFieldCount: raw.formFields.fields.length,
            pdfFieldNamesSample: raw.formFields.fields.map((f) => f.name).slice(0, 80),
            pdfFieldLoadError: raw.formFields.loadError ?? null,
            extractionMode: raw.extractionMode,
            extractionReason: raw.extractionReason,
            textExtractionFailure: raw.textExtractionFailure ?? null,
            calibrationAttemptedId: effectiveCalibration.calibrationId,
            calibrationAttemptedName: calRow.name,
          } as object,
        },
      });

      stage = SetupDocumentImportStages.FIELD_MAPPING_STARTED;
      await startStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_STARTED, status: "PROCESSING" });

      const tMap = procDbg() ? performance.now() : 0;
      const mapped = await withTimeout(
        mapExtractedPdfWithCalibration({
          extracted: raw,
          calibrationDataJson: calRow.calibrationDataJson,
          calibrationProfileId: effectiveCalibration.calibrationId,
          onStage: async (s, e, data) => {
            const label = `pdf_map:${s}`;
            if (e === "start") {
              stage = label as any;
              await startStage({ docId: doc.id, stage: label, status: "PROCESSING" });
            } else {
              await finishStage({ docId: doc.id, stage: label, status: "PROCESSING", extra: data });
            }
          },
        }),
        25000,
        "mapExtractedPdfWithCalibration"
      );
      if (procDbg()) {
        console.log(
          `[setup-process-timing] doc=${doc.id} mapExtractedPdfWithCalibration ${(performance.now() - tMap).toFixed(1)}ms importedKeys=${mapped.importedKeys.length}`
        );
      }

      normalizedParsedData = normalizeParsedSetupData(mapped.parsedData);
      const pipelineWarnings = mapped.diagnostic?.pipelineWarnings ?? [];
      const hasWarnings =
        (mapped.diagnostic?.unmatched?.expectedFormKeys?.length ?? 0) > 0
        || (mapped.diagnostic?.unmatched?.expectedTextKeys?.length ?? 0) > 0
        || (mapped.diagnostic?.unmatched?.expectedRegionKeys?.length ?? 0) > 0
        || pipelineWarnings.length > 0
        || raw.textExtractionFailure != null;

      const calibrationParseStatus =
        mapped.importedKeys.length >= 10 ? "PARSED" : mapped.importedKeys.length > 0 ? "PARTIAL" : "FAILED";

      await prisma.setupDocument.update({
        where: { id: doc.id },
        data: {
          parseStatus: calibrationParseStatus,
          importDiagnosticJson: {
            kind: "pdf_import_diagnostic_v1",
            filename: doc.originalFilename,
            pageCount: raw.pageCount,
            tokenCount: raw.tokenCount,
            hasFormFields: raw.hasFormFields,
            pdfFieldCount: raw.formFields.fields.length,
            pdfFieldNamesSample: raw.formFields.fields.map((f) => f.name).slice(0, 80),
            pdfFieldLoadError: raw.formFields.loadError ?? null,
            calibrationAttemptedId: effectiveCalibration.calibrationId,
            calibrationAttemptedName: calRow.name,
            extractionMode: raw.extractionMode,
            extractionReason: raw.extractionReason,
            textExtractionFailure: raw.textExtractionFailure ?? null,
            mapping: mapped.diagnostic,
          } as object,
          importOutcome: hasWarnings ? "COMPLETED_WITH_WARNINGS" : "COMPLETED_TRUSTED",
        },
      });
      stage = SetupDocumentImportStages.FIELD_MAPPING_COMPLETED;
      await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_STARTED, status: "PROCESSING" });
      await startStage({
        docId: doc.id,
        stage,
        status: "PROCESSING",
        extra: { calibrationName: calRow.name, importedKeys: mapped.importedKeys.length, formDebugRows: mapped.formImportDebug?.length ?? 0 },
      });
      await finishStage({ docId: doc.id, stage, status: "PROCESSING" });
    } else if (sourceType === "PDF") {
      // No selected calibration: keep normalized basic parse and leave parsedCalibrationProfileId unset.
      await prisma.setupDocument.update({
        where: { id: doc.id },
        data: {
          importDiagnosticJson: {
            kind: "pdf_import_diagnostic_v1",
            filename: doc.originalFilename,
            calibrationAttemptedId: null,
            calibrationAttemptedName: null,
            note: "No calibration selected; skipped calibration mapping.",
          } as object,
          importOutcome: "PARTIAL_DIAGNOSTIC",
        },
      });
    } else {
      // For images we only have basic parsing right now; still mark mapping stages.
      stage = SetupDocumentImportStages.FIELD_MAPPING_STARTED;
      await startStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_STARTED, status: "PROCESSING" });
      stage = SetupDocumentImportStages.FIELD_MAPPING_COMPLETED;
      await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_STARTED, status: "PROCESSING" });
      await startStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_COMPLETED, status: "PROCESSING" });
      await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.FIELD_MAPPING_COMPLETED, status: "PROCESSING" });
    }

    stage = SetupDocumentImportStages.DERIVED_FIELDS_STARTED;
    const tDer = procDbg() ? performance.now() : 0;
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.DERIVED_FIELDS_STARTED, status: "PROCESSING" });
    normalizedParsedData = applyDerivedFieldsToSnapshot(normalizedParsedData);
    if (procDbg()) console.log(`[setup-process-timing] doc=${doc.id} derived snapshot ${(performance.now() - tDer).toFixed(1)}ms`);
    stage = SetupDocumentImportStages.DERIVED_FIELDS_COMPLETED;
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.DERIVED_FIELDS_STARTED, status: "PROCESSING" });
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.DERIVED_FIELDS_COMPLETED, status: "PROCESSING" });
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.DERIVED_FIELDS_COMPLETED, status: "PROCESSING" });

    stage = SetupDocumentImportStages.DATABASE_SAVE_STARTED;
    const tFinalDb = procDbg() ? performance.now() : 0;
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.DATABASE_SAVE_STARTED, status: "PROCESSING" });
    const { diagnostics: derivedDiagnostics } = computeA800rrDerived(normalizedParsedData);
    const derivedStatuses = computeDetailedDerivedFieldStatuses(normalizedParsedData, derivedDiagnostics);
    const existingDiag = await prisma.setupDocument.findUnique({
      where: { id: doc.id },
      select: { importDiagnosticJson: true },
    });
    const diagnosticBase =
      existingDiag?.importDiagnosticJson && typeof existingDiag.importDiagnosticJson === "object"
        ? (existingDiag.importDiagnosticJson as Record<string, unknown>)
        : {};
    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        parsedDataJson: (normalizedParsedData ?? {}) as object,
        parsedSetupManuallyEdited: false,
        parsedCalibrationProfileId: effectiveCalibration.calibrationId,
        parsedAt: new Date(),
        importDiagnosticJson: {
          ...diagnosticBase,
          derivedFields: {
            ...(typeof diagnosticBase.derivedFields === "object" && diagnosticBase.derivedFields != null
              ? (diagnosticBase.derivedFields as Record<string, unknown>)
              : {}),
            statuses: derivedStatuses,
            formulaImplemented: true,
            strategy: "a800rr_spring_lookup_table_v1",
            validation: derivedDiagnostics.validation,
            importedDisplay: derivedDiagnostics.importedDisplay,
            computed: derivedDiagnostics.computed,
            resolutionHints: derivedDiagnostics.resolutionHints,
            springFrontResolution: derivedDiagnostics.springFrontResolution,
            springRearResolution: derivedDiagnostics.springRearResolution,
            inputs: derivedDiagnostics.inputs,
          },
        } as object,
      },
    });
    if (procDbg()) {
      console.log(`[setup-process-timing] doc=${doc.id} prisma final parsedData+diagnostic ${(performance.now() - tFinalDb).toFixed(1)}ms`);
    }
    stage = SetupDocumentImportStages.DATABASE_SAVE_COMPLETED;
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.DATABASE_SAVE_STARTED, status: "PROCESSING" });
    await startStage({ docId: doc.id, stage: SetupDocumentImportStages.DATABASE_SAVE_COMPLETED, status: "PROCESSING" });
    await finishStage({ docId: doc.id, stage: SetupDocumentImportStages.DATABASE_SAVE_COMPLETED, status: "PROCESSING" });

    const outcomeRow = await prisma.setupDocument.findUnique({
      where: { id: doc.id },
      select: { importOutcome: true },
    });
    const outcome = outcomeRow?.importOutcome ?? "COMPLETED_TRUSTED";
    const completedWithWarnings =
      outcome === "COMPLETED_WITH_WARNINGS"
      || outcome === "PARTIAL_DIAGNOSTIC";

    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        importStatus: completedWithWarnings ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        currentStage: SetupDocumentImportStages.PARSE_FINISHED_SUCCESSFULLY,
        parseFinishedAt: new Date(),
        importOutcome: outcome,
      },
    });
    console.log(`[setup-import] doc=${doc.id} completed`);
    if (procDbg()) console.log(`[setup-process-timing] doc=${doc.id} TOTAL ${(performance.now() - tAll).toFixed(1)}ms`);
  } catch (e) {
    await failImport({
      docId: doc.id,
      stage: String(stage),
      error: e,
    });
    throw e;
  }
}

