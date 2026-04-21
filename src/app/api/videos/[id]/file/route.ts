import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { readVideoBytesFromStorageRef } from "@/lib/videos/storage";

type Ctx = { params: Promise<{ id: string }> };

function parseRangeHeader(range: string, size: number): { start: number; end: number } | null {
  // bytes=start-end | bytes=start- | bytes=-suffixLength
  const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!m) return null;
  const a = m[1];
  const b = m[2];
  if (a === "" && b === "") return null;

  if (a === "") {
    const suffix = Number(b);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    const end = size - 1;
    return { start, end };
  }

  const start = Number(a);
  if (!Number.isFinite(start) || start < 0) return null;

  const end = b === "" ? size - 1 : Number(b);
  if (!Number.isFinite(end) || end < start) return null;

  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const { id } = await ctx.params;
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const asset = await prisma.videoAsset.findFirst({
    where: { id, userId: user.id },
    select: { storagePath: true, mimeType: true, originalFilename: true, bytes: true },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readVideoBytesFromStorageRef(asset.storagePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stored file not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const size = bytes.length;
  const contentType = asset.mimeType?.trim() || "application/octet-stream";

  const range = request.headers.get("range");
  if (range) {
    const parsed = parseRangeHeader(range, size);
    if (!parsed) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
        },
      });
    }
    const { start, end } = parsed;
    const chunk = bytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

