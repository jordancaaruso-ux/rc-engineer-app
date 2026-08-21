import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  planTireRunNumberCascade,
  withTireRunNumberInSnapshot,
} from "@/lib/tires/cascadeTireRunNumber";

export type TireRunNumberCascadeResult = { updatedRuns: number; delta: number } | null;

/**
 * Shift the rest of a tire set when one run's run-number is corrected.
 *
 * ============================== WHY THIS IS ITS OWN FILE ==============================
 *
 * It used to live inline in `PUT /api/runs`, on the reasoning that the run-number
 * cascade has one home and splitting it across routes is how two copies drift apart.
 * That reasoning is still right — this file IS that one home. What changed is that the
 * run page can now correct a tire set in place (founder call, 2026-08-20), and a sparse
 * correction should not have to round-trip the whole wizard payload to move a number.
 * So the logic moved out to where both callers can reach it, rather than being copied.
 *
 * ============================== WHY A SHIFT, NOT A RENUMBER ==============================
 *
 * See `cascadeTireRunNumber` for the rule itself. The short version: the driver is
 * saying "this run was the 4th on the set, not the 6th", and every run after it on the
 * same rubber is therefore two out as well. Runs on a DIFFERENT stint are untouched —
 * the set this run left is none of its business.
 *
 * `sortAt` is the ordering axis (stamped once at create, so a re-import never reshuffles
 * a day); `createdAt` would move backfilled runs in the wrong direction.
 */
export async function applyTireRunNumberCascade(params: {
  userId: string;
  runId: string;
  /** The stint after the edit. Null (fresh rubber) means there is nothing to carry. */
  tireStintId: string | null;
  /** The stint before the edit. A run that forked onto new rubber leaves its old set alone. */
  previousTireStintId: string | null;
  previousTireRunNumber: number;
  nextTireRunNumber: number;
  /** The corrected run's ordering position — later runs on the set are those after it. */
  sortAt: Date;
}): Promise<TireRunNumberCascadeResult> {
  const delta = params.nextTireRunNumber - params.previousTireRunNumber;
  if (delta === 0) return null;
  // Only when the stint survived the edit. A run that moved to fresh rubber has no
  // later runs of its own to move.
  if (
    params.tireStintId == null ||
    params.previousTireStintId == null ||
    params.tireStintId !== params.previousTireStintId
  ) {
    return null;
  }

  const laterRuns = await prisma.run.findMany({
    where: {
      userId: params.userId,
      tireStintId: params.tireStintId,
      id: { not: params.runId },
      sortAt: { gt: params.sortAt },
    },
    select: { id: true, tireRunNumber: true, setupSnapshotId: true },
    orderBy: { sortAt: "asc" },
  });

  const steps = planTireRunNumberCascade(delta, laterRuns);
  if (steps.length === 0) return null;

  const snapshots = await prisma.setupSnapshot.findMany({
    where: {
      id: { in: steps.map((s) => s.setupSnapshotId).filter((id): id is string => id != null) },
    },
    select: { id: true, data: true },
  });
  const snapshotById = new Map(snapshots.map((s) => [s.id, s.data]));

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const step of steps) {
    writes.push(
      prisma.run.update({
        where: { id: step.runId },
        data: {
          tireRunNumber: step.tireRunNumber,
          // Their Engineer read was computed against the old position on the set, so
          // it is no longer an answer to this run.
          engineerSummaryJson: Prisma.JsonNull,
          engineerSummaryRefRunId: null,
          engineerSummaryComputedAt: null,
        },
      })
    );
    if (!step.setupSnapshotId) continue;
    // The same number lives twice — on the row and inside the snapshot's `tires`
    // value, which is what the sheet and any PDF render.
    const patched = withTireRunNumberInSnapshot(
      snapshotById.get(step.setupSnapshotId),
      step.tireRunNumber
    );
    if (!patched) continue;
    writes.push(
      prisma.setupSnapshot.update({
        where: { id: step.setupSnapshotId },
        data: { data: patched as object },
      })
    );
  }

  await prisma.$transaction(writes);
  await prisma.engineerBetweenRunHint.deleteMany({
    where: { primaryRunId: { in: steps.map((s) => s.runId) } },
  });

  return { updatedRuns: steps.length, delta };
}
