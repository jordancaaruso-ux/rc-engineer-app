import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { parseVideoAnalysisResultV1 } from "@/lib/videoAnalysis/types";
import { computeSectorMatrix } from "@/lib/videoAnalysis/sectorStats";
import type { MotIdCorrection } from "@/lib/videoAnalysis/types";
import { compareVideoToTransponder } from "@/lib/videoAnalysis/compareTransponder";
import { parseManualVideoSessionV1 } from "@/lib/manualVideoAnalysis/types";
import { buildSfPredictions } from "@/lib/manualVideoAnalysis/sync";
import {
  compareBestLaps,
  averageSectorSplits,
} from "@/lib/manualVideoAnalysis/sectors";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const job = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, userId: user.id },
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
    job.analysisMode === "manual" ? parseManualVideoSessionV1(job.manualJson) : null;

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
    const sfPredictions = buildSfPredictions(
      manualSession.drivers,
      manualSession.sync,
      manualSession.selectedLaps
    );
    manualPayload = {
      session: manualSession,
      sfPredictions,
      compareBest: compareBestLaps(manualSession, sectorLineInfos),
      avgSectorsMe: Object.fromEntries(
        averageSectorSplits(manualSession, sectorLineInfos, "me")
      ),
      avgSectorsCompetitor: Object.fromEntries(
        averageSectorSplits(manualSession, sectorLineInfos, "competitor")
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
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;

  const body = (await request.json().catch(() => null)) as {
    runId?: string | null;
    alignmentJson?: unknown;
    idCorrectionsJson?: MotIdCorrection[];
    status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    manualJson?: unknown;
  } | null;

  const existing = await prisma.videoAnalysisJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const job = await prisma.videoAnalysisJob.update({
    where: { id: jobId },
    data: {
      ...(body?.runId !== undefined ? { runId: body.runId } : {}),
      ...(body?.alignmentJson !== undefined
        ? { alignmentJson: body.alignmentJson as object }
        : {}),
      ...(body?.idCorrectionsJson !== undefined
        ? { idCorrectionsJson: body.idCorrectionsJson as object }
        : {}),
      ...(body?.status ? { status: body.status } : {}),
      ...(body?.manualJson !== undefined ? { manualJson: body.manualJson as object } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json(job);
}
