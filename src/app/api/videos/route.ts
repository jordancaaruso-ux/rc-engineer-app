import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { requireApiFeature } from "@/lib/entitlementGuards";
import { prisma } from "@/lib/prisma";
import {
  blobPathnameFromUrl,
  isOwnVideoBlobUrl,
  storeVideoFile,
  VIDEO_ALLOWED_MIME,
  videoMaxUploadBytes,
} from "@/lib/videos/storage";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const videos = await prisma.videoAsset.findMany({
    where: { userId: userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      label: true,
      originalFilename: true,
      mimeType: true,
      bytes: true,
    },
  });
  return NextResponse.json({
    videos: videos.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  // Upload is the Pro door for video work; reads stay open so existing footage renders anywhere.
  const gate = await requireApiFeature("video");
  if (gate.response) return gate.response;
  const userId = gate.user.id;

  const ct = request.headers.get("content-type") ?? "";
  // Register a client-direct blob upload (big files never pass through this server).
  if (ct.includes("application/json")) {
    return registerDirectUpload(request, userId);
  }
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const maxBytes = videoMaxUploadBytes();
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `File too large (max ${(maxBytes / (1024 * 1024)).toFixed(0)} MB)` },
      { status: 400 }
    );
  }

  const mimeType = (file.type || "").toLowerCase();
  if (!VIDEO_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported video type. Use MP4/WebM/MOV." },
      { status: 400 }
    );
  }

  const labelRaw = form.get("label");
  const label =
    typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim().slice(0, 120) : null;
  const runIdRaw = form.get("runId");
  const trackIdRaw = form.get("trackId");
  const runId = typeof runIdRaw === "string" && runIdRaw.trim() ? runIdRaw.trim() : null;
  const trackId = typeof trackIdRaw === "string" && trackIdRaw.trim() ? trackIdRaw.trim() : null;

  const linkError = await validateLinks(userId, runId, trackId);
  if (linkError) return linkError;
  const localPathRaw = form.get("localAnalysisPath");
  const localAnalysisPath =
    typeof localPathRaw === "string" && localPathRaw.trim()
      ? localPathRaw.trim().slice(0, 500)
      : null;

  const { storagePath } = await storeVideoFile(file, { maxBytes });

  const created = await prisma.videoAsset.create({
    data: {
      userId: userId,
      storagePath,
      originalFilename: file.name || "upload",
      mimeType,
      bytes: file.size,
      label,
      runId,
      trackId,
      localAnalysisPath,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

async function validateLinks(
  userId: string,
  runId: string | null,
  trackId: string | null
): Promise<NextResponse | null> {
  if (runId) {
    const ownedRun = await prisma.run.findFirst({
      where: { id: runId, userId: userId },
      select: { id: true },
    });
    if (!ownedRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 400 });
    }
  }
  if (trackId) {
    const ownedTrack = await prisma.track.findFirst({
      where: { id: trackId },
      select: { id: true },
    });
    if (!ownedTrack) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }
  }
  return null;
}

/**
 * Turn a finished client-direct blob upload into a VideoAsset row. The URL is only
 * trusted after two checks: it must live in OUR store (`isOwnVideoBlobUrl`), and
 * `head()` must find it — size and content type come from `head`, never the client.
 */
async function registerDirectUpload(request: Request, userId: string): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as {
    url?: string;
    filename?: string;
    label?: string;
    runId?: string;
    trackId?: string;
  } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || !isOwnVideoBlobUrl(url)) {
    return NextResponse.json({ error: "Unrecognized storage URL" }, { status: 400 });
  }
  const pathname = blobPathnameFromUrl(url);
  if (!pathname.startsWith("videos/")) {
    return NextResponse.json({ error: "Unrecognized storage URL" }, { status: 400 });
  }

  let meta: Awaited<ReturnType<typeof head>>;
  try {
    meta = await head(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch {
    return NextResponse.json({ error: "Uploaded file not found in storage" }, { status: 400 });
  }
  const mimeType = (meta.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!VIDEO_ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported video type. Use MP4/WebM/MOV." },
      { status: 400 }
    );
  }

  const label =
    typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  const runId = typeof body?.runId === "string" && body.runId.trim() ? body.runId.trim() : null;
  const trackId =
    typeof body?.trackId === "string" && body.trackId.trim() ? body.trackId.trim() : null;
  const linkError = await validateLinks(userId, runId, trackId);
  if (linkError) return linkError;

  const originalFilename =
    typeof body?.filename === "string" && body.filename.trim()
      ? body.filename.trim().slice(0, 200)
      : pathname.split("/").pop() || "upload";

  const created = await prisma.videoAsset.create({
    data: {
      userId,
      storagePath: url,
      originalFilename,
      mimeType,
      bytes: meta.size,
      label,
      runId,
      trackId,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}

