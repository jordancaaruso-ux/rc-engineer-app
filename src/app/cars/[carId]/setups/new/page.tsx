import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { NewCarSetupClient } from "@/components/setup/NewCarSetupClient";

/**
 * Sequential first fill for a new library setup on a car.
 *
 * The three starting points come from three different places, all optional:
 *  - kit setup     → `SetupSheetModel.kitSetupJson` (admin-entered, catalog models only)
 *  - last setup    → the car's most recent snapshot, library or run — whichever is newest
 *  - empty         → always available
 */
export default async function NewCarSetupPage(props: {
  params: Promise<{ carId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <h1 className="page-title">New setup</h1>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to create setups.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const { carId } = await props.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) notFound();

  const template = await getSetupSheetTemplateForCar(user.id, car, "setup");

  // Setup sheet models are global — never scope this read by userId.
  const model = car.setupSheetModelId
    ? await prisma.setupSheetModel.findUnique({
        where: { id: car.setupSheetModelId },
        select: { kitSetupJson: true },
      })
    : null;
  const kitSetup: SetupSnapshotData | null = model?.kitSetupJson
    ? normalizeSetupData(model.kitSetupJson)
    : null;

  const lastSnapshot = await prisma.setupSnapshot.findFirst({
    where: { userId: user.id, carId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, data: true },
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/cars/${car.id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">New setup</h1>
            <p className="page-subtitle truncate">{car.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <NewCarSetupClient
            carId={car.id}
            carName={car.name}
            template={template}
            kitSetup={kitSetup}
            lastSetup={
              lastSnapshot
                ? {
                    id: lastSnapshot.id,
                    name: lastSnapshot.name,
                    data: normalizeSetupData(lastSnapshot.data),
                  }
                : null
            }
          />
        </div>
      </section>
    </>
  );
}
