import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  blobPathnameFromUrl,
  isOwnVideoBlobUrl,
  readVideoBytesFromStorageRef,
} from "@/lib/videos/storage";

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

/**
 * Serves a library video. Three lanes, best first:
 *
 * 1. Own private blob → 307 to a short-lived presigned CDN URL. The CDN handles Range
 *    natively (verified 206s), so seeking a 1GB heat video never touches this server.
 * 2. Local `/uploads/...` (dev, no blob token) → ranged `createReadStream` from disk.
 * 3. Anything else (legacy/foreign URL, presign failure) → the old buffer-whole-file
 *    proxy. Fine for small files; big files should live in lanes 1–2.
 */
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const { id } = await ctx.params;
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const asset = await prisma.videoAsset.findFirst({
    where: { id, userId: userId },
    select: { storagePath: true, mimeType: true, originalFilename: true, bytes: true },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storagePath = asset.storagePath;
  const contentType = asset.mimeType?.trim() || "application/octet-stream";
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  if (token && isOwnVideoBlobUrl(storagePath)) {
    try {
      const pathname = blobPathnameFromUrl(storagePath);
      const validUntil = Date.now() + 60 * 60 * 1000;
      const signed = await issueSignedToken({ token, pathname, operations: ["get"], validUntil });
      const { presignedUrl } = await presignUrl(signed, {
        operation: "get",
        pathname,
        access: "private",
      });
      return NextResponse.redirect(presignedUrl, {
        status: 307,
        // Media elements re-request per range; let the browser reuse the redirect
        // instead of minting a fresh token for every seek.
        headers: { "Cache-Control": "private, max-age=1800" },
      });
    } catch {
      // fall through to the buffered proxy
    }
  }

  if (!/^https?:\/\//i.test(storagePath) && storagePath.startsWith("/uploads/")) {
    return serveLocalFile(request, storagePath, contentType);
  }

  return serveBuffered(request, storagePath, contentType);
}

async function serveLocalFile(
  request: Request,
  storagePath: string,
  contentType: string
): Promise<NextResponse> {
  const relative = storagePath.slice("/uploads/".length);
  const candidates = [
    path.join(process.cwd(), ".local-uploads", relative),
    path.join(process.cwd(), "public", "uploads", relative),
  ];
  let absolute: string | null = null;
  let size = 0;
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate);
      absolute = candidate;
      size = s.size;
      break;
    } catch {
      /* try next */
    }
  }
  if (!absolute) return NextResponse.json({ error: "Stored file not found" }, { status: 404 });

  const range = request.headers.get("range");
  if (range) {
    const parsed = parseRangeHeader(range, size);
    if (!parsed) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const { start, end } = parsed;
    const stream = Readable.toWeb(
      createReadStream(absolute, { start, end })
    ) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function serveBuffered(
  request: Request,
  storagePath: string,
  contentType: string
): Promise<NextResponse> {
  let bytes: Buffer;
  try {
    bytes = await readVideoBytesFromStorageRef(storagePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stored file not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const size = bytes.length;
  const range = request.headers.get("range");
  if (range) {
    const parsed = parseRangeHeader(range, size);
    if (!parsed) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
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
