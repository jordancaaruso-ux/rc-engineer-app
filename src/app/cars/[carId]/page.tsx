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
import { showLegacySetupSheetTemplateEdit } from "@/lib/setupSheetTemplateId";
import { CarSetupSheetTemplateEdit } from "@/components/cars/CarSetupSheetTemplateEdit";
import { CarDisciplineEdit } from "@/components/cars/CarDisciplineEdit";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { chassisPlatformLabel } from "@/lib/cars/carClasses";
import { CarSetupsCard } from "@/components/setup/CarSetupsCard";
import { getSetupFillDraftSummaryForCar } from "@/lib/setup/getSetupFillDraft";
import { CarCurrentSetupCard } from "@/components/setup/CarCurrentSetupCard";
import { CarAllSetups } from "@/components/setup/CarAllSetups";
import { getCarSetupHistory } from "@/lib/setup/getCarSetupHistory";
import { UploadSetupSheetBar } from "@/components/setup/UploadSetupSheetBar";
import { carSupportsSheetUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";

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

  const [car, runCount, librarySetups, tireRunRows, setupFillDraft] = await Promise.all([
    prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: {
        id: true,
        name: true,
        chassis: true,
        carClass: true,
        notes: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        createdAt: true,
        setupSheetModel: {
          select: { id: true, name: true, slug: true, userId: true, isAuthorized: true },
        },
      },
    }),
    prisma.run.count({ where: { userId: user.id, carId } }),
    /*
     * The setups the driver chose to keep, whatever they came from.
     *
     * `isLibrary` used to mean "not a run's snapshot", because the only way to keep a run's setup
     * was to copy it. Saving marks the snapshot now, so a run-backed row belongs in this list too —
     * that is the point, and it is why the card offers Rename but not Delete on those.
     */
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
    // An unfinished sequential fill, if any. Summary only — no sheet JSON for one label.
    getSetupFillDraftSummaryForCar(user.id, carId),
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
   * Wave 3 — the reads that genuinely needed `car` first. `setupHistory` wants the whole
   * row; the baselines want `setupSheetModelId`. Independent of each other.
   *
   * The chassis's default calibration used to be read here too, for the authoring card removed on
   * 2026-08-11. It was the card's only reader, and on a chassis with no default it cost a second
   * round trip — so both are gone rather than left fetching for nobody.
   */
  const [setupHistory, baselineCount] = await Promise.all([
    /*
     * Everything this car can be set up with, in one list: runs where the chassis changed, sheets
     * uploaded for it, baselines published for its chassis, and setups the driver kept. The
     * baselines used to be read again here for their own card — `getCarSetupHistory` owns them now.
     */
    getCarSetupHistory({ userId: user.id, car, displayTimeZone }),
    // Only the count, for the upload panel's "start from a baseline" door.
    car.setupSheetModelId
      ? prisma.baselineSetup.count({ where: { setupSheetModelId: car.setupSheetModelId } })
      : 0,
  ]);

  // Whether this car's chassis can be READ from a filled-in sheet. It never hides the upload door
  // — it decides whether that door is live or greyed with the reason under it.
  const supportsUpload = await carSupportsSheetUpload(car);

  /*
   * Discipline: the chassis catalog answers for every car it knows, and only the gap gets a
   * picker (founder call 2026-08-03). Passing `carClass: null` asks what the chassis alone says
   * — when that comes back null there is nothing to infer from and the override is worth asking
   * for; otherwise the car states its own discipline and the question would be the noise that
   * got the original picker deleted.
   */
  const inferredDiscipline = disciplineForCar({ ...car, carClass: null });
  const resolvedDiscipline = disciplineForCar(car);

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
          {/*
            Making a setup is its own job, so it gets its own door at the top of the page — the same
            full-width bar the Garage opens with (founder call 2026-08-11). It used to be a link in
            the "Saved setups" header, which filed "create a setup" under "setups you have kept" and
            read as though the two were related. They are not.
          */}
          <UploadSetupSheetBar
            cars={[
              {
                id: car.id,
                name: car.name,
                chassisName: car.setupSheetModel?.name ?? null,
                supportsUpload,
                baselineCount,
              },
            ]}
            preselectCarId={car.id}
          />

          {setupHistory.current ? (
            <CarCurrentSetupCard carId={car.id} current={setupHistory.current} />
          ) : null}

          <CarSetupsCard
            carId={car.id}
            label="Saved setups"
            fillDraft={
              setupFillDraft
                ? {
                    answeredCount: setupFillDraft.answeredCount,
                    stepCount: setupFillDraft.stepCount,
                    updatedAt: setupFillDraft.updatedAt.toISOString(),
                  }
                : null
            }
            setups={librarySetups.map((s) => ({
              id: s.id,
              name: s.name,
              createdAtLabel: formatRunCreatedAtDateTime(s.createdAt, displayTimeZone),
              usedInRuns: s._count.runs + s._count.derivedSnapshots,
            }))}
          />

          {/*
            Baselines used to be their own card here. They are rows in this list now, under their
            own chip — one place that answers "what setups does this car have", instead of three
            cards the driver had to join up themselves.
          */}
          <CarAllSetups
            carId={car.id}
            entries={setupHistory.entries}
            counts={setupHistory.counts}
            hasMore={setupHistory.hasMore}
            truncated={setupHistory.truncated}
          />

          {/*
            The "Setup sheet model" authoring card was removed 2026-08-11. All four of its doors had
            stopped meaning anything to the person looking at a car:

              - "Edit setup sheet" and "Edit PDF calibration" are workbench jobs, and the workbench
                is at `/setup-sheet-models` where an admin already goes to do them.
              - "Upload new setup for this car" has its own door now, at the top of this page.
              - "View baseline setup PDF" pointed at the example document behind a calibration,
                which is not a thing a driver has any use for.

            It was also about to leak. The card showed for admins OR for the creator of a chassis
            nobody had approved yet — and the blank-sheet upload door (shipped 2026-08-11) makes
            every driver who uploads their own sheet exactly that. So the release-audit rule above
            it, "plain drivers must not see workbench/schema doors", was days from being broken
            without anyone changing the rule.
          */}

          {showLegacySetupSheetTemplateEdit(car.setupSheetModelId, car.setupSheetTemplate) ? (
            <CarSetupSheetTemplateEdit carId={car.id} currentTemplate={car.setupSheetTemplate} />
          ) : null}

          {inferredDiscipline == null ? (
            <CarDisciplineEdit carId={car.id} currentDiscipline={car.carClass} />
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
                    <span className="text-[11px] text-muted-foreground tabular-nums">
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
            <div className="grid gap-2 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Added</span>
                <span className="fig-stat">
                  {formatRunCreatedAtDateTime(car.createdAt, displayTimeZone)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Runs</span>
                <span className="fig-stat">{runCount}</span>
              </div>
              {car.chassis ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Chassis</span>
                  <span className="min-w-0 truncate">{car.chassis}</span>
                </div>
              ) : null}
              {resolvedDiscipline ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Discipline</span>
                  <span className="min-w-0 truncate">
                    {chassisPlatformLabel(resolvedDiscipline)}
                  </span>
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

