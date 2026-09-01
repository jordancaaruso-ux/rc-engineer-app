import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { flattenFillMappings } from "@/lib/setup/fillMappingFromCalibration";
import { unsignedGeometryValueForPaper } from "@/lib/setup/geometrySignNormalize";
import { SETUP_PDF_RENDER_PIPELINE_VERSION } from "@/lib/setup/renderTypes";
import { getEffectiveCalibrationProfileId, ensureSetupDocumentCalibrationProfileId } from "@/lib/setup/effectiveCalibration";
import { buildDerivedRenderPatch } from "@/lib/setup/deriveRenderValues";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { fillPdfForm } from "@/lib/setupDocuments/fillPdfForm";
import { blankPdfFormValues } from "@/lib/setupDocuments/pdfBlankForm";
import {
  readBytesFromStorageRef,
  storeRunRenderedSetupPdf,
  storeSetupSnapshotRenderedSetupPdf,
} from "@/lib/setupDocuments/storage";
import { A800RR_EXTRA_SIMPLE_KEYS } from "@/lib/setupSheetModels/a800rrExtraSimpleKeys";
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import { claimedWidgetsFromMappings } from "@/lib/setupSheetModels/unionDerivedWithCalibration";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * ============================ HOW A SETUP BECOMES A PDF ============================
 *
 * The manufacturer's own blank, with the driver's answers written into its form fields — see
 * `fillPdfForm`. The blank already knows how it wants to look: the font and colour of every value,
 * the mark every tick box makes. Filling it is what a viewer does when you fill the sheet in
 * Acrobat, and what comes out is still a sheet somebody can keep filling in.
 *
 * The previous engine (`pdfRender.ts`, deleted 2026-08-14) went the other way: it painted white
 * rectangles over every widget, drew the values itself, and flattened the file. That produced a
 * dead picture, it was wired to the Awesomatix readers so it only really knew one car, and it drew
 * only what a calibration named — which is a fraction of what a sheet prints.
 *
 * ============================ WHICH BLANK, AND WHY IT MATTERS ============================
 *
 * The substrate is the CHASSIS's stored blank (`SetupSheetBlank.setupDocument`), not the driver's
 * own upload. The chassis is shared and the blank outlives any one account, so every driver on that
 * car exports the same paper — and a driver who never uploaded anything (built their setup in the
 * app) gets a PDF at all, which they previously could not. The per-user document walk survives
 * below only as the fallback for a car with no chassis model.
 */

/**
 * Every PDF field a set of rules touches, across all five mapping shapes — the boxes the app is
 * about to take responsibility for, and therefore the only ones worth clearing on a driver's own
 * file. `claimedWidgetsFromMappings` answers the same question at widget granularity; clearing is
 * per FIELD, because that is the unit pdf-lib empties.
 */
function mappedFieldNames(mappings: Record<string, PdfFormFieldMappingRule>): Set<string> {
  return new Set(
    claimedWidgetsFromMappings(mappings)
      .map((w) => w.pdfFieldName)
      .filter(Boolean)
  );
}

type PdfSource = {
  /** The blank to write into. */
  bytes: Buffer;
  /** Schema key -> where it lives on that blank. Calibration rules and derived rules, merged. */
  mappings: Record<string, PdfFormFieldMappingRule>;
  /** For the derived-value patch, which still reads the calibration's own shape. */
  calibrationJson: unknown;
  /** Set only on the fallback path, so a run can back-link the document it used. */
  documentId?: string;
  calibrationId?: string;
};

/**
 * The chassis's own blank plus every mapping that points at it.
 *
 * Null when the car has no chassis model, or the chassis has no blank, or the blank's document went
 * with a deleted account — all of which mean there is no shared paper to fill, and the caller falls
 * back to the driver's own upload.
 *
 * WHICH of the chassis's sheets: the paper the setup was born on (`SetupSnapshot.sheetBlankId`),
 * else the one whose boxes speak its keys — a setup born on a rebuilt EDITION exports on that
 * edition's paper, written through that edition's own calibration. See `sheetBlankResolve`.
 */
