import "server-only";

import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { applyCalibrationToPdf } from "@/lib/setupCalibrations/extract";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { snapshotValueIsEffectivelyEmpty } from "@/lib/runSetup";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { computeA800rrDerived } from "@/lib/setupCalculations/a800rrDerived";
import { computeDetailedDerivedFieldStatuses } from "@/lib/setup/derivedFields";

export type ApplyCalibrationToDocumentResult =
  | {
      ok: true;
      importedKeys: string[];
      formImportDebug: unknown;
      mergedData: Record<string, unknown>;
    }
  | { ok: false; error: string };

/**
 * Applies a calibration profile to a stored setup PDF: extract → normalize → merge → derived fields → persist.
 * Shared by single-document apply-calibration API and bulk import parse.
 */
export async function applyCalibrationToSetupDocument(input: {
  docId: string;
  userId: string;
  calibrationId: string;
  /** merge: fill empty keys only (library default). replace: fresh extract overwrites prior parsed snapshot (bulk try-calibrations). */
  parsedDataMerge?: "merge" | "replace";
}): Promise<ApplyCalibrationToDocumentResult> {
  const mergeMode = input.parsedDataMerge ?? "merge";
  const [doc, calibration] = await Promise.all([
    prisma.setupDocument.findFirst({
      where: { id: input.docId, userId: input.userId },
      select: {
        id: true,
        storagePath: true,
        originalFilename: true,
        mimeType: true,
        parsedDataJson: true,
        importDiagnosticJson: true,
      },
    }),
    prisma.setupSheetCalibration.findFirst({
      where: { id: input.calibrationId, userId: input.userId },
      select: { id: true, calibrationDataJson: true },
    }),
  ]);

  if (!doc) return { ok: false, error: "Document not found" };
  if (!calibration) return { ok: false, error: "Calibration not found" };
  if (doc.mimeType !== "application/pdf") {
    return { ok: false, error: "Calibration import supports PDF only." };
  }

  try {
    const bytes = await readBytesFromStorageRef(doc.storagePath);
    const file = new File([new Uint8Array(bytes)], doc.originalFilename || "setup.pdf", {
      type: doc.mimeType || "application/pdf",
    });
    const extracted = await applyCalibrationToPdf({ file, calibrationDataJson: calibration.calibrationDataJson });
    const normalizedIncoming = normalizeParsedSetupData(extracted.parsedData);
    const existing = normalizeParsedSetupData(doc.parsedDataJson ?? {});
    const merged =
      mergeMode === "replace"
        ? { ...normalizedIncoming }
        : (() => {
            const out = { ...existing };
            for (const [k, v] of Object.entries(normalizedIncoming)) {
              if (snapshotValueIsEffectivelyEmpty(out[k])) out[k] = v;
            }
            return out;
          })();
    const mergedWithDerived = applyDerivedFieldsToSnapshot(merged);
    const { diagnostics: derivedDiagnostics } = computeA800rrDerived(mergedWithDerived);
    const derivedStatuses = computeDetailedDerivedFieldStatuses(mergedWithDerived, derivedDiagnostics);

    await prisma.setupDocument.update({
      where: { id: doc.id },
      data: {
        calibrationProfileId: input.calibrationId,
        parsedDataJson: mergedWithDerived as object,
        parseStatus: "PARTIAL",
        parsedCalibrationProfileId: input.calibrationId,
        parsedAt: new Date(),
        parsedSetupManuallyEdited: false,
        importDiagnosticJson: {
          ...(mergeMode === "replace"
            ? {}
            : doc.importDiagnosticJson && typeof doc.importDiagnosticJson === "object"
              ? (doc.importDiagnosticJson as Record<string, unknown>)
              : {}),
          derivedFields: {
            strategy: "a800rr_spring_lookup_table_v1",
            formulaImplemented: true,
            statuses: derivedStatuses,
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

    return {
      ok: true,
      importedKeys: extracted.importedKeys,
      formImportDebug: extracted.formImportDebug,
      mergedData: mergedWithDerived as Record<string, unknown>,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
