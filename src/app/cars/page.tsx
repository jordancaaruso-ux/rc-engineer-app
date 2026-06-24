import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { CarList } from "@/components/cars/CarList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { ensureAuthorizedSetupSheetCatalog } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { dedupeSetupSheetModelsForPicker } from "@/lib/setupSheetModels/pickerModels";

/** User-specific list — revalidated on car mutations. */
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
  await ensureAuthorizedSetupSheetCatalog();
  const [allModels, cars] = await Promise.all([
    prisma.setupSheetModel.findMany({
      orderBy: [{ isAuthorized: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        isAuthorized: true,
        _count: { select: { cars: true, calibrations: true } },
      },
    }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        chassis: true,
        notes: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        setupSheetModel: { select: { id: true, name: true } },
      },
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
          <CarList initialCars={cars} setupSheetModels={setupSheetModels} />
        </div>
      </section>
    </>
  );
}

