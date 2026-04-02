import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import Link from "next/link";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { CarDeleteClient } from "@/components/cars/CarDeleteClient";
import { CarSetupSheetTemplateEdit } from "@/components/cars/CarSetupSheetTemplateEdit";

export default async function CarDetailPage(props: {
  params: Promise<{ carId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Car</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view cars.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const { carId } = await props.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, createdAt: true },
  });

  if (!car) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Car</h1>
            <p className="page-subtitle">Not found.</p>
          </div>
          <Link
            href="/cars"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back
          </Link>
        </header>
      </>
    );
  }

  const runCount = await prisma.run.count({
    where: { userId: user.id, carId },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{car.name}</h1>
          <p className="page-subtitle">Car details and safe delete.</p>
        </div>
        <Link
          href="/cars"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back
        </Link>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="grid gap-2">
              <div><span className="text-sm font-medium text-muted-foreground">Created</span> <span className="ml-2">{formatRunCreatedAtDateTime(car.createdAt)}</span></div>
              <div><span className="text-sm font-medium text-muted-foreground">Runs</span> <span className="ml-2">{runCount}</span></div>
              {car.chassis ? (
                <div><span className="text-sm font-medium text-muted-foreground">Chassis</span> <span className="ml-2">{car.chassis}</span></div>
              ) : null}
              {car.notes ? (
                <div><span className="text-sm font-medium text-muted-foreground">Notes</span> <span className="ml-2">{car.notes}</span></div>
              ) : null}
            </div>
          </div>

          <CarSetupSheetTemplateEdit carId={car.id} currentTemplate={car.setupSheetTemplate} />

          <CarDeleteClient carId={car.id} carName={car.name} runCount={runCount} />
        </div>
      </section>
    </>
  );
}

