import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  storeVideoFile,
  VIDEO_ALLOWED_MIME,
  videoMaxUploadBytes,
} from "@/lib/videos/storage";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const videos = await prisma.videoAsset.findMany({
    where: { userId: user.id },
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
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (runId) {
    const ownedRun = await prisma.run.findFirst({
      where: { id: runId, userId: user.id },
      select: { id: true },
    });
    if (!ownedRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 400 });
    }
  }
  if (trackId) {
    const ownedTrack = await prisma.track.findFirst({
      where: { id: trackId, userId: user.id },
      select: { id: true },
    });
    if (!ownedTrack) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }
  }
  const localPathRaw = form.get("localAnalysisPath");
  const localAnalysisPath =
    typeof localPathRaw === "string" && localPathRaw.trim()
      ? localPathRaw.trim().slice(0, 500)
      : null;

  const { storagePath } = await storeVideoFile(file, { maxBytes });

  const created = await prisma.videoAsset.create({
    data: {
      userId: user.id,
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

