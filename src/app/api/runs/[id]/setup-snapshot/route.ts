import { NextResponse } from "next/server";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import { computeSetupDeltaForAudit } from "@/lib/setup/resolveSetupSnapshot";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";

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
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id },
    select: runSelectForPdfReview,
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await viewerMayAccessRun(userId, run))) {
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
    isOwner: run.userId === userId,
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
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id, userId: userId },
    select: {
      id: true,
      carId: true,
      tireTypeId: true,
      tireRunNumber: true,
      tireAgeKnown: true,
      tireType: { select: { id: true, displayName: true } },
      setupSnapshotId: true,
      setupSnapshot: {
        select: {
          id: true,
          data: true,
          // The setup this run was logged AGAINST — the previous run's, usually. Carried forward
          // below so a correction doesn't rewrite what this run changed.
          baseSetupSnapshotId: true,
          baseSetupSnapshot: { select: { id: true, data: true } },
        },
      },
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

  /*
   * A correction replaces the run's snapshot, but it must not replace what the run CHANGED.
   *
   * `setupDeltaJson` is the audit of "what moved since the setup this run was logged against", and
   * the car page filters and chips its whole run history on it. Basing the new delta on the
   * snapshot being replaced would rewrite that to "what I just retyped" — fix one camber value and
   * the run's row stops listing the shock oil and spring it actually changed that day. So the
   * ORIGINAL baseline travels with the correction, and the delta is recomputed against it.
   *
   * A run with no baseline at all is the first setup recorded on that car, which the history reads
   * as "a change by definition" from the null. Keep it null, or correcting a typo would demote it.
   */
  const baseline = run.setupSnapshot?.baseSetupSnapshot ?? null;
  const baselineId = run.setupSnapshot?.baseSetupSnapshotId ?? null;
  const setupDeltaJson = baseline
    ? computeSetupDeltaForAudit(normalizeSetupSnapshotForStorage(baseline.data), resolvedData)
    : null;

  const snapshot = await prisma.setupSnapshot.create({
    data: {
      userId: userId,
      carId: run.carId,
      data: resolvedData as object,
      baseSetupSnapshotId: baselineId,
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

  /*
   * The community pool reads setup values THROUGH runs, so a corrected run changes what everyone
   * else is compared against. Drop the cached reads here; the aggregation tables themselves are
   * rebuilt by `POST /api/setup-aggregations/rebuild`, same as any other run mutation.
   */
  revalidateAfterRunMutation(userId);

  return NextResponse.json({
    ok: true,
    snapshot: { id: snapshot.id, data: snapshot.data },
  });
}
