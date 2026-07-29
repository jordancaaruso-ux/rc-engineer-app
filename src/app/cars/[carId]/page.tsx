import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import Link from "next/link";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CarDeleteClient } from "@/components/cars/CarDeleteClient";
import {
  CarSetupSheetModelCard,
  showLegacySetupSheetTemplateEdit,
} from "@/components/cars/CarSetupSheetModelCard";
import { CarSetupSheetTemplateEdit } from "@/components/cars/CarSetupSheetTemplateEdit";
import { CarSetupsCard } from "@/components/setup/CarSetupsCard";
import { CarCurrentSetupCard } from "@/components/setup/CarCurrentSetupCard";
import { CarSetupHistory } from "@/components/setup/CarSetupHistory";
import { getCarSetupHistory } from "@/lib/setup/getCarSetupHistory";

export default async function CarDetailPage(props: {
  params: Promise<{ carId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <div>
              <h1 className="page-title">Car</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view cars.
          </CardPanel>
        </section>
      </>
    );
  }

  /*
   * Four waves, not ten sequential awaits. A round trip to the database costs ~16ms
   * regardless of how trivial the query is, so the count that matters is how many of
   * them happen in a row — this page used to spend ~130ms doing nothing but waiting.
   *
   * Only `car` genuinely gates anything: the run count, the library setups, and the
   * tire rows need nothing but `user.id` and `carId`. They are issued alongside the
   * car lookup and are wasted only when the id is bad, which is a typo, not a path.
   */
  const [user, { carId }, displayTimeZone] = await Promise.all([
    requireCurrentUser(),
    props.params,
    getExplicitTimeZoneForRunFormatting(),
  ]);

  const [car, runCount, librarySetups, tireRunRows] = await Promise.all([
    prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: {
        id: true,
        name: true,
        chassis: true,
        notes: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        createdAt: true,
        setupSheetModel: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.run.count({ where: { userId: user.id, carId } }),
    // The car's saved baselines. `isLibrary` keeps per-run snapshots out of this list —
    // those are history and belong to the setup history below.
    prisma.setupSnapshot.findMany({
      where: { userId: user.id, carId, isLibrary: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { runs: true, derivedSnapshots: true } },
      },
    }),
    prisma.run.findMany({
      where: { userId: user.id, carId, tireTypeId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        tireTypeId: true,
        tireRunNumber: true,
        tireType: { select: { displayName: true } },
      },
    }),
  ]);

  if (!car) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <div>
              <h1 className="page-title">Car</h1>
              <p className="page-subtitle">Not found.</p>
            </div>
          </div>
        </header>
      </>
    );
  }

  /*
   * Wave 3 — the two reads that genuinely needed `car` first. `setupHistory` wants the
   * whole row; `modelRow` wants `setupSheetModelId`. Independent of each other.
   */
  const [setupHistory, modelRow] = await Promise.all([
    // Everything this car has been set up with: newest run's setup, then the chassis
    // changes and uploaded sheets behind it.
    getCarSetupHistory({ userId: user.id, car, displayTimeZone }),
    // Setup sheet models are global — never scope this read by userId.
    car.setupSheetModelId
      ? prisma.setupSheetModel.findUnique({
          where: { id: car.setupSheetModelId },
          select: {
            defaultCalibrationId: true,
            defaultCalibration: {
              select: { id: true, name: true, exampleDocumentId: true },
            },
          },
        })
      : null,
  ]);

  const runsOnCarByTire = new Map<string, number>();
  /** Highest run count reached on this compound — a rough "how far you've taken it". */
  const furthestRunByTire = new Map<string, number>();
  const tireSetsOnCar: Array<{ id: string; label: string }> = [];
  for (const r of tireRunRows) {
    const id = r.tireTypeId!;
    runsOnCarByTire.set(id, (runsOnCarByTire.get(id) ?? 0) + 1);
    furthestRunByTire.set(id, Math.max(furthestRunByTire.get(id) ?? 0, r.tireRunNumber));
    if (!tireSetsOnCar.some((t) => t.id === id)) {
      tireSetsOnCar.push({ id, label: r.tireType?.displayName ?? "Tires" });
    }
  }
  tireSetsOnCar.sort((a, b) => a.label.localeCompare(b.label));

  // Falls back to the most recently touched calibration only when the model has no
  // default — one extra round trip, and only on that branch.
  const modelCalibration =
    modelRow?.defaultCalibration
    ?? (car.setupSheetModelId
      ? await prisma.setupSheetCalibration.findFirst({
          where: { setupSheetModelId: car.setupSheetModelId },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, exampleDocumentId: true },
        })
      : null);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/cars" />
          <div>
            <h1 className="page-title">{car.name}</h1>
            <p className="page-subtitle">
              {car.setupSheetModel?.name ?? car.chassis ?? "No chassis type"}
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          {setupHistory.current ? (
            <CarCurrentSetupCard carId={car.id} current={setupHistory.current} />
          ) : null}

          <CarSetupsCard
            carId={car.id}
            label="Saved baselines"
            setups={librarySetups.map((s) => ({
              id: s.id,
              name: s.name,
              createdAtLabel: formatRunCreatedAtDateTime(s.createdAt, displayTimeZone),
              usedInRuns: s._count.runs + s._count.derivedSnapshots,
            }))}
          />

          <CarSetupHistory
            entries={setupHistory.entries}
            hasMore={setupHistory.hasMore}
            truncated={setupHistory.truncated}
          />

          {car.setupSheetModel ? (
            <CarSetupSheetModelCard
              carId={car.id}
              model={car.setupSheetModel}
              calibrationId={modelCalibration?.id ?? null}
              calibrationName={modelCalibration?.name ?? null}
              exampleDocumentId={modelCalibration?.exampleDocumentId ?? null}
            />
          ) : null}

          {showLegacySetupSheetTemplateEdit(car.setupSheetModelId, car.setupSheetTemplate) ? (
            <CarSetupSheetTemplateEdit carId={car.id} currentTemplate={car.setupSheetTemplate} />
          ) : null}

          {car.setupSheetTemplate && !car.setupSheetModelId ? (
            <CardPanel contentClassName="text-sm space-y-2">
              <Eyebrow>Community tuning archetypes</Eyebrow>
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
            </CardPanel>
          ) : null}

          <CardPanel contentClassName="space-y-3">
            <Eyebrow>Tires used with this car</Eyebrow>
            {tireSetsOnCar.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tires logged on runs for this car yet. Log a run and pick a compound.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {tireSetsOnCar.map((ts) => (
                  <li
                    key={ts.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-foreground">{ts.label}</span>
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                      {runsOnCarByTire.get(ts.id) ?? 0} run{runsOnCarByTire.get(ts.id) === 1 ? "" : "s"} on this car ·
                      taken to run {furthestRunByTire.get(ts.id) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardPanel>

          <CardPanel contentClassName="space-y-3">
            <Eyebrow>Car</Eyebrow>
            <div className="grid gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Added</span>
                <span className="font-mono tabular-nums">
                  {formatRunCreatedAtDateTime(car.createdAt, displayTimeZone)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Runs</span>
                <span className="font-mono tabular-nums">{runCount}</span>
              </div>
              {car.chassis ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Chassis</span>
                  <span className="min-w-0 truncate">{car.chassis}</span>
                </div>
              ) : null}
              {car.notes ? (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">Notes</span>
                  <span>{car.notes}</span>
                </div>
              ) : null}
            </div>
          </CardPanel>

          <CarDeleteClient carId={car.id} carName={car.name} runCount={runCount} />
        </div>
      </section>
    </>
  );
}

