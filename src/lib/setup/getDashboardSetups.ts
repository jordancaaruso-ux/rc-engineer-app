import "server-only";

import { prisma } from "@/lib/prisma";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { formatRunDateShort } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  buildDashboardSetupCar,
  type CurrentSetupCandidate,
  type LastRunSetupRef,
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
 * What counts as "they have a setup" for onboarding surfaces: a named library setup, or one
 * created by reading an uploaded sheet. Per-run snapshots deliberately don't count here — every
 * logged run writes one, so counting them would silence the onboarding ask after run 1 for
 * someone who has never entered a single value. The dashboard card widens this itself: a car
 * with a logged run has a current setup by definition (see `loadDashboardSetups`).
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

  const [hasLibraryOrSheetSetup, uploadableModelIds, librarySetups, lastRuns] = await Promise.all([
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
    // 25, and Prisma can't take-1-per-group. `sortAt` matches Sessions' ordering axis.
    Promise.all(
      carIds.map((carId) =>
        prisma.run
          .findFirst({
            where: { userId, carId },
            orderBy: { sortAt: "desc" },
            select: {
              carId: true,
              createdAt: true,
              sortAt: true,
              sessionType: true,
              meetingSessionType: true,
              meetingSessionCode: true,
              sessionLabel: true,
              setupSnapshotId: true,
              track: { select: { name: true } },
              trackNameSnapshot: true,
              trackLayout: { select: { name: true } },
            },
          })
          .then((run): { carId: string; lastRun: LastRunSetupRef | null } => {
            if (!run?.setupSnapshotId) return { carId, lastRun: null };
            const sessionDisplay = formatRunSessionDisplay(run);
            const label = [
              sessionDisplay === "—" ? null : sessionDisplay,
              run.track?.name ?? run.trackNameSnapshot ?? null,
              run.trackLayout?.name ?? null,
            ]
              .filter(Boolean)
              .join(" · ");
            return {
              carId,
              lastRun: {
                setupSnapshotId: run.setupSnapshotId,
                sessionLabel: label,
                at: run.sortAt ?? run.createdAt,
              },
            };
          })
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
  const lastRunByCar = new Map(lastRuns.map((r) => [r.carId, r.lastRun]));

  // Cars you actually drive first, most recent outing on top; never-run cars keep their
  // created order below (founder call 2026-07-29 — the A800R should not sit under twelve
  // runless cars).
  const sortedCars = [...cars].sort((a, b) => {
    const aAt = lastRunByCar.get(a.id)?.at?.getTime() ?? 0;
    const bAt = lastRunByCar.get(b.id)?.at?.getTime() ?? 0;
    return bAt - aAt;
  });

  const hasAnyRunSetup = lastRuns.some((r) => r.lastRun != null);

  return {
    hasAnySetup: hasLibraryOrSheetSetup || hasAnyRunSetup,
    cars: sortedCars.map((c) =>
      buildDashboardSetupCar({
        car: {
          id: c.id,
          name: c.name,
          chassisName: c.setupSheetModel?.name ?? null,
          supportsUpload: Boolean(
            c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)
          ),
        },
        lastRun: lastRunByCar.get(c.id) ?? null,
        librarySetups: setupsByCar.get(c.id) ?? [],
        formatDate: (at) => formatRunDateShort(at, timeZone),
      })
    ),
  };
}
