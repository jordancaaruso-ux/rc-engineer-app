import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { renderSetupPdfSnapshot } from "@/lib/setup/pdfRender";
import { SETUP_PDF_RENDER_PIPELINE_VERSION } from "@/lib/setup/renderTypes";
import { getEffectiveCalibrationProfileId, ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { buildDerivedRenderPatch } from "@/lib/setup/deriveRenderValues";
import {
  readBytesFromStorageRef,
  storeRunRenderedSetupPdf,
  storeSetupSnapshotRenderedSetupPdf,
  storageRefIsReadable,
} from "@/lib/setupDocuments/storage";

/**
 * Resolves base PDF + calibration when Run rows predate source links:
 * walks setupSnapshot.baseSetupSnapshotId chain and finds a SetupDocument whose createdSetupId matches.
 */
async function resolvePdfSourceForRun(
  userId: string,
  run: {
    setupSnapshot: { baseSetupSnapshotId: string | null; data: unknown };
    sourceSetupDocumentId: string | null;
    sourceSetupCalibrationId: string | null;
  }
): Promise<{
  document: { id: string; storagePath: string; sourceType: string; mimeType: string };
  calibration: { id: string; calibrationDataJson: unknown };
} | null> {
  let doc =
    run.sourceSetupDocumentId != null
      ? await prisma.setupDocument.findFirst({
          where: { id: run.sourceSetupDocumentId, userId },
          select: { id: true, storagePath: true, sourceType: true, mimeType: true, calibrationProfileId: true },
        })
      : null;

  if (!doc || doc.sourceType !== "PDF") {
    let baseId: string | null = run.setupSnapshot.baseSetupSnapshotId;
    const seen = new Set<string>();
    while (baseId && !seen.has(baseId)) {
      seen.add(baseId);
      const found = await prisma.setupDocument.findFirst({
        where: { userId, createdSetupId: baseId },
        select: { id: true, storagePath: true, sourceType: true, mimeType: true, calibrationProfileId: true },
      });
      if (found && found.sourceType === "PDF") {
        doc = found;
        break;
      }
      const parent = await prisma.setupSnapshot.findUnique({
        where: { id: baseId },
        select: { baseSetupSnapshotId: true },
      });
      baseId = parent?.baseSetupSnapshotId ?? null;
    }
  }

  if (!doc || doc.sourceType !== "PDF") return null;

  // Sticky calibration: prefer run.sourceSetupCalibrationId; else document.calibrationProfileId.
  const ensuredDocCal = await ensureSetupDocumentCalibrationProfileId({
    userId,
    setupDocumentId: doc.id,
  });
  const effective = await getEffectiveCalibrationProfileId({
    userId,
    explicitCalibrationId: run.sourceSetupCalibrationId,
    storedCalibrationId: ensuredDocCal.calibrationId,
    context: `runPdf:runCal/docCal runCal=${run.sourceSetupCalibrationId ?? "null"} doc=${doc.id}`,
  });
  if (!effective.calibrationId) return null;

  const cal = await prisma.setupSheetCalibration.findFirst({
    where: { id: effective.calibrationId },
    select: { id: true, calibrationDataJson: true, name: true },
  });
  if (!cal?.calibrationDataJson) return null;

  console.log(
    `[run-setup-pdf/resolve] doc=${doc.id} calibration=${cal.id} (${cal.name ?? "cal"}) source=${effective.source}`
  );
  try {
    const calNorm = (cal.calibrationDataJson ?? {}) as unknown;
    // NOTE: lightweight debug: print spring-related mapping keys so we can wire derived values correctly.
    const { normalizeCalibrationData } = await import("@/lib/setupCalibrations/types");
    const parsed = normalizeCalibrationData(calNorm);
    const keys = [
      ...Object.keys(parsed.fields ?? {}),
      ...Object.keys(parsed.formFieldMappings ?? {}),
    ];
    const springKeys = keys.filter((k) => /spring/i.test(k) && /(gf|rate)/i.test(k)).slice(0, 30);
    if (springKeys.length) {
      console.log(`[run-setup-pdf/calibration-keys] ${springKeys.join(", ")}`);
    }
  } catch {
    /* ignore debug */
  }

  return { document: doc, calibration: cal };
}

/**
 * Resolves base PDF + calibration for a {@link SetupSnapshot} without a run: document whose
 * `createdSetupId` matches the snapshot, or the same baseline walk as runs.
 */
async function resolvePdfSourceForSetupSnapshot(
  userId: string,
  setupSnapshotId: string
): Promise<{
  document: { id: string; storagePath: string; sourceType: string; mimeType: string };
  calibration: { id: string; calibrationDataJson: unknown; name: string | null };
} | null> {
  let currentId: string | null = setupSnapshotId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const createdDoc = await prisma.setupDocument.findFirst({
      where: { userId, createdSetupId: currentId, sourceType: "PDF" },
      select: { id: true, storagePath: true, sourceType: true, mimeType: true, calibrationProfileId: true },
    });
    if (createdDoc) {
      const ensuredDocCal = await ensureSetupDocumentCalibrationProfileId({
        userId,
        setupDocumentId: createdDoc.id,
      });
      const effective = await getEffectiveCalibrationProfileId({
        userId,
        storedCalibrationId: ensuredDocCal.calibrationId,
        context: `setupSnapshotPdf:doc=${createdDoc.id}`,
      });
      if (!effective.calibrationId) return null;
      const cal = await prisma.setupSheetCalibration.findFirst({
        where: { id: effective.calibrationId },
        select: { id: true, calibrationDataJson: true, name: true },
      });
      if (!cal?.calibrationDataJson) return null;
      return { document: createdDoc, calibration: cal };
    }
    const nextBase: { baseSetupSnapshotId: string | null } | null = await prisma.setupSnapshot.findFirst({
      where: { id: currentId, userId },
      select: { baseSetupSnapshotId: true },
    });
    currentId = nextBase?.baseSetupSnapshotId ?? null;
  }
  return null;
}

