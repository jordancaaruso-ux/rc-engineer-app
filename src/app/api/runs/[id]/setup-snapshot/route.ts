import { NextResponse } from "next/server";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import { computeSetupDeltaForAudit } from "@/lib/setup/resolveSetupSnapshot";

type Params = { params: Promise<{ id: string }> };

const runSelectForPdfReview = {
  id: true,
  userId: true,
  shareWithTeam: true,
  createdAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  setupSnapshotId: true,
  car: {
    select: {
      id: true,
      name: true,
      setupSheetTemplate: true,
      setupSheetModelId: true,
    },
  },
  track: { select: { id: true, name: true } },
  event: { select: { name: true } },
  setupSnapshot: { select: { id: true, data: true, baseSetupSnapshotId: true } },
} as const;

/** Lazy-load setup snapshot + run context for sessions modal / PDF review page. */
export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id },
    select: runSelectForPdfReview,
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await viewerMayAccessRun(user.id, run))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sessionLabel = formatRunSessionDisplay({
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    sessionLabel: run.sessionLabel,
  });

  return NextResponse.json({
    runId: run.id,
    isOwner: run.userId === user.id,
    run: {
      id: run.id,
      createdAt: run.createdAt,
      sessionLabel,
      car: run.car,
      track: run.track,
      event: run.event,
    },
    setupSnapshot: run.setupSnapshot,
  });
}

/** Owner-only: persist edited setup to a new snapshot and invalidate cached PDF. */
export async function PATCH(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      carId: true,
      tireTypeId: true,
      tireRunNumber: true,
      tireAgeKnown: true,
      tireType: { select: { id: true, displayName: true } },
      setupSnapshotId: true,
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!run.carId) {
    return NextResponse.json({ error: "Run has no car" }, { status: 400 });
  }

  const body = (await request.json()) as { setupData?: unknown };
  if (!body.setupData || typeof body.setupData !== "object" || Array.isArray(body.setupData)) {
    return NextResponse.json({ error: "setupData is required" }, { status: 400 });
  }

  const previousData = normalizeSetupSnapshotForStorage(run.setupSnapshot?.data ?? {});
  const previousId = run.setupSnapshot?.id ?? null;

  let resolvedData = normalizeSetupSnapshotForStorage(body.setupData as SetupSnapshotData);

  const tireValue =
    run.tireTypeId && run.tireType
      ? buildTireSelectionValue({
          tireTypeId: run.tireTypeId,
          displayName: run.tireType.displayName,
          tireRunNumber: run.tireRunNumber,
          tireAgeKnown: run.tireAgeKnown,
        })
      : undefined;

  resolvedData = normalizeSetupSnapshotForStorage({
    ...resolvedData,
    tires: tireValue || resolvedData.tires,
  });

  const setupDeltaJson = previousId
    ? computeSetupDeltaForAudit(previousData, resolvedData)
    : null;

  const snapshot = await prisma.setupSnapshot.create({
    data: {
      userId: user.id,
      carId: run.carId,
      data: resolvedData as object,
      baseSetupSnapshotId: previousId,
      setupDeltaJson:
        setupDeltaJson && Object.keys(setupDeltaJson).length > 0
          ? (setupDeltaJson as object)
          : undefined,
    },
    select: { id: true, data: true },
  });

  await prisma.run.update({
    where: { id: run.id },
    data: {
      setupSnapshotId: snapshot.id,
      renderedSetupPdfPath: null,
      renderedSetupPdfGeneratedAt: null,
    },
  });

  return NextResponse.json({
    ok: true,
    snapshot: { id: snapshot.id, data: snapshot.data },
  });
}
