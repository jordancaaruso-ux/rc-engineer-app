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
 *
 * ============================== FRONT AND REAR ==============================
 *
 * A front/rear car carries two lives of rubber, each with its own stint and its own count
 * (`Run.frontTire*`, 2026-09-19), so a correction to one end is cascaded down THAT end's stint
 * only — pass `end: "front"`. The snapshot's `tires` value mirrors the rear (or only) tire and
 * nothing else, so a front correction has no second copy to patch.
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
  /** Which end's stint the numbers belong to. Defaults to the rear / only tire. */
  end?: "rear" | "front";
}): Promise<TireRunNumberCascadeResult> {
  const front = params.end === "front";
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

  const laterRows = await prisma.run.findMany({
    where: {
      userId: params.userId,
      ...(front
        ? { frontTireStintId: params.tireStintId }
        : { tireStintId: params.tireStintId }),
      id: { not: params.runId },
      sortAt: { gt: params.sortAt },
    },
    select: { id: true, tireRunNumber: true, frontTireRunNumber: true, setupSnapshotId: true },
    orderBy: { sortAt: "asc" },
  });
  const laterRuns = laterRows.map((r) => ({
    id: r.id,
    tireRunNumber: front ? (r.frontTireRunNumber ?? 1) : r.tireRunNumber,
    // No snapshot to patch for a front correction — see the header.
    setupSnapshotId: front ? null : r.setupSnapshotId,
  }));

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
          ...(front
            ? { frontTireRunNumber: step.tireRunNumber }
            : { tireRunNumber: step.tireRunNumber }),
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
