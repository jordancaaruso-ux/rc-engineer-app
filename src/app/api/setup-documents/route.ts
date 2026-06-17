import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  sourceTypeFromMime,
  StorageConfigurationError,
  storeSetupDocumentFile,
} from "@/lib/setupDocuments/storage";
import { SETUP_DOCUMENT_ALLOWED_MIME, SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";
import { resolveOwnedCarId } from "@/lib/cars/resolveOwnedCarId";
import { canonicalSetupTemplateForUserCarId } from "@/lib/carSetupScope";
import { isAllowedSetupDocumentBlobUrl } from "@/lib/setupDocuments/blobStorageRef";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const forExamplePdf = searchParams.get("forExamplePdf") === "1";
  const docs = await prisma.setupDocument.findMany({
    where: forExamplePdf
      ? { userId: user.id, mimeType: "application/pdf" }
      : { userId: user.id, setupImportBatchId: null },
    orderBy: { createdAt: "desc" },
    take: forExamplePdf ? 100 : undefined,
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sourceType: true,
      parseStatus: true,
      importStatus: true,
      currentStage: true,
      lastCompletedStage: true,
      importErrorMessage: true,
      parserType: true,
      createdAt: true,
      updatedAt: true,
      createdSetupId: true,
      carId: true,
      setupSheetTemplate: true,
    },
  });
  return NextResponse.json({ documents: docs });
}

export async function POST(request: Request) {
  const dbg = process.env.DEBUG_SETUP_UPLOAD_TIMING === "1";
  const t0 = dbg ? performance.now() : 0;
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (dbg) console.log(`[setup-upload-timing] after auth ${(performance.now() - t0).toFixed(1)}ms`);
  const ct = request.headers.get("content-type") ?? "";

  let originalFilename = "upload";
  let mimeType = "";
  let carIdRaw: string | FormDataEntryValue | null = null;
  let setupSheetModelIdRaw: string | FormDataEntryValue | null = null;
  let preStoredPath: string | null = null;
  let multipartFile: File | null = null;

  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      storagePath?: string;
      originalFilename?: string;
      mimeType?: string;
      carId?: string;
      setupSheetModelId?: string;
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
    carIdRaw = body.carId ?? null;
    setupSheetModelIdRaw = body.setupSheetModelId ?? null;
  } else if (ct.includes("multipart/form-data")) {
    const tForm = dbg ? performance.now() : 0;
    const form = await request.formData().catch(() => null);
    if (dbg) console.log(`[setup-upload-timing] after formData ${(performance.now() - tForm).toFixed(1)}ms`);
    if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }
    multipartFile = file;
    originalFilename = file.name || "upload";
    mimeType = (file.type || "").toLowerCase();
    carIdRaw = form.get("carId");
    setupSheetModelIdRaw = form.get("setupSheetModelId");
  } else {
    return NextResponse.json(
      { error: "Expected multipart/form-data or application/json" },
      { status: 400 }
    );
  }

  const carResolved = await resolveOwnedCarId(user.id, carIdRaw);
  if (!carResolved.ok) {
    return NextResponse.json({ error: carResolved.message }, { status: 400 });
  }
  let setupSheetModelId =
    typeof setupSheetModelIdRaw === "string" && setupSheetModelIdRaw.trim()
      ? setupSheetModelIdRaw.trim()
      : null;
  const carRow = await prisma.car.findFirst({
    where: { id: carResolved.carId, userId: user.id },
    select: { setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!setupSheetModelId && carRow?.setupSheetModelId) {
    setupSheetModelId = carRow.setupSheetModelId;
  }
  if (setupSheetModelId) {
    const model = await prisma.setupSheetModel.findUnique({
      where: { id: setupSheetModelId },
      select: { id: true, slug: true },
    });
    if (!model) {
      return NextResponse.json({ error: "Invalid setup sheet model" }, { status: 400 });
    }
  }
  const setupSheetTemplate = await canonicalSetupTemplateForUserCarId(user.id, carResolved.carId);
  if (!preStoredPath && (multipartFile?.size ?? 0) > SETUP_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
  }
  if (!SETUP_DOCUMENT_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type. Use PDF/JPG/PNG/WEBP." }, { status: 400 });
  }

  let storagePath: string;
  const tStore = dbg ? performance.now() : 0;
  if (preStoredPath) {
    storagePath = preStoredPath;
  } else {
    try {
      ({ storagePath } = await storeSetupDocumentFile(multipartFile!));
    } catch (e) {
      if (e instanceof StorageConfigurationError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      throw e;
    }
  }
  if (dbg) console.log(`[setup-upload-timing] after storeSetupDocumentFile ${(performance.now() - tStore).toFixed(1)}ms`);
  const sourceType = sourceTypeFromMime(mimeType);

  // Create the document immediately so the UI can poll status/stages even if parsing stalls.
  const tDb = dbg ? performance.now() : 0;
  const created = await prisma.setupDocument.create({
    data: {
      userId: user.id,
      carId: carResolved.carId,
      setupSheetTemplate,
      setupSheetModelId,
      originalFilename,
      storagePath,
      mimeType,
      sourceType,
      parseStatus: "PENDING",
      importStatus: "PENDING",
      currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
      lastCompletedStage: SetupDocumentImportStages.FILE_PERSISTED,
    },
    select: { id: true },
  });
  if (dbg) console.log(`[setup-upload-timing] after prisma.create ${(performance.now() - tDb).toFixed(1)}ms`);
  console.log(`[setup-documents/upload] doc=${created.id} stored ${originalFilename} (${mimeType})`);
  if (dbg) console.log(`[setup-upload-timing] POST total ${(performance.now() - t0).toFixed(1)}ms`);

  return NextResponse.json({ id: created.id, document: { id: created.id } }, { status: 201 });
}