async function resolveChassisBlankSource(
  carId: string | null,
  setupData: unknown,
  snapshotSheetBlankId: string | null
): Promise<PdfSource | null> {
  if (!carId) return null;

  const car = await prisma.car.findUnique({
    where: { id: carId },
    select: {
      setupSheetModelId: true,
      setupSheetModel: {
        select: {
          slug: true,
          defaultCalibration: { select: { calibrationDataJson: true } },
        },
      },
    },
  });
  const model = car?.setupSheetModel;
  const modelId = car?.setupSheetModelId;
  if (!model || !modelId) return null;

  const picked = await pickSheetBlankForData(modelId, normalizeSetupData(setupData), {
    sheetBlankId: snapshotSheetBlankId,
  });
  if (!picked) return null;
  const blank = await prisma.setupSheetBlank.findFirst({
    where: { id: picked.id },
    select: {
      isEdition: true,
      derivedMappingsJson: true,
      setupDocument: { select: { id: true, storagePath: true } },
    },
  });
  const storagePath = blank?.setupDocument?.storagePath;
  if (!blank || !storagePath) return null;

  let bytes: Buffer;
  try {
    /*
     * EMPTIED FIRST, ALWAYS.
     *
     * A chassis's "blank" is whichever PDF created it, and that is very often somebody's FINISHED
     * sheet — the A800RR's is the calibration's own example document. Filling it as-is prints the
     * first uploader's setup into every box the current driver left empty, and their name in the
     * name box. `sheetPageImages` clears it for the same reason before rendering the picture; the
     * full argument is in `blankPdfFormValues`.
     *
     * Nothing is lost: what that file contained was read into values at upload, so it is drawn
     * rather than printed.
     */
    const raw = await readBytesFromStorageRef(storagePath);
    bytes = Buffer.from(await blankPdfFormValues(new Uint8Array(raw)));
  } catch {
    return null;
  }

  if (blank.isEdition) {
    /*
     * The edition's own rules, which name ITS file's fields. Since editions are ALIGNED to the
     * canonical vocabulary (`alignEditionByGeometry`), the edition mirrors the primary's whole
     * architecture: calibration rules, its blank's derived mappings, and the computed boxes —
     * whose edition-side field names the align pass persists on the calibration as
     * `extraSimpleKeys` (the primary's `A800RR_EXTRA_SIMPLE_KEYS` name the original file's
     * fields, which this file does not have).
     */
    const editionCal = await prisma.setupSheetCalibration.findFirst({
      where: { setupSheetModelId: modelId, exampleDocumentId: blank.setupDocument!.id },
      select: { calibrationDataJson: true },
    });
    if (!editionCal) return null;
    const editionExtra =
      ((editionCal.calibrationDataJson as Record<string, unknown> | null)?.extraSimpleKeys ?? {}) as
        Record<string, string>;
    const editionComputedBoxes: Record<string, PdfFormFieldMappingRule> = Object.fromEntries(
      Object.entries(editionExtra).map(([key, pdfFieldName]) => [key, { pdfFieldName }])
    );
    const editionDerived = (blank.derivedMappingsJson ?? {}) as Record<
      string,
      PdfFormFieldMappingRule
    >;
    return {
      bytes,
      mappings: {
        ...editionDerived,
        ...editionComputedBoxes,
        ...(normalizeCalibrationData(editionCal.calibrationDataJson).formFieldMappings ?? {}),
      },
      calibrationJson: editionCal.calibrationDataJson,
    };
  }

  const calibrationJson = model.defaultCalibration?.calibrationDataJson ?? {};
  const calibrationMappings = normalizeCalibrationData(calibrationJson).formFieldMappings ?? {};
  const derivedMappings = (blank.derivedMappingsJson ?? {}) as Record<
    string,
    PdfFormFieldMappingRule
  >;

  /*
   * The computed boxes, added here and NOWHERE ELSE.
   *
   * Awesomatix's spring rates and final drive ratio are printed boxes whose values the app works
   * out rather than reads, which is why no calibration rule points at them and why the union pass
   * leaves them alone. They still have to reach the paper — a driver's exported sheet with the
   * spring rates blank is not their sheet. Deliberately not in `derivedMappingsJson`: putting them
   * there would make the IMPORT read them raw off an uploaded sheet and stand a stale printed
   * number in front of the computed one.
   */
  const computedBoxes: Record<string, PdfFormFieldMappingRule> =
    model.slug === "awesomatix_a800rr"
      ? Object.fromEntries(
          Object.entries(A800RR_EXTRA_SIMPLE_KEYS).map(([key, pdfFieldName]) => [key, { pdfFieldName }])
        )
      : {};

  return {
    bytes,
    // Calibration first so a named parameter always wins a key the derivation also produced.
    mappings: { ...derivedMappings, ...computedBoxes, ...calibrationMappings },
    calibrationJson,
  };
}

