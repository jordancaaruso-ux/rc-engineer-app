import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  sourceTypeFromMime,
  StorageConfigurationError,
  storeSetupDocumentFile,
} from "@/lib/setupDocuments/storage";
import { SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";
import { SetupDocumentImportStages } from "@/lib/setupDocuments/importStages";
import { resolveOwnedCarId } from "@/lib/cars/resolveOwnedCarId";

const PDF_MIME = "application/pdf";
function looksLikePdf(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t === PDF_MIME) return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".pdf");
}

type Ctx = { params: Promise<{ batchId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { batchId } = await ctx.params;
  const batch = await prisma.setupImportBatch.findFirst({
    where: { id: batchId, userId: user.id },
    select: { id: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const carResolved = await resolveOwnedCarId(user.id, form.get("carId"));
  if (!carResolved.ok) {
    return NextResponse.json({ error: carResolved.message }, { status: 400 });
  }

  const files = form.getAll("files");
  const fileList = files.filter((f): f is File => f instanceof File);
  if (fileList.length === 0) {
    return NextResponse.json({ error: 'Missing "files" field (one or more PDFs)' }, { status: 400 });
  }

  const createdIds: string[] = [];
  for (const file of fileList) {
    if (file.size > SETUP_DOCUMENT_MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max 12 MB): ${file.name}` }, { status: 400 });
    }
    if (!looksLikePdf(file)) {
      const rawType = (file.type || "").trim() || "unknown";
      return NextResponse.json(
        { error: `Bulk import accepts PDF only: ${file.name} (type=${rawType})` },
        { status: 400 }
      );
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
    const sourceType = sourceTypeFromMime(PDF_MIME);
    const doc = await prisma.setupDocument.create({
      data: {
        userId: user.id,
        carId: carResolved.carId,
        setupImportBatchId: batch.id,
        originalFilename: file.name || "upload.pdf",
        storagePath,
        mimeType: PDF_MIME,
        sourceType,
        parseStatus: "PENDING",
        importStatus: "PENDING",
        currentStage: SetupDocumentImportStages.AWAITING_CALIBRATION,
        lastCompletedStage: SetupDocumentImportStages.FILE_PERSISTED,
        importDatasetReviewStatus: "UNSET",
        eligibleForAggregationDataset: false,
      },
      select: { id: true },
    });
    createdIds.push(doc.id);
    console.log(
      JSON.stringify({
        tag: "bulk-import-upload",
        batchId: batch.id,
        documentId: doc.id,
        bytes: file.size,
        filename: file.name || "upload.pdf",
      })
    );
  }

  return NextResponse.json({ documentIds: createdIds, count: createdIds.length }, { status: 201 });
}
