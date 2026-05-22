import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { storeVideoAnalysisLocalFile } from "@/lib/videoAnalysis/storage";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Params = { params: Promise<{ profileId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const profile = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    select: { referenceImagePath: true },
  });
  if (!profile?.referenceImagePath) {
    return NextResponse.json({ error: "No reference image" }, { status: 404 });
  }

  const bytes = await readBytesFromStorageRef(profile.referenceImagePath);
  const ext = profile.referenceImagePath.toLowerCase();
  const mime = ext.endsWith(".png") ? "image/png" : "image/jpeg";
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profileId } = await params;

  const profile = await prisma.trackCameraProfile.findFirst({
    where: { id: profileId, userId: user.id },
    select: { id: true },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const { storagePath } = await storeVideoAnalysisLocalFile(file, "reference");
  const updated = await prisma.trackCameraProfile.update({
    where: { id: profileId },
    data: { referenceImagePath: storagePath },
    select: { id: true, referenceImagePath: true },
  });

  return NextResponse.json(updated);
}