/** Write a driver's setup into a blank. Null when nothing about the pair is usable. */
async function fillSetupPdf(input: {
  source: PdfSource;
  data: unknown;
  debugLabel: string;
}): Promise<Uint8Array | null> {
  const setupValues = normalizeSetupData(input.data);
  // Computed render values, so a stale imported number never reaches the paper ahead of the one the
  // app works out from the canonical setup.
  const derivedPatch = buildDerivedRenderPatch({
    setup: setupValues,
    calibrationJson: input.source.calibrationJson,
  });
  const renderValues = { ...setupValues } as Record<string, unknown>;
  for (const k of derivedPatch.clear) delete renderValues[k];
  for (const [k, v] of Object.entries(derivedPatch.set)) renderValues[k] = v;

  // The same bridge the on-screen sheet uses, so a box the driver sees filled exports filled...
  const surfaceValues = storedValuesToSurface(renderValues);
  // ...except for the sign the app puts on camber and toe, which no manufacturer's sheet prints.
  // See `unsignedGeometryValueForPaper`: paper only, never storage and never the screen.
  for (const [key, value] of Object.entries(surfaceValues)) {
    surfaceValues[key] = unsignedGeometryValueForPaper(key, value);
  }
  const flat = flattenFillMappings({
    formFieldMappings: input.source.mappings,
    surfaceValues,
  });
  if (Object.keys(flat.mappings).length === 0) return null;

  const filled = await fillPdfForm({
    blank: new Uint8Array(input.source.bytes),
    mappings: flat.mappings,
    values: flat.values,
  });
  if (filled.skipped.length > 0 || filled.conflicts.length > 0) {
    console.log(
      `[setup-pdf/fill] ${input.debugLabel} wrote=${filled.written} skipped=${filled.skipped.length} conflicts=${filled.conflicts.length}`
    );
  }
  return filled.bytes;
}

/**
 * FALLBACK ONLY: the driver's own uploaded PDF, for a car with no chassis model (or whose chassis
 * has no blank). Walks `setupSnapshot.baseSetupSnapshotId` to find the SetupDocument this setup came
 * from, because Run rows predating the source links have no direct pointer.
 *
 * Its coverage is only ever what the calibration names — there are no derived mappings for a
 * one-off upload — so a sheet exported this way still has the gaps the chassis path closes. It
 * exists so those drivers get a PDF at all.
 */
async function resolveUploadedPdfSourceForRun(
  userId: string,
  run: {
    setupSnapshot: { baseSetupSnapshotId: string | null; data: unknown };
    sourceSetupDocumentId: string | null;
    sourceSetupCalibrationId: string | null;
  }
): Promise<PdfSource | null> {
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

  const mappings = normalizeCalibrationData(cal.calibrationDataJson).formFieldMappings ?? {};
  let bytes: Buffer;
  try {
    const raw = await readBytesFromStorageRef(doc.storagePath);
    bytes = Buffer.from(await blankPdfFormValues(new Uint8Array(raw), mappedFieldNames(mappings)));
  } catch {
    return null;
  }
  return {
    bytes,
    mappings,
    calibrationJson: cal.calibrationDataJson,
    documentId: doc.id,
    calibrationId: cal.id,
  };
}

/**
 * FALLBACK ONLY, the no-run twin of {@link resolveUploadedPdfSourceForRun}: the document whose
 * `createdSetupId` is this snapshot, or the same baseline walk.
 */
