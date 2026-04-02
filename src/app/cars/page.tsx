import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { CarList } from "@/components/cars/CarList";

/** User-specific list — always read fresh (avoids stale tab vs /runs/new). */
export const dynamic = "force-dynamic";

export default async function CarManagerPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Car Manager</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to create and manage cars.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const cars = await prisma.car.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Car Manager</h1>
          <p className="page-subtitle">
            Create and manage cars. You need at least one car to log a run.
          </p>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <CarList initialCars={cars} />
        </div>
      </section>
    </>
  );
}

