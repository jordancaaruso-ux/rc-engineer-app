import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId");
  const runId = url.searchParams.get("runId");

  const jobs = await prisma.videoAnalysisJob.findMany({
    where: {
      userId: user.id,
      ...(trackId ? { trackId } : {}),
      ...(runId ? { runId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      track: { select: { id: true, name: true } },
      profile: { select: { id: true, name: true } },
      run: { select: { id: true, sessionLabel: true, trackNameSnapshot: true } },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      hasResult: Boolean(j.resultJson),
      analysisMode: j.analysisMode,
      hasManual: Boolean(j.manualJson),
    })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    trackId?: string;
    profileId?: string;
    videoAssetId?: string | null;
    runId?: string | null;
    alignmentJson?: unknown;
    analysisMode?: "manual" | "worker";
    manualJson?: unknown;
  } | null;

  if (!body?.trackId || !body?.profileId) {
    return NextResponse.json({ error: "trackId and profileId required" }, { status: 400 });
  }

  const profile = await prisma.trackCameraProfile.findFirst({
    where: { id: body.profileId, userId: user.id, trackId: body.trackId },
    select: { id: true },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const isManual = body.analysisMode === "manual";

  const job = await prisma.videoAnalysisJob.create({
    data: {
      userId: user.id,
      trackId: body.trackId,
      profileId: body.profileId,
      videoAssetId: body.videoAssetId ?? null,
      runId: body.runId ?? null,
      status: isManual ? "COMPLETED" : "PENDING",
      analysisMode: isManual ? "manual" : "worker",
      manualJson: isManual && body.manualJson != null ? (body.manualJson as object) : undefined,
      alignmentJson: body.alignmentJson != null ? (body.alignmentJson as object) : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: job.id }, { status: 201 });
}
