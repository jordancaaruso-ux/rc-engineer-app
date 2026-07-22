import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { CarList } from "@/components/cars/CarList";
import { NewSetupUploadButton } from "@/components/setup/NewSetupUploadButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { getCachedCarManagerData } from "@/lib/cachedReads";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";
import { isAuthAdminEmail } from "@/lib/authAdmin";

/**
 * Cars & setups — one index for both. A setup belongs to a car, so the first question is "which
 * car?", and everything that car has been set up with lives on the car page. This absorbed the old
 * "My setups" index (founder call 2026-07-22); `/setup` now redirects here.
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">Cars &amp; setups</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
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

  const [[allModels, cars], savedCounts, sheetCounts, unlinkedSheetCount, lastRunByCar] =
    await Promise.all([
      getCachedCarManagerData(user.id),
      // One grouped count each instead of a query per car — the index stays flat as the garage grows.
      prisma.setupSnapshot.groupBy({
        by: ["carId"],
        where: { userId: user.id, isLibrary: true, carId: { not: null } },
        _count: { _all: true },
      }),
      prisma.setupDocument.groupBy({
        by: ["carId"],
        where: { userId: user.id, setupImportBatchId: null, carId: { not: null } },
        _count: { _all: true },
      }),
      prisma.setupDocument.count({
        where: { userId: user.id, setupImportBatchId: null, carId: null },
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
    }))
  ).map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    isAuthorized: authById.get(m.id) ?? false,
  }));

  const savedByCar = new Map(savedCounts.map((r) => [r.carId ?? "", r._count._all]));
  const sheetsByCar = new Map(sheetCounts.map((r) => [r.carId ?? "", r._count._all]));
  const lastRunAt = new Map(lastRunByCar.map((r) => [r.carId ?? "", r._max.createdAt]));

  const setupMetaById: Record<string, string> = {};
  for (const car of cars) {
    const saved = savedByCar.get(car.id) ?? 0;
    const sheets = sheetsByCar.get(car.id) ?? 0;
    const last = lastRunAt.get(car.id) ?? null;
    const parts = [
      sheets > 0 ? `${sheets} sheet${sheets === 1 ? "" : "s"}` : null,
      saved > 0 ? `${saved} baseline${saved === 1 ? "" : "s"}` : null,
      last ? `last run ${formatRunDateOnly(last, displayTimeZone)}` : null,
    ].filter(Boolean);
    if (parts.length > 0) setupMetaById[car.id] = parts.join(" · ");
  }

  // Upload only reads values on a calibrated chassis, so drivers see it only when they own one.
  // Admins always keep it — the chassis workbench sends them here to run test reads.
  const uploadableModelIds = await setupSheetModelIdsSupportingUpload(
    cars.map((c) => c.setupSheetModelId ?? null)
  );
  const uploadableCars = cars.filter(
    (c) => c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)
  );
  const showUploadButton = isAdmin || uploadableCars.length > 0;
  const uploadPickerCars = isAdmin ? cars : uploadableCars;
  const preselectModelId = preselectCarId
    ? (cars.find((c) => c.id === preselectCarId)?.setupSheetModelId ?? null)
    : null;

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">Cars &amp; setups</h1>
            <p className="page-subtitle">
              Pick a car to see everything it has been set up with.
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          {showUploadButton ? (
            <div className="flex justify-end">
              <NewSetupUploadButton
                defaultSetupSheetModelId={preselectModelId}
                defaultCarId={preselectCarId}
                cars={uploadPickerCars.map((c) => ({ id: c.id, name: c.name }))}
              />
            </div>
          ) : null}

          <CarList
            initialCars={cars}
            setupSheetModels={setupSheetModels}
            isAdmin={isAdmin}
            setupMetaById={setupMetaById}
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
