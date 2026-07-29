import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { parseVideoAnalysisResultV1 } from "@/lib/videoAnalysis/types";
import { computeSectorMatrix } from "@/lib/videoAnalysis/sectorStats";
import type { MotIdCorrection } from "@/lib/videoAnalysis/types";
import { compareVideoToTransponder } from "@/lib/videoAnalysis/compareTransponder";
import { parseManualVideoSession } from "@/lib/manualVideoAnalysis/types";
import { normalizeManualSession } from "@/lib/manualVideoAnalysis/timing";
import { buildSfPredictions } from "@/lib/manualVideoAnalysis/sync";
import { primaryTimingSession } from "@/lib/manualVideoAnalysis/sessionModel";
import {
  compareBestLaps,
  averageSectorSplits,
} from "@/lib/manualVideoAnalysis/sectors";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const job = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, userId: userId },
    include: {
      track: { select: { id: true, name: true } },
      profile: {
        include: { sectorLines: { orderBy: { sortOrder: "asc" } } },
      },
      videoAsset: true,
      run: {
        select: {
          id: true,
          sessionLabel: true,
          bestLapSeconds: true,
          importedLapSets: {
            include: {
              laps: { where: { isIncluded: true }, orderBy: { lapNumber: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const manualSession =
    job.analysisMode === "manual" ? parseManualVideoSession(job.manualJson) : null;

  const sectorLineInfos =
    job.profile.sectorLines.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      sortOrder: l.sortOrder,
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
    })) ?? [];

  let manualPayload: Record<string, unknown> | null = null;
  if (manualSession) {
    const primary = primaryTimingSession(manualSession);
    const lapNums: { role: "me" | "competitor"; lapNumber: number }[] = [
      ...manualSession.selectedLaps.me.map((lapNumber) => ({
        role: "me" as const,
        lapNumber,
      })),
      ...manualSession.selectedLaps.competitor.map((lapNumber) => ({
        role: "competitor" as const,
        lapNumber,
      })),
    ];
    const sfPredictions = primary ? buildSfPredictions(primary, lapNums) : [];
    const primaryId = primary?.sessionId ?? "";
    manualPayload = {
      session: manualSession,
      sfPredictions,
      compareBest: compareBestLaps(manualSession, sectorLineInfos),
      avgSectorsMe: Object.fromEntries(
        averageSectorSplits(manualSession, sectorLineInfos, primaryId, "me")
      ),
      avgSectorsCompetitor: Object.fromEntries(
        averageSectorSplits(manualSession, sectorLineInfos, primaryId, "competitor")
      ),
    };
  }

  const result = parseVideoAnalysisResultV1(job.resultJson);
  const corrections = (job.idCorrectionsJson as MotIdCorrection[] | null) ?? null;
  const sectorMatrix = result ? computeSectorMatrix(result, corrections) : null;

  let transponderCompare = null;
  if (result && job.run?.importedLapSets?.length) {
    const primary = job.run.importedLapSets.find((s) => s.isPrimaryUser) ?? job.run.importedLapSets[0];
    if (primary) {
      transponderCompare = compareVideoToTransponder(
        result,
        primary.laps.map((l) => ({ lapNumber: l.lapNumber, lapTimeSec: l.lapTimeSeconds }))
      );
    }
  }

  return NextResponse.json({
    job: {
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    result,
    sectorMatrix,
    transponderCompare,
    manual: manualPayload,
    sectorLines: sectorLineInfos,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const body = (await request.json().catch(() => null)) as {
    runId?: string | null;
    videoAssetId?: string | null;
    profileId?: string;
    alignmentJson?: unknown;
    idCorrectionsJson?: MotIdCorrection[];
    status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    manualJson?: unknown;
  } | null;

  const existing = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, userId: userId },
    select: { id: true, trackId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Switching line sets: the profile must be the user's own and on this job's track,
  // otherwise marks would be scored against another track's geometry.
  if (typeof body?.profileId === "string") {
    const profile = await prisma.trackCameraProfile.findFirst({
      where: { id: body.profileId, userId: userId, trackId: existing.trackId },
      select: { id: true },
    });
    if (!profile) return NextResponse.json({ error: "Line set not found" }, { status: 404 });
  }

  if (typeof body?.videoAssetId === "string") {
    const asset = await prisma.videoAsset.findFirst({
      where: { id: body.videoAssetId, userId: userId },
      select: { id: true },
    });
    if (!asset) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  let manualJsonUpdate: object | undefined;
  if (body?.manualJson !== undefined) {
    const parsed = parseManualVideoSession(body.manualJson);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid manualJson" }, { status: 400 });
    }
    manualJsonUpdate = normalizeManualSession(parsed) as object;
  }

  const job = await prisma.videoAnalysisJob.update({
    where: { id: jobId },
    data: {
      ...(body?.runId !== undefined ? { runId: body.runId } : {}),
      ...(body?.videoAssetId !== undefined ? { videoAssetId: body.videoAssetId } : {}),
      ...(body?.profileId ? { profileId: body.profileId } : {}),
      ...(body?.alignmentJson !== undefined
        ? { alignmentJson: body.alignmentJson as object }
        : {}),
      ...(body?.idCorrectionsJson !== undefined
        ? { idCorrectionsJson: body.idCorrectionsJson as object }
        : {}),
      ...(body?.status ? { status: body.status } : {}),
      ...(manualJsonUpdate !== undefined ? { manualJson: manualJsonUpdate } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json(job);
}
