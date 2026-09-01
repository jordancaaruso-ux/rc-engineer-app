import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import { computeSetupDeltaForAudit } from "@/lib/setup/resolveSetupSnapshot";

/**
 * Writing one corrected setup value onto one run — the primitive behind both the
 * inline edit on `/runs/[id]` and the "later runs had this wrong too" cascade.
 *
 * ============================== WHY COPY-ON-WRITE, ALWAYS ==============================
 *
 * A `SetupSnapshot` row is not private to its run. `Run.setupSnapshotId` has no
 * unique constraint, and saving a run's setup to the car's library FLIPS
 * `isLibrary` on the row the run already points at rather than copying it
 * ("mark, not copy", founder call 2026-08-11 — see
 * `api/setup-snapshots/[id]/save`). So the row under any given run may also be a
 * named setup in the library, or the row another run is reading.
 *
 * Editing `data` in place would therefore rewrite things nobody asked to change.
 * The same reasoning is why `PATCH /api/setup-snapshots/[id]` returns 409 for any
 * snapshot a run points at. Every correction here mints a NEW snapshot and
 * repoints the run at it, which is also what keeps the dashboard-suggestion
 * fingerprints self-invalidating — they key off `setupSnapshotId`.
 *
 * ============================== WHY THE ORIGINAL BASELINE TRAVELS ==============================
 *
 * `setupDeltaJson` is the audit of "what moved since the setup this run was
 * logged against", and the car page filters its whole run history on it. Basing
 * the new delta on the snapshot being replaced would rewrite that to "what I just
 * retyped". So the ORIGINAL `baseSetupSnapshotId` carries forward and the delta is
 * recomputed against it — the same rule `PATCH /api/runs/[id]/setup-snapshot`
 * follows, and for the same reason.
 */

/** A run whose setup is about to be corrected, loaded with everything the write needs. */
export const runSelectForSetupCorrection = {
  id: true,
  userId: true,
  carId: true,
  sortAt: true,
  setupSnapshotId: true,
  setupSnapshot: {
    select: {
      id: true,
      data: true,
      // The paper the setup was born on — a correction is the same setup, one value moved.
      sheetBlankId: true,
      baseSetupSnapshotId: true,
      baseSetupSnapshot: { select: { id: true, data: true } },
    },
  },
} as const;

export type RunForSetupCorrection = Prisma.RunGetPayload<{
  select: typeof runSelectForSetupCorrection;
}>;

/** Read one setup key off a run, for the picker's "says …" column. */
export function setupValueOnRun(run: RunForSetupCorrection, key: string): unknown {
  const data = normalizeSetupSnapshotForStorage(run.setupSnapshot?.data ?? null);
  return data[key];
}

/**
 * The writes that correct `key` to `value` on one run.
 *
 * Returns the prisma promises rather than executing them, so a cascade across
 * several runs lands in ONE transaction — a half-applied correction is a history
 * that disagrees with itself, which is the state this whole feature exists to
 * get out of.
 *
 * Returns null when the run already holds that value: nothing to write, and
 * minting an identical snapshot would churn the run's setup lineage for no reason.
 */
export async function buildSetupCorrectionWrites(params: {
  userId: string;
  run: RunForSetupCorrection;
  key: string;
  /** Trimmed scalar; an empty string clears the field. */
  value: string;
}): Promise<{
  writes: Prisma.PrismaPromise<unknown>[];
  previousValue: unknown;
} | null> {
  const { userId, run, key, value } = params;
  if (!run.carId) return null;

  const current = normalizeSetupSnapshotForStorage(run.setupSnapshot?.data ?? null);
  const previousValue = current[key];

  const nextData: SetupSnapshotData = normalizeSetupSnapshotForStorage({
    ...current,
    // An empty string is dropped by the normalizer, which is how a field is cleared.
    [key]: value,
  });

  // Nothing moved — the caller ticked a run that already agreed.
  if (JSON.stringify(nextData[key] ?? null) === JSON.stringify(previousValue ?? null)) {
    return null;
  }

  const baseline = run.setupSnapshot?.baseSetupSnapshot ?? null;
  const baselineId = run.setupSnapshot?.baseSetupSnapshotId ?? null;
  const setupDeltaJson = baseline
    ? computeSetupDeltaForAudit(normalizeSetupSnapshotForStorage(baseline.data), nextData)
    : null;

  // Minted up front rather than inside the transaction: `prisma.$transaction`
  // takes an array of promises, so the new run row needs an id it can point at
  // before the array is built.
  const snapshot = await prisma.setupSnapshot.create({
    data: {
      userId,
      carId: run.carId,
      data: nextData as object,
      baseSetupSnapshotId: baselineId,
      sheetBlankId: run.setupSnapshot?.sheetBlankId ?? null,
      setupDeltaJson:
        setupDeltaJson && Object.keys(setupDeltaJson).length > 0
          ? (setupDeltaJson as object)
          : undefined,
    },
    select: { id: true },
  });

  return {
    previousValue,
    writes: [
      prisma.run.update({
        where: { id: run.id },
        data: {
          setupSnapshotId: snapshot.id,
          // The filled sheet is drawn from the snapshot, so the cached picture is
          // now a picture of the wrong numbers.
          renderedSetupPdfPath: null,
          renderedSetupPdfGeneratedAt: null,
          /*
           * The Engineer's cached read of this run diffs its setup against the
           * reference run's, so a corrected value makes that summary an answer to
           * a question nobody asked any more.
           *
           * `PATCH /api/runs/[id]/setup-snapshot` has never cleared this — its
           * `fieldFingerprint` is built only from lap material, so a setup change
           * slips straight past the staleness check. Corrections made through this
           * path do clear it; the older route now does too.
           */
          engineerSummaryJson: Prisma.JsonNull,
          engineerSummaryRefRunId: null,
          engineerSummaryComputedAt: null,
        },
      }),
      // Between-run hints are fingerprinted on the setup either side of the gap.
      prisma.engineerBetweenRunHint.deleteMany({ where: { primaryRunId: run.id } }),
    ],
  };
}

/**
 * Clear the Engineer reads that were computed AGAINST a corrected run.
 *
 * Most of what the Engineer says about a run is a comparison with its neighbour —
 * "you went softer on the rear and lost half a second". Correcting run 4
 * therefore invalidates run 5's summary as surely as run 4's own, and the hint
 * spanning the gap between them cites both. Only the corrected run is cleared by
 * the write above; this is the other side of every gap it touched.
 *
 * Deliberately NOT cleared: `engineerDeepDiveJson`. That is an answer the driver
 * asked for and read, not a fingerprinted cache, and throwing it away over a
 * typo correction loses something they can't get back with a refresh.
 */
export async function clearEngineerReadsReferencing(
  userId: string,
  correctedRunIds: readonly string[]
): Promise<void> {
  if (correctedRunIds.length === 0) return;
  const ids = [...correctedRunIds];
  await Promise.all([
    prisma.run.updateMany({
      where: { userId, engineerSummaryRefRunId: { in: ids } },
      data: {
        engineerSummaryJson: Prisma.JsonNull,
        engineerSummaryRefRunId: null,
        engineerSummaryComputedAt: null,
      },
    }),
    prisma.engineerBetweenRunHint.deleteMany({
      where: { userId, OR: [{ primaryRunId: { in: ids } }, { referenceRunId: { in: ids } }] },
    }),
  ]);
}
