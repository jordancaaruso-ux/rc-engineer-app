import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { CarList } from "@/components/cars/CarList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { getCachedCarManagerData } from "@/lib/cachedReads";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";
import { isAuthAdminEmail } from "@/lib/authAdmin";

/** User-specific list — cached reads invalidated on car mutations (carsTag). */
export const revalidate = 30;

export default async function CarManagerPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">Car Manager</h1>
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
  // Seed must run each load (it may create catalog rows) — keep it out of the cache.
  await ensureAuthorizedSetupSheetCatalog();
  const [allModels, cars] = await getCachedCarManagerData(user.id);
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

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">Car Manager</h1>
            <p className="page-subtitle">
              Create and manage cars. You need at least one car to log a run.
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <CarList initialCars={cars} setupSheetModels={setupSheetModels} isAdmin={isAdmin} />
        </div>
      </section>
    </>
  );
}

