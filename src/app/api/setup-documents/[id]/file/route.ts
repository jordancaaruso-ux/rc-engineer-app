import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
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
    select: { storagePath: true, mimeType: true, originalFilename: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readBytesFromStorageRef(doc.storagePath);
  } catch {
    return NextResponse.json({ error: "Stored file not found" }, { status: 404 });
  }

  const contentType = doc.mimeType?.trim() || "application/octet-stream";

  // Stream bytes with explicit type so pdf.js / iframes get real PDF data (redirects can confuse fetch/range).
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
