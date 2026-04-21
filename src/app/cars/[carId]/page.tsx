import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
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

  const user = await requireCurrentUser();
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

  const tireRunRows = await prisma.run.findMany({
    where: { userId: user.id, carId, tireSetId: { not: null } },
    select: { tireSetId: true },
  });
  const tireIds = [...new Set(tireRunRows.map((r) => r.tireSetId!))];
  const runsOnCarByTire = new Map<string, number>();
  for (const r of tireRunRows) {
    const id = r.tireSetId!;
    runsOnCarByTire.set(id, (runsOnCarByTire.get(id) ?? 0) + 1);
  }
  const tireSetsOnCar =
    tireIds.length > 0
      ? await prisma.tireSet.findMany({
          where: { userId: user.id, id: { in: tireIds } },
          orderBy: [{ label: "asc" }, { setNumber: "asc" }],
          select: { id: true, label: true, setNumber: true },
        })
      : [];
  const latestTireRunGlobal = await prisma.run.findMany({
    where: { userId: user.id, tireSetId: { in: tireIds } },
    orderBy: { createdAt: "desc" },
    select: { tireSetId: true, tireRunNumber: true },
  });
  const globalTireCount = new Map<string, number>();
  for (const r of latestTireRunGlobal) {
    if (r.tireSetId && !globalTireCount.has(r.tireSetId)) {
      globalTireCount.set(r.tireSetId, r.tireRunNumber);
    }
  }

  const batteryRunRows = await prisma.run.findMany({
    where: { userId: user.id, carId, batteryId: { not: null } },
    select: { batteryId: true },
  });
  const batteryIds = [...new Set(batteryRunRows.map((r) => r.batteryId!))];
  const runsOnCarByBattery = new Map<string, number>();
  for (const r of batteryRunRows) {
    const id = r.batteryId!;
    runsOnCarByBattery.set(id, (runsOnCarByBattery.get(id) ?? 0) + 1);
  }
  const batteriesOnCar =
    batteryIds.length > 0
      ? await prisma.battery.findMany({
          where: { userId: user.id, id: { in: batteryIds } },
          orderBy: [{ label: "asc" }, { packNumber: "asc" }],
          select: { id: true, label: true, packNumber: true },
        })
      : [];
  const latestBatteryRunGlobal = await prisma.run.findMany({
    where: { userId: user.id, batteryId: { in: batteryIds } },
    orderBy: { createdAt: "desc" },
    select: { batteryId: true, batteryRunNumber: true },
  });
  const globalBatteryCount = new Map<string, number>();
  for (const r of latestBatteryRunGlobal) {
    if (r.batteryId && !globalBatteryCount.has(r.batteryId)) {
      globalBatteryCount.set(r.batteryId, r.batteryRunNumber);
    }
  }

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

          {car.setupSheetTemplate ? (
            <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm space-y-2">
              <div className="ui-title text-sm text-muted-foreground">Community tuning archetypes</div>
              <p className="text-xs text-muted-foreground">
                Compare this car&apos;s latest setup against low / medium / high grip medians pooled from every
                community-eligible upload sharing this setup sheet template.
              </p>
              <Link
                href={`/cars/${car.id}/grip-archetypes`}
                className="inline-flex rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition"
              >
                Open grip archetypes →
              </Link>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <div className="ui-title text-sm text-muted-foreground">Tires used with this car</div>
            {tireSetsOnCar.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tire sets linked on runs for this car yet. Log a run and select a tire set.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {tireSetsOnCar.map((ts) => (
                  <li
                    key={ts.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-foreground">
                      {ts.label}
                      {ts.setNumber != null ? ` · Set #${ts.setNumber}` : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {runsOnCarByTire.get(ts.id) ?? 0} run{runsOnCarByTire.get(ts.id) === 1 ? "" : "s"} on this car · set
                      total {globalTireCount.get(ts.id) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <div className="ui-title text-sm text-muted-foreground">Batteries used with this car</div>
            {batteriesOnCar.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No batteries linked on runs for this car yet. Log a run and select a battery pack.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {batteriesOnCar.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-foreground">
                      {b.label}
                      {b.packNumber != null ? ` · Pack #${b.packNumber}` : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {runsOnCarByBattery.get(b.id) ?? 0} run{runsOnCarByBattery.get(b.id) === 1 ? "" : "s"} on this car ·
                      pack total {globalBatteryCount.get(b.id) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CarDeleteClient carId={car.id} carName={car.name} runCount={runCount} />
        </div>
      </section>
    </>
  );
}

