import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

/**
 * Move a logged run onto a different car.
 *
 * ============================== WHY THE SETUP HAS TO COME WITH IT ==============================
 *
 * A `SetupSnapshot` is owned by a car — the garage lists a car's setups by
 * `carId`, and `/cars/[carId]/setups/[setupId]` refuses a snapshot whose car does
 * not match the URL. So a run that changes car while pointing at the old car's
 * snapshot ends up showing numbers it can no longer open: the run reads fine, and
 * every door out of it 404s.
 *
 * The snapshot therefore travels, as a COPY on the new car. Copy and not a
 * re-point of the existing row, for the same reason every other correction copies:
 * `Run.setupSnapshotId` has no unique constraint, and saving a run's setup to the
 * library flips `isLibrary` on the very row the run points at ("mark, not copy").
 * Rewriting `carId` in place would move a named setup — or another run's record —
 * into a different car's garage.
 *
 * `baseSetupSnapshotId` carries forward untouched: "what this run changed that day"
 * is still true after the run changes car, and it is what the car page filters its
 * history on.
 *
 * ============================== WHAT DELIBERATELY DOES NOT MOVE ==============================
 *
 * The tires and the stint. A tire set is physical rubber, and rubber moves between
 * cars on the same platform — `planCarSwap` says so for the live form, and a
 * correction should not disagree with it. Breaking the stint here would renumber
 * runs on a set that never left the shelf.
 *
 * The day: event, track, session, laps, notes. You did not teleport.
 */
export async function applyRunCarMove(params: {
  userId: string;
  runId: string;
  toCarId: string;
  /** The run's current snapshot, or null when it was logged without one. */
  setupSnapshot: { id: string; data: unknown; baseSetupSnapshotId: string | null } | null;
}): Promise<{ carName: string; setupSnapshotId: string | null }> {
  const car = await prisma.car.findFirst({
    where: { id: params.toCarId, userId: params.userId },
    select: { id: true, name: true },
  });
  if (!car) throw new Error("Car not found");

  let setupSnapshotId: string | null = params.setupSnapshot?.id ?? null;

  if (params.setupSnapshot) {
    const copy = await prisma.setupSnapshot.create({
      data: {
        userId: params.userId,
        carId: car.id,
        data: normalizeSetupSnapshotForStorage(params.setupSnapshot.data) as object,
        baseSetupSnapshotId: params.setupSnapshot.baseSetupSnapshotId,
      },
      select: { id: true },
    });
    setupSnapshotId = copy.id;
  }

  await prisma.run.update({
    where: { id: params.runId },
    data: {
      carId: car.id,
      // The snapshot columns are what a deleted car falls back to, so they follow the car.
      carNameSnapshot: car.name,
      ...(setupSnapshotId ? { setupSnapshotId } : {}),
    },
  });

  return { carName: car.name, setupSnapshotId };
}
