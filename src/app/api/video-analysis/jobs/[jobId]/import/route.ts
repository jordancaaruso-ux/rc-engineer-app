import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  parseVideoAnalysisResultV1,
  VIDEO_ANALYSIS_RESULT_VERSION,
} from "@/lib/videoAnalysis/types";

type Params = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const job = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: { id: true, profileId: true },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { result?: unknown; alignmentJson?: unknown } | null;
  const raw = body?.result ?? body;
  const parsed = parseVideoAnalysisResultV1(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: `Invalid result JSON (expected version ${VIDEO_ANALYSIS_RESULT_VERSION})` },
      { status: 400 }
    );
  }

  const alignment = body?.alignmentJson ?? parsed.alignment ?? parsed.homography
    ? { alignment: parsed.alignment, homography: parsed.homography }
    : undefined;

  await prisma.videoAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      resultJson: parsed as object,
      ...(alignment ? { alignmentJson: alignment as object } : {}),
      errorMessage: null,
    },
  });

  if (parsed.alignment?.homography || parsed.homography) {
    await prisma.trackCameraProfile.update({
      where: { id: job.profileId },
      data: {
        lastAlignmentJson: (parsed.alignment ?? { homography: parsed.homography }) as object,
      },
    });
  }

  return NextResponse.json({ ok: true, trackCount: parsed.tracks.length });
}
