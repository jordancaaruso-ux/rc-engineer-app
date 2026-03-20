import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { CarList } from "@/components/cars/CarList";

export default async function CarManagerPage() {
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
          <div className="max-w-2xl rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
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

