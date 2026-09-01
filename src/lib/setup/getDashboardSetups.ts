import "server-only";

import { prisma } from "@/lib/prisma";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { baselineCountsByModelId } from "@/lib/baselineSetups/baselineCounts";
import { priorSetupCountsByCarId } from "@/lib/setup/priorSetupCounts";
import type { UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

/**
 * DB reads behind the dashboard's "add a setup sheet" ask (`DashboardAddSetupCard`).
 *
 * For one week (2026-07-29) this also fed a permanent per-car list of the setup each car was
 * running. That list is gone — the reworked Garage leads to setups directly — so all that's left
 * is the cars the ask offers and whether it should show at all.
 */

export type DashboardSetups = {
  cars: UploadSetupCar[];
  /** True once anything counts as a setup, which retires the ask for good. */
  hasAnySetup: boolean;
};

/**
 * What counts as "they have a setup" for onboarding surfaces: a named library setup, one created
 * by reading an uploaded sheet, or — since 2026-08-25 — a run's own snapshot that actually holds
 * numbers.
 *
 * Since 2026-08-11 a driver can SAVE a run's setup, which flips `isLibrary` on that run's own
 * snapshot, so a run-backed row already satisfied the first arm. The third arm is what changed.
 *
 * Run snapshots used to be excluded outright, on the reasoning that every logged run writes one,
 * so counting them would silence the ask after run 1 for someone who never entered a value. Sound,
 * but it assumed those snapshots are empty — and 91% of them are complete setups. A driver with 74
 * runs and 75 fully-filled snapshots against his A800R was being told the car "has no setup yet",
 * which is not a wording problem: the app plainly knew every number on the car.
 *
 * So the question moved from "did you deliberately keep one?" to "do we know what the car is
 * running?" — which is what the surfaces downstream actually need. The empty-shell driver the old
 * rule protected is still asked, because an empty snapshot still fails `setupHoldsValues`.
 *
 * Two queries rather than one on purpose. The indexed test runs first and answers for everyone who
 * ever saved a setup or uploaded a sheet; only drivers who would otherwise be nagged reach the
 * JSON scan, and each of them stops being nagged the moment they pass it.
 */
export async function userHasAnySetup(userId: string): Promise<boolean> {
  const deliberate = await prisma.setupSnapshot.findFirst({
    where: {
      userId,
      OR: [{ isLibrary: true }, { sourceDocuments: { some: {} } }],
    },
    select: { id: true },
  });
  if (deliberate != null) return true;

  /*
   * `setupHoldsValues` in SQL — `data` is JSONB, so Postgres answers this without shipping any
   * setup bodies to Node. `undefined` has no JSON representation, which is why only null and the
   * empty string are excluded here; the TS predicate checks all three so it behaves the same on an
   * in-memory object.
   */
  const withValues = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one
    FROM "SetupSnapshot" s
    WHERE s."userId" = ${userId}
      AND jsonb_typeof(s."data") = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each(s."data") kv
        WHERE kv.value <> 'null'::jsonb AND kv.value <> '""'::jsonb
      )
    LIMIT 1
  `;
  return withValues.length > 0;
}

/** Null when there's nothing to ask for — no cars. */
export async function loadDashboardSetups(userId: string): Promise<DashboardSetups | null> {
  const cars = await prisma.car.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      setupSheetModelId: true,
      setupSheetModel: { select: { name: true } },
    },
    take: 25,
  });
  if (cars.length === 0) return null;

  const [hasAnySetup, uploadableModelIds, baselineCounts, priorSetupCounts] = await Promise.all([
    userHasAnySetup(userId),
    // Same green-lit rule as the Garage hub. It decides whether the upload door is offered or
    // greyed with a reason — never whether we ask, and never which doors exist.
    setupSheetModelIdsSupportingUpload(cars.map((c) => c.setupSheetModelId)),
    baselineCountsByModelId(cars.map((c) => c.setupSheetModelId)),
    priorSetupCountsByCarId(
      userId,
      cars.map((c) => c.id)
    ),
  ]);

  return {
    hasAnySetup,
    cars: cars.map((c) => ({
      id: c.id,
      name: c.name,
      chassisName: c.setupSheetModel?.name ?? null,
      supportsUpload: Boolean(c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)),
      baselineCount: c.setupSheetModelId ? (baselineCounts.get(c.setupSheetModelId) ?? 0) : 0,
      priorSetupCount: priorSetupCounts.get(c.id) ?? 0,
    })),
  };
}
