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
    },
  });
  return NextResponse.json({ documents: docs });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
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
  if (file.size > SETUP_DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
  }
  const mimeType = (file.type || "").toLowerCase();
  if (!SETUP_DOCUMENT_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type. Use PDF/JPG/PNG/WEBP." }, { status: 400 });
  }

  let storagePath: string;
  try {
    ({ storagePath } = await storeSetupDocumentFile(file));
  } catch (e) {
    if (e instanceof StorageConfigurationError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
  const sourceType = sourceTypeFromMime(mimeType);

  // Create the document immediately so the UI can poll status/stages even if parsing stalls.
  const created = await prisma.setupDocument.create({
    data: {
      userId: user.id,
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
  console.log(`[setup-documents/upload] doc=${created.id} stored ${file.name} (${mimeType})`);

  return NextResponse.json({ id: created.id }, { status: 201 });
}

