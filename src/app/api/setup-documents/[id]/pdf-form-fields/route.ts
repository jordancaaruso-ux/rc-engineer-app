import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
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

  let buffer: Buffer;
  try {
    buffer = await readBytesFromStorageRef(doc.storagePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stored file not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const extracted = await extractPdfFormFields(buffer);
  return NextResponse.json(extracted);
}