/**
 * Filled setup PDF for a stored snapshot (lazy cache on {@link SetupSnapshot}).
 * Same render pipeline as {@link ensureRenderedRunSetupPdf} but keyed by snapshot id.
 */
export async function ensureRenderedSetupSnapshotPdf(params: {
  userId: string;
  setupSnapshotId: string;
}): Promise<{ relativePath: string; cacheHit: boolean } | null> {
  const snap = await prisma.setupSnapshot.findFirst({
    where: { id: params.setupSnapshotId, userId: params.userId },
    select: {
      id: true,
      data: true,
      renderedSetupPdfPath: true,
      setupPdfRenderVersion: true,
    },
  });
  if (!snap) return null;

  if (snap.renderedSetupPdfPath && snap.setupPdfRenderVersion === SETUP_PDF_RENDER_PIPELINE_VERSION) {
    const ok = await storageRefIsReadable(snap.renderedSetupPdfPath);
    if (ok) {
      return { relativePath: snap.renderedSetupPdfPath, cacheHit: true };
    }
  }

  const resolved = await resolvePdfSourceForSetupSnapshot(params.userId, snap.id);
  if (!resolved) return null;

  let baseBytes: Buffer;
  try {
    baseBytes = await readBytesFromStorageRef(resolved.document.storagePath);
  } catch {
    return null;
  }

  const setupValues = normalizeSetupData(snap.data);
  const derivedPatch = buildDerivedRenderPatch({
    setup: setupValues,
    calibrationJson: resolved.calibration.calibrationDataJson,
  });
  const renderSetupValues = { ...setupValues } as Record<string, unknown>;
  for (const k of derivedPatch.clear) delete renderSetupValues[k];
  for (const [k, v] of Object.entries(derivedPatch.set)) renderSetupValues[k] = v;

  if (derivedPatch.debug.length) {
    console.log(`[setup-snapshot-pdf/derived] snapshot=${snap.id} ${derivedPatch.debug.join(" | ")}`);
  }

  const rendered = await renderSetupPdfSnapshot({
    basePdfBytes: baseBytes,
    calibrationJson: resolved.calibration.calibrationDataJson,
    setupValues: renderSetupValues as unknown as SetupSnapshotData,
  });
  if (!rendered) return null;

  const storageRef = await storeSetupSnapshotRenderedSetupPdf(snap.id, Buffer.from(rendered.pdfBytes));

  await prisma.setupSnapshot.update({
    where: { id: snap.id },
    data: {
      renderedSetupPdfPath: storageRef,
      renderedSetupPdfGeneratedAt: new Date(),
      setupPdfRenderVersion: rendered.pipelineVersion,
    },
  });

  return { relativePath: storageRef, cacheHit: false };
}

/**
 * Ensures a derived PDF exists for this run (lazy cache). Same bytes served for in-app view and download.
 * Returns storage ref (public path or Blob URL) or null if no PDF base + calibration could be resolved.
 */
