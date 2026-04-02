import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseSetupDocumentFile } from "@/lib/setupDocuments/parser";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { readBytesFromStorageRef, sourceTypeFromMime } from "@/lib/setupDocuments/storage";
import { ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { applyCalibrationToPdf } from "@/lib/setupCalibrations/extract";
import { applyDerivedFieldsToSnapshot } from "@/lib/setup/deriveRenderValues";
import { computeA800rrDerived } from "@/lib/setupCalculations/a800rrDerived";
import { computeDetailedDerivedFieldStatuses } from "@/lib/setup/derivedFields";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      storagePath: true,
      originalFilename: true,
      mimeType: true,
      sourceType: true,
      calibrationProfileId: true,
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readBytesFromStorageRef(doc.storagePath);
  const file = new File([new Uint8Array(bytes)], doc.originalFilename || "setup.pdf", {
    type: doc.mimeType || "application/pdf",
  });
  const sourceType = sourceTypeFromMime(doc.mimeType || "application/pdf");
  const effective = await ensureSetupDocumentCalibrationProfileId({
    userId: user.id,
    setupDocumentId: doc.id,
  });

  let parsed = await parseSetupDocumentFile({ file, sourceType });
  let normalized = normalizeParsedSetupData(parsed.parsedData);
  if (sourceType === "PDF" && effective.calibrationId) {
    const calRow = await prisma.setupSheetCalibration.findFirst({
      where: { id: effective.calibrationId },
      select: { calibrationDataJson: true, name: true },
    });
    if (!calRow) {
      return NextResponse.json({ error: `Calibration not found: ${effective.calibrationId}` }, { status: 500 });
    }
    const extracted = await applyCalibrationToPdf({ file, calibrationDataJson: calRow.calibrationDataJson });
    normalized = normalizeParsedSetupData(extracted.parsedData);
    parsed = {
      ...parsed,
      parseStatus: "PARTIAL",
      note: `calibrated reparse: ${calRow.name} · ${effective.calibrationId} (${effective.source})`,
    };
  } else if (sourceType === "PDF") {
    parsed = {
      ...parsed,
      note: "No calibration selected; performed base reparse only.",
    };
  }
  normalized = applyDerivedFieldsToSnapshot(normalized);
  const { diagnostics: derivedDiagnostics } = computeA800rrDerived(normalized);
  const derivedStatuses = computeDetailedDerivedFieldStatuses(normalized, derivedDiagnostics);

  const updated = await prisma.setupDocument.updateMany({
    where: { id: doc.id, userId: user.id },
    data: {
      parserType: parsed.parserType,
      parseStatus: parsed.parseStatus,
      extractedText: parsed.extractedText,
      parsedDataJson: normalized as object,
      importDiagnosticJson: {
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
      calibrationProfileId: effective.calibrationId ?? undefined,
      parsedCalibrationProfileId: effective.calibrationId,
      parsedAt: new Date(),
      parsedSetupManuallyEdited: false,
    },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = await prisma.setupDocument.findFirst({
    where: { id: doc.id, userId: user.id },
    select: { id: true, parseStatus: true, updatedAt: true },
  });

  return NextResponse.json({
    document: row,
    mappedFieldCount: parsed.mappedFieldCount,
    mappedFieldKeys: parsed.mappedFieldKeys,
    extractedTextLength: (parsed.extractedText ?? "").length,
    parserNote: parsed.note,
    calibrationUsed: effective,
  });
}

