import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { extractPdfTextStructureFromBuffer } from "@/lib/setupDocuments/pdfTextStructure";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { storagePath: true, mimeType: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.mimeType !== "application/pdf") {
    return NextResponse.json({ error: "PDF only" }, { status: 400 });
  }

  const url = new URL(request.url);
  const epsilon = Math.min(12, Math.max(1, Number(url.searchParams.get("epsilon")) || 2.5));

  let buffer: Buffer;
  try {
    buffer = await readBytesFromStorageRef(doc.storagePath);
  } catch {
    return NextResponse.json({ error: "Stored file not found" }, { status: 404 });
  }

  try {
    const structure = await extractPdfTextStructureFromBuffer(buffer, epsilon);
    return NextResponse.json({ structure, epsilon });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PDF structure extraction failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