export async function ensureRenderedRunSetupPdf(params: {
  userId: string;
  runId: string;
}): Promise<{ relativePath: string; cacheHit: boolean } | null> {
  const run = await prisma.run.findFirst({
    where: { id: params.runId, userId: params.userId },
    select: {
      id: true,
      renderedSetupPdfPath: true,
      setupPdfRenderVersion: true,
      sourceSetupDocumentId: true,
      sourceSetupCalibrationId: true,
      setupSnapshot: {
        select: { baseSetupSnapshotId: true, data: true },
      },
    },
  });
  if (!run) return null;

  if (run.renderedSetupPdfPath && run.setupPdfRenderVersion === SETUP_PDF_RENDER_PIPELINE_VERSION) {
    const ok = await storageRefIsReadable(run.renderedSetupPdfPath);
    if (ok) {
      return { relativePath: run.renderedSetupPdfPath, cacheHit: true };
    }
  }

  const resolved = await resolvePdfSourceForRun(params.userId, run);
  if (!resolved) return null;

  let baseBytes: Buffer;
  try {
    baseBytes = await readBytesFromStorageRef(resolved.document.storagePath);
  } catch {
    return null;
  }

  const setupValues = normalizeSetupData(run.setupSnapshot.data);
  // Derived render values: computed from canonical setup (prevents stale imported/calculated fields).
  const derivedPatch = buildDerivedRenderPatch({
    setup: setupValues,
    calibrationJson: resolved.calibration.calibrationDataJson,
  });
  const renderSetupValues = { ...setupValues } as Record<string, unknown>;
  for (const k of derivedPatch.clear) delete renderSetupValues[k];
  for (const [k, v] of Object.entries(derivedPatch.set)) renderSetupValues[k] = v;

  if (derivedPatch.debug.length) {
    console.log(`[run-setup-pdf/derived] run=${run.id} ${derivedPatch.debug.join(" | ")}`);
  }
  const rendered = await renderSetupPdfSnapshot({
    basePdfBytes: baseBytes,
    calibrationJson: resolved.calibration.calibrationDataJson,
    setupValues: renderSetupValues as unknown as typeof setupValues,
  });
  if (!rendered) return null;

  const storageRef = await storeRunRenderedSetupPdf(run.id, Buffer.from(rendered.pdfBytes));

  await prisma.run.update({
    where: { id: run.id },
    data: {
      renderedSetupPdfPath: storageRef,
      renderedSetupPdfGeneratedAt: new Date(),
      setupPdfRenderVersion: rendered.pipelineVersion,
      ...(run.sourceSetupDocumentId == null ? { sourceSetupDocumentId: resolved.document.id } : {}),
      ...(run.sourceSetupCalibrationId == null ? { sourceSetupCalibrationId: resolved.calibration.id } : {}),
    },
  });

  return { relativePath: storageRef, cacheHit: false };
}

/** Persisted on new runs so lazy render can skip baseline chain when possible. */
export async function resolveSourcePdfLinksForNewRun(
  userId: string,
  baselineSnapshotId: string | null,
  explicitDocumentId: string | null
): Promise<{ sourceSetupDocumentId: string | null; sourceSetupCalibrationId: string | null }> {
  let docId = explicitDocumentId?.trim() || null;
  if (!docId && baselineSnapshotId) {
    const d = await prisma.setupDocument.findFirst({
      where: { userId, createdSetupId: baselineSnapshotId },
      select: { id: true, sourceType: true },
    });
    if (d?.sourceType === "PDF") docId = d.id;
    if (!docId) {
      const prevRun = await prisma.run.findFirst({
        where: { userId, setupSnapshotId: baselineSnapshotId },
        select: { sourceSetupDocumentId: true },
      });
      if (prevRun?.sourceSetupDocumentId) docId = prevRun.sourceSetupDocumentId;
    }
  }
  if (!docId) return { sourceSetupDocumentId: null, sourceSetupCalibrationId: null };

  // Sticky, non-forced calibration selection:
  // - If the document has calibrationProfileId, use it.
  // - Otherwise no calibration is selected yet.
  const ensured = await ensureSetupDocumentCalibrationProfileId({ userId, setupDocumentId: docId });
  const effective = await getEffectiveCalibrationProfileId({
    userId,
    storedCalibrationId: ensured.calibrationId,
    context: `newRun:doc:${docId}`,
  });
  return { sourceSetupDocumentId: docId, sourceSetupCalibrationId: effective.calibrationId };
}
