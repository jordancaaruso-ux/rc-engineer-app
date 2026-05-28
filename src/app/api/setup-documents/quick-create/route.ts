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
import type { RepickOutcome } from "@/lib/setupCalibrations/autoPickCalibration";
import {
  applyPostFingerprintPickLinks,
  pickCalibrationByFingerprint,
} from "@/lib/setupCalibrations/fingerprintPick";
import {
  buildImageCalibrationCandidates,
  repickImageCalibrationForBytes,
} from "@/lib/setupCalibrations/autoPickImageCalibration";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import { tryCreateSetupFromParsedDocument } from "@/lib/setupDocuments/tryCreateSetupFromParsedDocument";

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
  /** True when multiple calibrations matched the PDF fingerprint; a best guess was applied. */
  calibrationAmbiguous: boolean;
  /** Plain-language auto-pick summary for the review screen. */
  pickUserNote: string | null;
  calibrationModelMismatch: boolean;
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

  const explicitCarIdRaw = form.get("carId");
  const explicitCarIdProvided = typeof explicitCarIdRaw === "string" && explicitCarIdRaw.trim() !== "";
  let carId: string | null = null;
  let setupSheetTemplate: string | null = null;
  let setupSheetModelId: string | null = null;
  let carSetupSheetModelName: string | null = null;
  if (explicitCarIdProvided) {
    const carResolved = await resolveOwnedCarId(user.id, explicitCarIdRaw);
    if (!carResolved.ok) {
      return NextResponse.json({ error: carResolved.message }, { status: 400 });
    }
    carId = carResolved.carId;
    const carRow = await prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: {
        setupSheetModelId: true,
        setupSheetTemplate: true,
        setupSheetModel: { select: { id: true, name: true } },
      },
    });
    setupSheetModelId = carRow?.setupSheetModelId ?? null;
    carSetupSheetModelName = carRow?.setupSheetModel?.name ?? null;
    setupSheetTemplate = await canonicalSetupTemplateForUserCarId(user.id, carId);
  }

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

  // Fingerprint-based calibration pick. PDFs use AcroForm field name fingerprints; images use a
  // visual pHash + header-token fingerprint stored on the calibration's imageCalibration.
  let outcome: RepickOutcome = {
    pickedCalibrationId: null,
    pickedCalibrationName: null,
    pickSource: "none",
    pickDebug: "quickCreate:auto skipped (unsupported mime)",
  };
  let pickUserNote: string | null = null;
  let calibrationModelMismatch = false;
  if (mimeType === PDF_MIME) {
    try {
      const pick = await pickCalibrationByFingerprint({
        userId: user.id,
        bytes,
        debugPrefix: "quickCreate:auto",
        carSetupSheetModelId: setupSheetModelId,
        carSetupSheetModelName: carSetupSheetModelName,
      });
      outcome = pick;
      pickUserNote = pick.userNote;
      calibrationModelMismatch = pick.modelMismatch;
      if (pick.pickedCalibrationId) {
        await applyPostFingerprintPickLinks({
          userId: user.id,
          pickedCalibrationId: pick.pickedCalibrationId,
          carSetupSheetModelId: setupSheetModelId,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = {
        pickedCalibrationId: null,
        pickedCalibrationName: null,
        pickSource: "none",
        pickDebug: `quickCreate:auto fingerprint_error=${msg.slice(0, 200)}`,
      };
      pickUserNote = "Fingerprint matching failed — pick a calibration manually.";
    }
  } else if (mimeType.startsWith("image/")) {
    try {
      const candidates = await buildImageCalibrationCandidates({ userId: user.id });
      outcome = await repickImageCalibrationForBytes(bytes, candidates, {
        debugPrefix: "quickCreate:imageAuto",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = {
        pickedCalibrationId: null,
        pickedCalibrationName: null,
        pickSource: "none",
        pickDebug: `quickCreate:imageAuto fingerprint_error=${msg.slice(0, 200)}`,
      };
    }
  }

  // Auto-default carId from the picked calibration when the upload didn't specify one.
  // Look up canonical setupSheetTemplate values from past SetupDocuments using this calibration;
  // if exactly one of the user's cars has that template, use it. Avoids forcing a car picker for
  // repeat users pasting screenshots from an entry point that doesn't already have a car context.
  if (!carId && outcome.pickedCalibrationId) {
    const past = await prisma.setupDocument.findMany({
      where: {
        userId: user.id,
        calibrationProfileId: outcome.pickedCalibrationId,
        setupSheetTemplate: { not: null },
      },
      select: { setupSheetTemplate: true },
      take: 25,
    });
    const templates = new Set(
      past.map((p) => p.setupSheetTemplate).filter((t): t is string => Boolean(t))
    );
    if (templates.size === 1) {
      const template = templates.values().next().value as string;
      const matchingCars = await prisma.car.findMany({
        where: {
          userId: user.id,
          setupSheetTemplate: { equals: template, mode: "insensitive" },
        },
        select: { id: true },
        take: 2,
      });
      if (matchingCars.length === 1) {
        carId = matchingCars[0]!.id;
        setupSheetTemplate = template;
      }
    }
  }
  // We still need a car to materialise a SetupSnapshot. Without one, accept the upload but
  // require a manual car pick during review (needsReview=true downstream).
  if (!carId) {
    if (!explicitCarIdProvided) {
      // No car context at all → keep going so user can pick a car in the review screen.
      console.log(
        `[setup-documents/quick-create] no carId; proceeding without car (calibration=${outcome.pickedCalibrationId ?? "none"})`
      );
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
      setupSheetModelId,
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
            calibrationResolvedDebug: pickUserNote
              ? `${outcome.pickDebug} | ${pickUserNote}`
              : outcome.pickDebug,
          }
        : {
            calibrationResolvedSource: outcome.pickSource,
            calibrationResolvedDebug: pickUserNote
              ? `${outcome.pickDebug} | ${pickUserNote}`
              : outcome.pickDebug,
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
  const calibrationAmbiguous = outcome.pickSource === "ambiguous_suggestion";

  // Decide if the document is clean enough to materialise a SetupSnapshot automatically.
  if (!pickedCalibrationId && (mimeType === PDF_MIME || mimeType.startsWith("image/"))) {
    needsReview = true;
    needsReviewReason =
      needsReviewReason
      ?? (mimeType.startsWith("image/")
        ? "No image calibration matched — draw regions once to teach the app this sheet."
        : pickUserNote ?? "No calibration matched — pick one in review.");
  }
  if (calibrationModelMismatch && pickUserNote) {
    needsReview = true;
    needsReviewReason = pickUserNote;
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
  ) {
    const createdResult = await tryCreateSetupFromParsedDocument({
      docId: created.id,
      userId: user.id,
    });
    if (createdResult.ok) {
      setupId = createdResult.setupId;
      console.log(`[setup-documents/quick-create] doc=${created.id} setup=${setupId} created`);
    } else {
      if (createdResult.reason === "race_or_concurrent_link") {
        needsReview = true;
        needsReviewReason = "Setup was linked concurrently — re-open the document to verify.";
      } else {
        needsReview = true;
        needsReviewReason = `Failed to create setup: ${createdResult.reason}`;
        console.warn(
          `[setup-documents/quick-create] doc=${created.id} tryCreateSetupFromParsedDocument ${createdResult.reason}`
        );
      }
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
    calibrationAmbiguous,
    pickUserNote,
    calibrationModelMismatch,
  };
  return NextResponse.json(payload, { status: 201 });
}
