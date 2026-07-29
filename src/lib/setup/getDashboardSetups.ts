import "server-only";

import { prisma } from "@/lib/prisma";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
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
 * What counts as "they have a setup" for onboarding surfaces: a named library setup, or one
 * created by reading an uploaded sheet. Per-run snapshots deliberately don't count — every
 * logged run writes one, so counting them would silence the ask after run 1 for someone who has
 * never entered a single value.
 */
export async function userHasAnySetup(userId: string): Promise<boolean> {
  const existing = await prisma.setupSnapshot.findFirst({
    where: {
      userId,
      OR: [{ isLibrary: true }, { sourceDocuments: { some: {} } }],
    },
    select: { id: true },
  });
  return existing != null;
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

  const [hasAnySetup, uploadableModelIds] = await Promise.all([
    userHasAnySetup(userId),
    // Same green-lit rule as the Garage hub: it only decides which door a car opens (read a sheet
    // vs fill one in), never whether we ask.
    setupSheetModelIdsSupportingUpload(cars.map((c) => c.setupSheetModelId)),
  ]);

  return {
    hasAnySetup,
    cars: cars.map((c) => ({
      id: c.id,
      name: c.name,
      chassisName: c.setupSheetModel?.name ?? null,
      supportsUpload: Boolean(c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)),
    })),
  };
}
