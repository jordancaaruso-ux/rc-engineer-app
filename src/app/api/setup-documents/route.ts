import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  sourceTypeFromMime,
  StorageConfigurationError,
  storeSetupDocumentFile,
} from "@/lib/setupDocuments/storage";
import { SETUP_DOCUMENT_ALLOWED_MIME, SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";
import { resolveOwnedCarId } from "@/lib/cars/resolveOwnedCarId";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const docs = await prisma.setupDocument.findMany({
    where: { userId: user.id, setupImportBatchId: null },
    orderBy: { createdAt: "desc" },
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
  const user = await getOrCreateLocalUser();
  if (dbg) console.log(`[setup-upload-timing] after getOrCreateLocalUser ${(performance.now() - t0).toFixed(1)}ms`);
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const tForm = dbg ? performance.now() : 0;
  const form = await request.formData().catch(() => null);
  if (dbg) console.log(`[setup-upload-timing] after formData ${(performance.now() - tForm).toFixed(1)}ms`);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  const carResolved = await resolveOwnedCarId(user.id, form.get("carId"));
  if (!carResolved.ok) {
    return NextResponse.json({ error: carResolved.message }, { status: 400 });
  }
  if (file.size > SETUP_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
  }
  const mimeType = (file.type || "").toLowerCase();
  if (!SETUP_DOCUMENT_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type. Use PDF/JPG/PNG/WEBP." }, { status: 400 });
  }

  let storagePath: string;
  const tStore = dbg ? performance.now() : 0;
  try {
    ({ storagePath } = await storeSetupDocumentFile(file));
  } catch (e) {
    if (e instanceof StorageConfigurationError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
  if (dbg) console.log(`[setup-upload-timing] after storeSetupDocumentFile ${(performance.now() - tStore).toFixed(1)}ms`);
  const sourceType = sourceTypeFromMime(mimeType);

  // Create the document immediately so the UI can poll status/stages even if parsing stalls.
  const tDb = dbg ? performance.now() : 0;
  const created = await prisma.setupDocument.create({
    data: {
      userId: user.id,
      carId: carResolved.carId,
      originalFilename: file.name || "upload",
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
  console.log(`[setup-documents/upload] doc=${created.id} stored ${file.name} (${mimeType})`);
  if (dbg) console.log(`[setup-upload-timing] POST total ${(performance.now() - t0).toFixed(1)}ms`);

  return NextResponse.json({ id: created.id }, { status: 201 });
}

