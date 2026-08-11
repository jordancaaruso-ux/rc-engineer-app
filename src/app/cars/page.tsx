import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { CarList, type CarInlineSetup } from "@/components/cars/CarList";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";
import { CardPanel } from "@/components/ui/CardPanel";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { baselineCountsByModelId } from "@/lib/baselineSetups/baselineCounts";
import { getCachedCarManagerData } from "@/lib/cachedReads";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE } from "@/lib/setupDocuments/driverVisibleDocuments";

/**
 * Garage — the cars & setups index, and the Garage tab's destination. A setup belongs to a car, so
 * the first question is "which car?", and everything that car has been set up with lives on the car
 * page. Absorbed the old "My setups" index (2026-07-22) and then the `/assets` hub itself
 * (2026-07-29): the hub listed the same setups one tap deeper and mixed in shared catalogs, which
 * now live under Settings. `/setup`, `/assets` and `/garage` all redirect here.
 *
 * Not cached at the page level: the setup counts and the upload gate move with every upload.
 */
type CarsPageSearchParams = {
  /** Pre-select a car for the sheet upload (must be the user's car). */
  carId?: string;
};

export default async function CarManagerPage({
  searchParams,
}: {
  searchParams?: Promise<CarsPageSearchParams>;
}): Promise<ReactNode> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const preselectCarId =
    typeof resolvedSearchParams.carId === "string" && resolvedSearchParams.carId.trim()
      ? resolvedSearchParams.carId.trim()
      : null;

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">Garage</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to create and manage cars.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const isAdmin = isAuthAdminEmail(user.email);
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
  // Seed must run each load (it may create catalog rows) — keep it out of the cache.
  await ensureAuthorizedSetupSheetCatalog();

  const [[allModels, cars], librarySetups, sheetCounts, unlinkedSheetCount, lastRunByCar] =
    await Promise.all([
      getCachedCarManagerData(user.id),
      // Every saved setup in one query — it feeds both the per-car meta line and the inline list.
      prisma.setupSnapshot.findMany({
        where: { userId: user.id, isLibrary: true, carId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          createdAt: true,
          carId: true,
          _count: { select: { runs: true, derivedSnapshots: true } },
        },
      }),
      prisma.setupDocument.groupBy({
        by: ["carId"],
        where: { userId: user.id, ...DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE, carId: { not: null } },
        _count: { _all: true },
      }),
      prisma.setupDocument.count({
        where: { userId: user.id, ...DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE, carId: null },
      }),
      prisma.run.groupBy({
        by: ["carId"],
        where: { userId: user.id, carId: { not: null } },
        _max: { createdAt: true },
      }),
    ]);

  const authById = new Map(allModels.map((m) => [m.id, m.isAuthorized] as const));
  const setupSheetModels = dedupeSetupSheetModelsForPicker(
    allModels.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      carCount: m._count.cars,
      calibrationCount: m._count.calibrations,
      // Passed IN, not just stitched back on afterwards: the dedupe score has to see it, or a
      // driver-authored duplicate can win its name group before the badge is ever applied.
      isAuthorized: m.isAuthorized,
    }))
  ).map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    isAuthorized: authById.get(m.id) ?? false,
  }));

  const setupsByCarId: Record<string, CarInlineSetup[]> = {};
  for (const s of librarySetups) {
    const carId = s.carId ?? "";
    (setupsByCarId[carId] ??= []).push({
      id: s.id,
      name: s.name,
      createdAtLabel: formatRunCreatedAtDateTime(s.createdAt, displayTimeZone),
      usedInRuns: s._count.runs + s._count.derivedSnapshots,
    });
  }
  const sheetsByCar = new Map(sheetCounts.map((r) => [r.carId ?? "", r._count._all]));
  const lastRunAt = new Map(lastRunByCar.map((r) => [r.carId ?? "", r._max.createdAt]));

  const setupMetaById: Record<string, string> = {};
  for (const car of cars) {
    const saved = setupsByCarId[car.id]?.length ?? 0;
    const sheets = sheetsByCar.get(car.id) ?? 0;
    const last = lastRunAt.get(car.id) ?? null;
    const parts = [
      sheets > 0 ? `${sheets} sheet${sheets === 1 ? "" : "s"}` : null,
      saved > 0 ? `${saved} baseline${saved === 1 ? "" : "s"}` : null,
      last ? `last run ${formatRunDateOnly(last, displayTimeZone)}` : null,
    ].filter(Boolean);
    if (parts.length > 0) setupMetaById[car.id] = parts.join(" · ");
  }

  // Every car gets all three doors, so the bar lists them all. `supportsUpload` (a green-lit
  // calibration) and the baseline count only decide which doors are live and which are greyed
  // with a reason under them.
  const [uploadableModelIds, baselineCounts] = await Promise.all([
    setupSheetModelIdsSupportingUpload(cars.map((c) => c.setupSheetModelId ?? null)),
    baselineCountsByModelId(cars.map((c) => c.setupSheetModelId ?? null)),
  ]);
  const uploadCars: UploadSetupCar[] = cars.map((c) => ({
    id: c.id,
    name: c.name,
    chassisName: c.setupSheetModel?.name ?? null,
    supportsUpload: Boolean(c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)),
    baselineCount: c.setupSheetModelId ? (baselineCounts.get(c.setupSheetModelId) ?? 0) : 0,
  }));

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Garage</h1>
          <p className="page-subtitle">Your cars and every setup on them.</p>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          {uploadCars.length > 0 ? (
            <UploadSetupSheetBar cars={uploadCars} preselectCarId={preselectCarId} />
          ) : null}

          <CarList
            initialCars={cars}
            uploadCars={uploadCars}
            setupSheetModels={setupSheetModels}
            setupMetaById={setupMetaById}
            setupsByCarId={setupsByCarId}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/setup-documents"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {unlinkedSheetCount > 0
                ? `${unlinkedSheetCount} sheet${unlinkedSheetCount === 1 ? "" : "s"} not linked to a car`
                : "All uploaded sheets"}
            </Link>
            {isAdmin ? (
              <Link
                href="/setup/admin"
                className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Admin tools
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
