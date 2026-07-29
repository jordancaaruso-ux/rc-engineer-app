import "server-only";

import { prisma } from "@/lib/prisma";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { formatRunDateShort } from "@/lib/formatDate";
import {
  buildDashboardSetupCar,
  type CurrentSetupCandidate,
  type DashboardSetups,
} from "@/lib/setup/dashboardSetups";

/**
 * DB reads behind the dashboard's Setups card.
 *
 * This replaced the self-retiring "add a setup" nag (2026-07-29): the ask is now one state of a
 * permanent card, so a driver always has a door to the setup they're running. The nag's own rules
 * survive inside it — no Ignore button, and the Get-set-up card still owns the ask while it's up.
 */

/**
 * What counts as "they have a setup": a named library setup, or one created by reading an uploaded
 * sheet. Per-run snapshots deliberately don't count — every logged run writes one, so counting them
 * would silence the ask after run 1 for someone who has never entered a single value.
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

/** Null when there's nothing to show and nothing to ask for — no cars. */
export async function loadDashboardSetups(
  userId: string,
  timeZone?: string | null
): Promise<DashboardSetups | null> {
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

  const carIds = cars.map((c) => c.id);

  const [hasAnySetup, uploadableModelIds, librarySetups, lastRuns] = await Promise.all([
    userHasAnySetup(userId),
    // Same green-lit rule as the Garage hub: it only decides which door a car opens (read a sheet
    // vs fill one in), never whether we ask.
    setupSheetModelIdsSupportingUpload(cars.map((c) => c.setupSheetModelId)),
    prisma.setupSnapshot.findMany({
      where: { userId, carId: { in: carIds }, isLibrary: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, carId: true },
    }),
    // One indexed lookup per car rather than a windowed query over every run: cars are capped at
    // 25, and Prisma can't take-1-per-group.
    Promise.all(
      carIds.map((carId) =>
        prisma.run
          .findFirst({
            where: { userId, carId },
            orderBy: { createdAt: "desc" },
            select: { carId: true, setupSnapshot: { select: { baseSetupSnapshotId: true } } },
          })
          .then((run) => ({ carId, baselineId: run?.setupSnapshot?.baseSetupSnapshotId ?? null }))
      )
    ),
  ]);

  const setupsByCar = new Map<string, CurrentSetupCandidate[]>();
  for (const s of librarySetups) {
    if (!s.carId) continue;
    const list = setupsByCar.get(s.carId);
    if (list) list.push(s);
    else setupsByCar.set(s.carId, [s]);
  }
  const baselineByCar = new Map(lastRuns.map((r) => [r.carId, r.baselineId]));

  return {
    hasAnySetup,
    cars: cars.map((c) =>
      buildDashboardSetupCar({
        car: {
          id: c.id,
          name: c.name,
          chassisName: c.setupSheetModel?.name ?? null,
          supportsUpload: Boolean(
            c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)
          ),
        },
        lastRunBaselineId: baselineByCar.get(c.id) ?? null,
        librarySetups: setupsByCar.get(c.id) ?? [],
        formatDate: (at) => formatRunDateShort(at, timeZone),
      })
    ),
  };
}
