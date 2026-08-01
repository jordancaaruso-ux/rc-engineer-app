import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { requireApiFeature } from "@/lib/entitlementGuards";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId");
  const runId = url.searchParams.get("runId");

  const where = {
    userId: userId,
    ...(trackId ? { trackId } : {}),
    ...(runId ? { runId } : {}),
  };

  // Deliberately a narrow `select`, not `include`: the job blobs (resultJson, manualJson,
  // alignmentJson, idCorrectionsJson) are megabytes each and this list only needs to know
  // *whether* they exist. The two id-only follow-ups below cost a few bytes and replace
  // what used to pull every blob for 50 rows straight back out to the client.
  const jobs = await prisma.videoAnalysisJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      analysisMode: true,
      errorMessage: true,
      videoAssetId: true,
      trackId: true,
      runId: true,
      track: { select: { id: true, name: true } },
      profile: { select: { id: true, name: true } },
      run: { select: { id: true, sessionLabel: true, trackNameSnapshot: true } },
    },
  });

  const ids = jobs.map((j) => j.id);
  const [withResult, withManual] = ids.length
    ? await Promise.all([
        prisma.videoAnalysisJob.findMany({
          where: { id: { in: ids }, resultJson: { not: Prisma.DbNull } },
          select: { id: true },
        }),
        prisma.videoAnalysisJob.findMany({
          where: { id: { in: ids }, manualJson: { not: Prisma.DbNull } },
          select: { id: true },
        }),
      ])
    : [[], []];
  const resultIds = new Set(withResult.map((r) => r.id));
  const manualIds = new Set(withManual.map((r) => r.id));

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      hasResult: resultIds.has(j.id),
      analysisMode: j.analysisMode,
      hasManual: manualIds.has(j.id),
    })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  // Job creation is the Pro door for analysis; reads stay open so past results render anywhere.
  const gate = await requireApiFeature("video");
  if (gate.response) return gate.response;
  const userId = gate.user.id;

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
    where: { id: body.profileId, userId: userId, trackId: body.trackId },
    select: { id: true },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const isManual = body.analysisMode === "manual";

  const job = await prisma.videoAnalysisJob.create({
    data: {
      userId: userId,
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
