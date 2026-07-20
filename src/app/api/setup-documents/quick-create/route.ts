import { NextResponse } from "next/server";

// Image imports run consensus OCR in after(); the function must outlive the 180s mapping cap.
export const maxDuration = 300;
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
import { templateKeyFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";
import type { ChassisCandidate, RepickOutcome } from "@/lib/setupCalibrations/autoPickCalibration";
import {
  applyPostFingerprintPickLinks,
  pickCalibrationByFingerprint,
} from "@/lib/setupCalibrations/fingerprintPick";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";
import { tryCreateSetupFromParsedDocument } from "@/lib/setupDocuments/tryCreateSetupFromParsedDocument";
import { isAllowedSetupDocumentBlobUrl } from "@/lib/setupDocuments/blobStorageRef";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import { calibrationsAutoPickableByUserWhere } from "@/lib/setupCalibrations/calibrationAccess";

/**
 * The image-map calibration for a car's setup-sheet model, if one exists — the model's default
 * calibration when it carries an image map, else any visible calibration for the model that does.
 * Returns null when the model has no derived image map yet, so the caller can block and prompt the
 * driver to derive one (image uploads read values ONLY through a real derived calibration).
 */
async function resolveModelImageCalibration(
  userId: string,
  setupSheetModelId: string
): Promise<{ id: string; name: string } | null> {
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: setupSheetModelId },
    select: { defaultCalibration: { select: { id: true, name: true, calibrationDataJson: true } } },
  });
  if (
    model?.defaultCalibration &&
    normalizeCalibrationData(model.defaultCalibration.calibrationDataJson).imageCalibration
  ) {
    return { id: model.defaultCalibration.id, name: model.defaultCalibration.name };
  }
  const cals = await prisma.setupSheetCalibration.findMany({
    where: { ...calibrationsAutoPickableByUserWhere(userId), setupSheetModelId },
    select: { id: true, name: true, calibrationDataJson: true },
    orderBy: { createdAt: "desc" },
  });
  for (const c of cals) {
    if (normalizeCalibrationData(c.calibrationDataJson).imageCalibration) {
      return { id: c.id, name: c.name };
    }
  }
  return null;
}

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
  /** Chassis auto-detected from the fingerprint (global match). */
  detectedModelId: string | null;
  detectedModelName: string | null;
  /** When >1 of the uploader's cars share the detected chassis, they must pick one. */
  carCandidates: Array<{ id: string; name: string }>;
  /** No calibration anywhere matched this sheet's layout. */
  notRecognized: boolean;
  /** PDF matches >1 chassis and hints couldn't split them — driver must pick which chassis. */
  needsChassisDisambiguation: boolean;
  /** The chassis models to offer as a tap-to-answer question when disambiguation is needed. */
  chassisCandidates: ChassisCandidate[];
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = request.headers.get("content-type") ?? "";

  let originalFilename = "upload";
  let mimeType = "";
  let explicitCarIdRaw: string | null = null;
  let explicitModelIdRaw: string | null = null;
  /** When true, a chassis/car mismatch returns 409 BEFORE creating anything (Assets upload flow). */
  let blockOnModelMismatch = false;
  /** When set, the file was already stored via client Blob upload (avoids the 4.5MB body limit). */
  let preStoredPath: string | null = null;
  let multipartFile: File | null = null;

  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      storagePath?: string;
      originalFilename?: string;
      mimeType?: string;
      carId?: string;
      setupSheetModelId?: string;
      blockOnModelMismatch?: boolean;
    } | null;
    if (!body?.storagePath?.trim()) {
      return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
    }
    preStoredPath = body.storagePath.trim();
    if (!isAllowedSetupDocumentBlobUrl(preStoredPath)) {
      return NextResponse.json({ error: "Invalid storagePath" }, { status: 400 });
    }
    originalFilename = body.originalFilename?.trim() || "upload";
    mimeType = (body.mimeType || "").toLowerCase();
    explicitCarIdRaw = typeof body.carId === "string" ? body.carId : null;
    explicitModelIdRaw = typeof body.setupSheetModelId === "string" ? body.setupSheetModelId : null;
    blockOnModelMismatch = body.blockOnModelMismatch === true;
  } else if (ct.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }
    multipartFile = file;
    originalFilename = file.name || "upload";
    mimeType = (file.type || "").toLowerCase();
    explicitCarIdRaw = form.get("carId") as string | null;
    explicitModelIdRaw = form.get("setupSheetModelId") as string | null;
    blockOnModelMismatch = form.get("blockOnModelMismatch") === "1";
  } else {
    return NextResponse.json(
      { error: "Expected multipart/form-data or application/json" },
      { status: 400 }
    );
  }

  const explicitCarIdProvided = typeof explicitCarIdRaw === "string" && explicitCarIdRaw.trim() !== "";
  const explicitModelIdProvided =
    typeof explicitModelIdRaw === "string" && explicitModelIdRaw.trim() !== "";

  let carId: string | null = null;
  let setupSheetTemplate: string | null = null;
  let setupSheetModelId: string | null = null;
  let carSetupSheetModelName: string | null = null;

  if (explicitModelIdProvided) {
    const modelRow = await prisma.setupSheetModel.findUnique({
      where: { id: explicitModelIdRaw!.trim() },
      select: { id: true, name: true, slug: true },
    });
    if (!modelRow) {
      return NextResponse.json({ error: "Setup sheet model not found" }, { status: 400 });
    }
    setupSheetModelId = modelRow.id;
    carSetupSheetModelName = modelRow.name;
    setupSheetTemplate = templateKeyFromModelSlug(modelRow.slug);
  }

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
        setupSheetModel: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!setupSheetModelId && carRow?.setupSheetModel) {
      setupSheetModelId = carRow.setupSheetModel.id;
      carSetupSheetModelName = carRow.setupSheetModel.name;
      setupSheetTemplate =
        templateKeyFromModelSlug(carRow.setupSheetModel.slug);
    } else if (!setupSheetTemplate) {
      setupSheetTemplate = await canonicalSetupTemplateForUserCarId(user.id, carId);
    }
    if (carRow?.setupSheetModelId && setupSheetModelId && carRow.setupSheetModelId !== setupSheetModelId) {
      return NextResponse.json(
        { error: "Selected car does not use the chosen setup sheet model." },
        { status: 400 }
      );
    }
  } else if (setupSheetModelId) {
    const carForModel = await prisma.car.findFirst({
      where: { userId: user.id, setupSheetModelId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    carId = carForModel?.id ?? null;
  }

  // No car/model context is allowed: the chassis is auto-detected from the sheet fingerprint below.

  const byteLength = preStoredPath ? null : multipartFile?.size ?? 0;
  if (byteLength != null && byteLength > SETUP_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
  }
  if (!SETUP_DOCUMENT_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PDF/JPG/PNG/WEBP." },
      { status: 400 }
    );
  }

  // Read bytes once so we can fingerprint PDFs/images (and re-store small multipart uploads).
  let bytes: Uint8Array;
  try {
    if (preStoredPath) {
      bytes = new Uint8Array(await readBytesFromStorageRef(preStoredPath));
      if (bytes.byteLength > SETUP_DOCUMENT_MAX_BYTES) {
        return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
      }
    } else {
      bytes = new Uint8Array(await multipartFile!.arrayBuffer());
    }
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
  let mismatchDetectedModelId: string | null = null;
  let mismatchDetectedModelName: string | null = null;
  // Image uploads are car-driven: block (don't process, don't AI-guess) when the car's sheet has
  // no derived image map, or when there's no car context to read the image against.
  let imageBlockReason: string | null = null;
  let imageNeedsCar = false;
  // PDF matches >1 chassis and hints couldn't split them: block auto-import and ask the driver
  // which chassis it is (tap-to-answer on the review screen) rather than render a wrong template.
  let chassisBlockReason: string | null = null;
  let chassisCandidatesForReview: ChassisCandidate[] = [];
  if (mimeType === PDF_MIME) {
    try {
      // Cheap disambiguation hints: the file name + the chassis models the uploader owns a car for.
      const uploaderCars = await prisma.car.findMany({
        where: { userId: user.id, setupSheetModelId: { not: null } },
        select: { setupSheetModelId: true },
        distinct: ["setupSheetModelId"],
      });
      const uploaderModelIds = uploaderCars
        .map((c) => c.setupSheetModelId)
        .filter((id): id is string => Boolean(id));
      const pick = await pickCalibrationByFingerprint({
        userId: user.id,
        bytes,
        debugPrefix: "quickCreate:auto",
        carSetupSheetModelId: setupSheetModelId,
        carSetupSheetModelName: carSetupSheetModelName,
        originalFilename,
        uploaderModelIds,
      });
      outcome = pick;
      pickUserNote = pick.userNote;
      calibrationModelMismatch = pick.modelMismatch;
      mismatchDetectedModelId = pick.detectedSheetModelId ?? null;
      mismatchDetectedModelName = pick.detectedSheetModelName ?? null;
      if (pick.needsChassisDisambiguation && pick.chassisCandidates?.length) {
        chassisBlockReason = pick.userNote;
        chassisCandidatesForReview = pick.chassisCandidates;
      }
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
    // Car-driven (design 2026-07-08): read VALUES only through the resolved car's model's derived
    // image calibration. Never fingerprint-match across other calibrations, never invent a model.
    if (setupSheetModelId) {
      const modelCal = await resolveModelImageCalibration(user.id, setupSheetModelId);
      if (modelCal) {
        outcome = {
          pickedCalibrationId: modelCal.id,
          pickedCalibrationName: modelCal.name,
          pickSource: "exact_fingerprint",
          pickDebug: `quickCreate:imageModelCal=${modelCal.name}`,
        };
      } else {
        imageBlockReason =
          "This sheet style isn’t readable automatically yet. Your sheet is saved — values will import automatically once it’s supported.";
      }
    } else if (carId) {
      imageBlockReason =
        "This car’s sheet style isn’t supported yet. Your sheet is saved — values will import automatically once it’s supported.";
    } else {
      imageNeedsCar = true;
    }
  }

  // Blocking mismatch confirm (Assets upload flow, 2026-07-17): when the caller asked for it and
  // the PDF fingerprints as a different chassis than the chosen car's sheet model, bail out with
  // 409 BEFORE storing the file or creating the document. The client shows "Change car / Use
  // anyway" and retries (without the flag) on confirm. Note: on the client-Blob path the file
  // already sits in Blob storage — the retry re-sends the same storagePath, nothing is orphaned.
  if (blockOnModelMismatch && calibrationModelMismatch) {
    return NextResponse.json(
      {
        error:
          pickUserNote ?? "This sheet matches a different chassis than the selected car.",
        mismatchBlocked: true,
        detectedModelId: mismatchDetectedModelId,
        detectedModelName: mismatchDetectedModelName,
        targetModelName: carSetupSheetModelName,
      },
      { status: 409 }
    );
  }

  // Auto-detect the chassis from the fingerprint. Models are global, so the picked calibration's
  // model identifies the chassis even when the calibration belongs to another user. We then look for
  // the uploader's car(s) of that chassis to attach the setup to.
  let detectedModelId: string | null = setupSheetModelId;
  let detectedModelName: string | null = carSetupSheetModelName;
  let carCandidates: Array<{ id: string; name: string }> = [];

  if (!detectedModelId && outcome.pickedCalibrationId) {
    const cal = await prisma.setupSheetCalibration.findUnique({
      where: { id: outcome.pickedCalibrationId },
      select: { setupSheetModel: { select: { id: true, name: true, slug: true } } },
    });
    if (cal?.setupSheetModel) {
      detectedModelId = cal.setupSheetModel.id;
      detectedModelName = cal.setupSheetModel.name;
      setupSheetModelId = detectedModelId;
      setupSheetTemplate =
        templateKeyFromModelSlug(cal.setupSheetModel.slug);
    }
  }

  // AI front door removed (2026-07-08): image uploads never invent a model or draft parameters.
  // The car determines the sheet; an unrecognized image is routed to car selection / calibration.

  if (!carId && detectedModelId) {
    const cars = await prisma.car.findMany({
      where: { userId: user.id, setupSheetModelId: detectedModelId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
      take: 6,
    });
    if (cars.length === 1) {
      carId = cars[0]!.id;
    } else if (cars.length > 1) {
      carCandidates = cars;
    }
  }

  // Image with no car context: offer the driver's own cars so they can say which it's for.
  if (imageNeedsCar && carCandidates.length === 0) {
    carCandidates = await prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
      take: 25,
    });
  }

  // Legacy fallback: calibration matched but carries no model link — reuse the old template heuristic.
  if (!carId && !detectedModelId && outcome.pickedCalibrationId) {
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
        where: { userId: user.id, setupSheetTemplate: { equals: template, mode: "insensitive" } },
        select: { id: true },
        take: 2,
      });
      if (matchingCars.length === 1) {
        carId = matchingCars[0]!.id;
        setupSheetTemplate = template;
      }
    }
  }

  // Chassis not recognized: no calibration anywhere matched this PDF/image layout. A cross-chassis
  // ambiguity is NOT "not recognized" — we recognized several; the driver just needs to pick one.
  const notRecognized =
    !outcome.pickedCalibrationId &&
    !detectedModelId &&
    !chassisBlockReason &&
    (mimeType === PDF_MIME || mimeType.startsWith("image/"));

  // Persist a plain-language note (shown on the review screen via calibrationResolvedDebug).
  if (!pickUserNote && imageBlockReason) {
    pickUserNote = imageBlockReason;
  }
  if (!pickUserNote) {
    if (carCandidates.length > 1) {
      pickUserNote = `Recognized as ${detectedModelName ?? "a known chassis"} — choose which car to attach it to.`;
    } else if (detectedModelId && !carId) {
      pickUserNote = `Recognized as ${detectedModelName ?? "a known chassis"}, but you have no ${detectedModelName ?? "matching"} car yet. Add one to import this setup.`;
    } else if (notRecognized) {
      pickUserNote =
        "This sheet layout isn’t recognized yet. Your sheet is saved — it will import automatically once its chassis is supported.";
    }
  }

  if (!carId) {
    console.log(
      `[setup-documents/quick-create] no carId; detectedModel=${detectedModelId ?? "none"} candidates=${carCandidates.length} (calibration=${outcome.pickedCalibrationId ?? "none"})`
    );
  }

  // Persist the raw file (skip when the client already uploaded to Blob).
  let storagePath: string;
  if (preStoredPath) {
    storagePath = preStoredPath;
  } else {
    const storageFile = new File([new Uint8Array(bytes)], originalFilename, {
      type: mimeType || "application/octet-stream",
    });
    try {
      ({ storagePath } = await storeSetupDocumentFile(storageFile));
    } catch (e) {
      if (e instanceof StorageConfigurationError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }
  }
  const sourceType = sourceTypeFromMime(mimeType);

  const pickedCalibrationId = outcome.pickedCalibrationId;
  const created = await prisma.setupDocument.create({
    data: {
      userId: user.id,
      carId,
      setupSheetTemplate,
      setupSheetModelId,
      originalFilename,
      storagePath,
      mimeType,
      sourceType,
      parseStatus: "PENDING",
      importStatus: "PENDING",
      currentStage: pickedCalibrationId
        ? SetupDocumentImportStages.CALIBRATION_SELECTED
        : SetupDocumentImportStages.AWAITING_CALIBRATION,
      lastCompletedStage: SetupDocumentImportStages.FILE_PERSISTED,
      // Persist the chassis choices so the review screen can render the tap-to-answer question.
      ...(chassisBlockReason
        ? {
            importDiagnosticJson: {
              kind: "needs_chassis_disambiguation_v1",
              candidates: chassisCandidatesForReview,
            } as object,
          }
        : {}),
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
    `[setup-documents/quick-create] doc=${created.id} file=${originalFilename} calibration=${pickedCalibrationId ?? "none"} source=${outcome.pickSource}`
  );

  // Run the parse/map pipeline inline so the response can report final status without the client
  // needing to poll. Failure here is non-fatal — the document still exists for manual review.
  // EXCEPT the AI front-door path: its vision read takes minutes (longer than any sane request
  // timeout), so it runs after the response and the document page live-refreshes until done.
  let needsReview = false;
  let needsReviewReason: string | null = null;
  const imageBlocked = Boolean(imageBlockReason) || imageNeedsCar;
  if (chassisBlockReason) {
    // Do NOT run the import pipeline and do NOT render any template: the PDF matches >1 chassis and
    // we won't guess. The review screen asks the driver which chassis, then re-picks scoped.
    needsReview = true;
    needsReviewReason = chassisBlockReason;
  } else if (imageBlocked) {
    // Do NOT run the import pipeline: no derived calibration means no values to read, and we never
    // fall back to AI-guessing the sheet. Surface the actionable reason for the review screen.
    needsReview = true;
    needsReviewReason = imageBlockReason ?? "Pick which of your cars this screenshot is for.";
  } else {
    try {
      await processSetupDocumentImport({ docId: created.id, userId: user.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      needsReview = true;
      needsReviewReason = `Parse failed: ${msg.slice(0, 200)}`;
      console.warn(`[setup-documents/quick-create] doc=${created.id} processImport error=${msg}`);
    }
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
      importDiagnosticJson: true,
    },
  });
  // When the AI reader ran (image, no calibration), surface its result as the review reason.
  const aiDiag =
    latest?.importDiagnosticJson && typeof latest.importDiagnosticJson === "object"
      ? (latest.importDiagnosticJson as { kind?: string; importedCount?: number; flaggedKeys?: unknown[] })
      : null;
  const aiExtractionRan = aiDiag?.kind === "ai_extraction_diagnostic_v1";
  const parseStatus = (latest?.parseStatus ?? "PENDING") as QuickCreateResponse["parseStatus"];
  const calibrationAmbiguous = outcome.pickSource === "ambiguous_suggestion";

  // Decide if the document is clean enough to materialise a SetupSnapshot automatically.
  const detectedLabel = detectedModelName ?? "a known chassis";
  if (!pickedCalibrationId && (mimeType === PDF_MIME || mimeType.startsWith("image/"))) {
    needsReview = true;
    needsReviewReason =
      needsReviewReason
      ?? (aiExtractionRan
        ? `AI read ${aiDiag?.importedCount ?? 0} values from the sheet — glance over the ${Array.isArray(aiDiag?.flaggedKeys) ? aiDiag.flaggedKeys.length : 0} flagged fields (mostly checkboxes) before creating the setup.`
        : mimeType.startsWith("image/")
          ? "This sheet style isn’t readable automatically yet. Your sheet is saved — values will import automatically once it’s supported."
          : pickUserNote
            ?? "This sheet layout isn’t recognized yet. Your sheet is saved — it will import automatically once its chassis is supported.");
  }
  if (calibrationModelMismatch && pickUserNote) {
    needsReview = true;
    needsReviewReason = pickUserNote;
  }
  if (parseStatus === "FAILED") {
    needsReview = true;
    // A calibration matched but read nothing back: the template is wired to field names this PDF
    // doesn't have. Naming it beats "parse did not produce any fields" — otherwise a broken
    // template looks identical to an unsupported sheet and quietly returns a blank sheet forever.
    needsReviewReason =
      needsReviewReason
      ?? (pickedCalibrationId
        ? `Matched the “${outcome.pickedCalibrationName ?? "saved"}” template, but it read no values from this sheet — the template's field mapping doesn't fit this PDF. Nothing was imported.`
        : "Parse did not produce any fields.");
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
    detectedModelId,
    detectedModelName,
    carCandidates,
    notRecognized,
    needsChassisDisambiguation: Boolean(chassisBlockReason),
    chassisCandidates: chassisCandidatesForReview,
  };
  return NextResponse.json(payload, { status: 201 });
}
