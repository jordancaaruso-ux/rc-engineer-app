import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  sourceTypeFromMime,
  StorageConfigurationError,
  storeSetupDocumentFile,
} from "@/lib/setupDocuments/storage";
import {
  SETUP_DOCUMENT_ALLOWED_MIME,
  SETUP_DOCUMENT_MAX_BYTES,
} from "@/lib/setupDocuments/types";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";
import { resolveOwnedCarId } from "@/lib/cars/resolveOwnedCarId";
import { canonicalSetupTemplateForUserCarId } from "@/lib/carSetupScope";
import {
  buildCalibrationFingerprints,
  repickCalibrationForBytes,
  type RepickOutcome,
} from "@/lib/setupCalibrations/autoPickCalibration";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";

const PDF_MIME = "application/pdf";

type QuickCreateResponse = {
  documentId: string;
  setupId: string | null;
  calibrationId: string | null;
  calibrationName: string | null;
  pickSource: RepickOutcome["pickSource"];
  pickDebug: string;
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  needsReview: boolean;
  needsReviewReason: string | null;
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const carResolved = await resolveOwnedCarId(user.id, form.get("carId"));
  if (!carResolved.ok) {
    return NextResponse.json({ error: carResolved.message }, { status: 400 });
  }
  const carId = carResolved.carId;
  const setupSheetTemplate = await canonicalSetupTemplateForUserCarId(user.id, carId);

  if (file.size > SETUP_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
  }
  const mimeType = (file.type || "").toLowerCase();
  if (!SETUP_DOCUMENT_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PDF/JPG/PNG/WEBP." },
      { status: 400 }
    );
  }

  // Read bytes once so we can both store the file and fingerprint PDFs.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Failed to read uploaded file" }, { status: 400 });
  }

  // Fingerprint-based calibration pick (PDF only).
  let outcome: RepickOutcome = {
    pickedCalibrationId: null,
    pickedCalibrationName: null,
    pickSource: "none",
    pickDebug: "quickCreate:auto skipped (non-pdf)",
  };
  if (mimeType === PDF_MIME) {
    try {
      const candidates = await buildCalibrationFingerprints({ userId: user.id });
      outcome = await repickCalibrationForBytes(bytes, candidates, {
        debugPrefix: "quickCreate:auto",
        suggestOnAmbiguous: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = {
        pickedCalibrationId: null,
        pickedCalibrationName: null,
        pickSource: "none",
        pickDebug: `quickCreate:auto fingerprint_error=${msg.slice(0, 200)}`,
      };
    }
  }

  // Persist the raw file. Construct a fresh `File` from the already-captured bytes so the Blob
  // streaming path in `storeSetupDocumentFile` does not try to re-read an exhausted stream.
  const storageFile = new File([new Uint8Array(bytes)], file.name || "upload", {
    type: mimeType || "application/octet-stream",
  });
  let storagePath: string;
  try {
    ({ storagePath } = await storeSetupDocumentFile(storageFile));
  } catch (e) {
    if (e instanceof StorageConfigurationError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
  const sourceType = sourceTypeFromMime(mimeType);

  const pickedCalibrationId = outcome.pickedCalibrationId;
  const created = await prisma.setupDocument.create({
    data: {
      userId: user.id,
      carId,
      setupSheetTemplate,
      originalFilename: file.name || "upload",
      storagePath,
      mimeType,
      sourceType,
      parseStatus: "PENDING",
      importStatus: "PENDING",
      currentStage: pickedCalibrationId
        ? SetupDocumentImportStages.CALIBRATION_SELECTED
        : SetupDocumentImportStages.AWAITING_CALIBRATION,
      lastCompletedStage: SetupDocumentImportStages.FILE_PERSISTED,
      ...(pickedCalibrationId
        ? {
            calibrationProfileId: pickedCalibrationId,
            calibrationResolvedProfileId: pickedCalibrationId,
            calibrationResolvedSource: outcome.pickSource,
            calibrationResolvedDebug: outcome.pickDebug,
          }
        : {
            calibrationResolvedSource: outcome.pickSource,
            calibrationResolvedDebug: outcome.pickDebug,
          }),
    },
    select: { id: true },
  });
  console.log(
    `[setup-documents/quick-create] doc=${created.id} file=${file.name} calibration=${pickedCalibrationId ?? "none"} source=${outcome.pickSource}`
  );

  // Run the parse/map pipeline inline so the response can report final status without the client
  // needing to poll. Failure here is non-fatal — the document still exists for manual review.
  let needsReview = false;
  let needsReviewReason: string | null = null;
  try {
    await processSetupDocumentImport({ docId: created.id, userId: user.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    needsReview = true;
    needsReviewReason = `Parse failed: ${msg.slice(0, 200)}`;
    console.warn(`[setup-documents/quick-create] doc=${created.id} processImport error=${msg}`);
  }

  const latest = await prisma.setupDocument.findUnique({
    where: { id: created.id },
    select: {
      id: true,
      parseStatus: true,
      parsedDataJson: true,
      carId: true,
      createdSetupId: true,
      calibrationProfileId: true,
    },
  });
  const parseStatus = (latest?.parseStatus ?? "PENDING") as QuickCreateResponse["parseStatus"];

  // Decide if the document is clean enough to materialise a SetupSnapshot automatically.
  if (mimeType === PDF_MIME && outcome.pickSource === "ambiguous_suggestion") {
    needsReview = true;
    needsReviewReason =
      needsReviewReason
      ?? `Multiple calibrations match this PDF — confirm "${outcome.pickedCalibrationName}" or pick another.`;
  } else if (!pickedCalibrationId && mimeType === PDF_MIME) {
    needsReview = true;
    needsReviewReason = needsReviewReason ?? "No calibration matched — pick one in review.";
  }
  if (mimeType !== PDF_MIME) {
    needsReview = true;
    needsReviewReason = needsReviewReason ?? "Images need manual review before a setup is created.";
  }
  if (parseStatus === "FAILED") {
    needsReview = true;
    needsReviewReason = needsReviewReason ?? "Parse did not produce any fields.";
  }

  let setupId: string | null = null;
  if (
    !needsReview
    && (parseStatus === "PARSED" || parseStatus === "PARTIAL")
    && latest
    && !latest.createdSetupId
    && latest.carId
  ) {
    try {
      const setup = await prisma.setupSnapshot.create({
        data: {
          userId: user.id,
          carId: latest.carId,
          data: normalizeSetupSnapshotForStorage(
            (latest.parsedDataJson ?? {}) as SetupSnapshotData
          ) as object,
        },
        select: { id: true },
      });
      const linked = await prisma.setupDocument.updateMany({
        where: { id: created.id, userId: user.id, createdSetupId: null },
        data: { createdSetupId: setup.id },
      });
      if (linked.count === 1) {
        setupId = setup.id;
        console.log(`[setup-documents/quick-create] doc=${created.id} setup=${setup.id} created`);
      } else {
        // Another code path raced us and linked a setup; leave the caller to reconcile.
        needsReview = true;
        needsReviewReason = "Setup was linked concurrently — re-open the document to verify.";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      needsReview = true;
      needsReviewReason = `Failed to create setup: ${msg.slice(0, 200)}`;
      console.warn(`[setup-documents/quick-create] doc=${created.id} createSetup error=${msg}`);
    }
  } else if (!needsReview && (parseStatus === "PARSED" || parseStatus === "PARTIAL")) {
    // Parse was ok but something else blocked setup creation (e.g. no car, pre-existing link).
    needsReview = true;
    needsReviewReason = needsReviewReason ?? "Setup snapshot could not be created automatically.";
  }

  const payload: QuickCreateResponse = {
    documentId: created.id,
    setupId,
    calibrationId: pickedCalibrationId,
    calibrationName: outcome.pickedCalibrationName,
    pickSource: outcome.pickSource,
    pickDebug: outcome.pickDebug,
    parseStatus,
    needsReview,
    needsReviewReason,
  };
  return NextResponse.json(payload, { status: 201 });
}