async function resolveUploadedPdfSourceForSetupSnapshot(
  userId: string,
  setupSnapshotId: string
): Promise<PdfSource | null> {
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
      const mappings = normalizeCalibrationData(cal.calibrationDataJson).formFieldMappings ?? {};
      let bytes: Buffer;
      try {
        const raw = await readBytesFromStorageRef(createdDoc.storagePath);
        bytes = Buffer.from(
          await blankPdfFormValues(new Uint8Array(raw), mappedFieldNames(mappings))
        );
      } catch {
        return null;
      }
      return {
        bytes,
        mappings,
        calibrationJson: cal.calibrationDataJson,
        documentId: createdDoc.id,
        calibrationId: cal.id,
      };
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
 * What a caller gets back. `bytes` is the file itself, and every caller so far wants it.
 *
 * It is returned rather than left to be fetched because proving the cache is warm MEANS
 * downloading it — `storageRefIsReadable` reads the whole object — so a caller that then called
 * `readBytesFromStorageRef` pulled the same PDF over the wire twice. That was ~300ms of the setup
 * picture's wait on every share, spent to learn something we already knew.
 */
type EnsuredPdf = { relativePath: string; cacheHit: boolean; bytes: Buffer };

/** The stored copy, kept if it is still there and still current. Null means draw it again. */
async function readCurrentRenderedPdf(
  storedPath: string | null,
  storedVersion: number | null
): Promise<Buffer | null> {
  if (!storedPath || storedVersion !== SETUP_PDF_RENDER_PIPELINE_VERSION) return null;
  try {
    return await readBytesFromStorageRef(storedPath);
  } catch {
    // A row pointing at a file that is gone is a cache miss, not an error.
    return null;
  }
}

/**
 * Filled setup PDF for a stored snapshot (lazy cache on {@link SetupSnapshot}).
 * Same render pipeline as {@link ensureRenderedRunSetupPdf} but keyed by snapshot id.
 */
export async function ensureRenderedSetupSnapshotPdf(params: {
  userId: string;
  setupSnapshotId: string;
}): Promise<EnsuredPdf | null> {
  const snap = await prisma.setupSnapshot.findFirst({
    where: { id: params.setupSnapshotId, userId: params.userId },
    select: {
      id: true,
      data: true,
      carId: true,
      sheetBlankId: true,
      renderedSetupPdfPath: true,
      setupPdfRenderVersion: true,
    },
  });
  if (!snap) return null;

  const cached = await readCurrentRenderedPdf(snap.renderedSetupPdfPath, snap.setupPdfRenderVersion);
  if (cached) {
    return { relativePath: snap.renderedSetupPdfPath!, cacheHit: true, bytes: cached };
  }

  const source =
    (await resolveChassisBlankSource(snap.carId, snap.data, snap.sheetBlankId))
    ?? (await resolveUploadedPdfSourceForSetupSnapshot(params.userId, snap.id));
  if (!source) return null;

  const bytes = await fillSetupPdf({ source, data: snap.data, debugLabel: `snapshot=${snap.id}` });
  if (!bytes) return null;

  const buffer = Buffer.from(bytes);
  const storageRef = await storeSetupSnapshotRenderedSetupPdf(snap.id, buffer);

  await prisma.setupSnapshot.update({
    where: { id: snap.id },
    data: {
      renderedSetupPdfPath: storageRef,
      renderedSetupPdfGeneratedAt: new Date(),
      setupPdfRenderVersion: SETUP_PDF_RENDER_PIPELINE_VERSION,
    },
  });

  return { relativePath: storageRef, cacheHit: false, bytes: buffer };
}

/**
 * Ensures a derived PDF exists for this run (lazy cache). Same bytes served for in-app view and download.
 * Returns storage ref (public path or Blob URL) or null if no PDF base + calibration could be resolved.
 */
export async function ensureRenderedRunSetupPdf(params: {
  userId: string;
  runId: string;
}): Promise<EnsuredPdf | null> {
  const run = await prisma.run.findFirst({
    where: { id: params.runId, userId: params.userId },
    select: {
      id: true,
      renderedSetupPdfPath: true,
      setupPdfRenderVersion: true,
      sourceSetupDocumentId: true,
      sourceSetupCalibrationId: true,
      setupSnapshot: {
        select: { baseSetupSnapshotId: true, data: true, carId: true, sheetBlankId: true },
      },
    },
  });
  if (!run) return null;

  const cached = await readCurrentRenderedPdf(run.renderedSetupPdfPath, run.setupPdfRenderVersion);
  if (cached) {
    return { relativePath: run.renderedSetupPdfPath!, cacheHit: true, bytes: cached };
  }

  const source =
    (await resolveChassisBlankSource(
      run.setupSnapshot.carId,
      run.setupSnapshot.data,
      run.setupSnapshot.sheetBlankId
    ))
    ?? (await resolveUploadedPdfSourceForRun(params.userId, run));
  if (!source) return null;

  const bytes = await fillSetupPdf({
    source,
    data: run.setupSnapshot.data,
    debugLabel: `run=${run.id}`,
  });
  if (!bytes) return null;

  const buffer = Buffer.from(bytes);
  const storageRef = await storeRunRenderedSetupPdf(run.id, buffer);

  await prisma.run.update({
    where: { id: run.id },
    data: {
      renderedSetupPdfPath: storageRef,
      renderedSetupPdfGeneratedAt: new Date(),
      setupPdfRenderVersion: SETUP_PDF_RENDER_PIPELINE_VERSION,
      // Only the fallback path knows a document; a chassis blank belongs to no user's upload.
      ...(run.sourceSetupDocumentId == null && source.documentId
        ? { sourceSetupDocumentId: source.documentId }
        : {}),
      ...(run.sourceSetupCalibrationId == null && source.calibrationId
        ? { sourceSetupCalibrationId: source.calibrationId }
        : {}),
    },
  });

  return { relativePath: storageRef, cacheHit: false, bytes: buffer };
}

/** Persisted on new runs so lazy render can skip baseline chain when possible. */
export async function resolveSourcePdfLinksForNewRun(
  userId: string,
  baselineSnapshotId: string | null,
  explicitDocumentId: string | null
): Promise<{ sourceSetupDocumentId: string | null; sourceSetupCalibrationId: string | null }> {
  let docId = explicitDocumentId?.trim() || null;
  if (docId) {
    // `Run.sourceSetupDocumentId` is a real FK: an id that isn't one of this user's documents
    // would fail the whole run insert. Drop it instead — the PDF link is an optimisation, and
    // losing it must never cost the driver their run.
    const owned = await prisma.setupDocument.findFirst({
      where: { id: docId, userId },
      select: { id: true },
    });
    if (!owned) docId = null;
  }
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
