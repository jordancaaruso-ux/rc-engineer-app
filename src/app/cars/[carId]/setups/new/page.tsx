import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { formatRunDateShort } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { NewCarSetupClient } from "@/components/setup/NewCarSetupClient";

/**
 * First fill for a new library setup on a car.
 *
 * The three starting points, in the order a driver actually wants them (founder call 2026-07-29):
 *  - previous setup → any of this car's recent snapshots, picked from a dropdown. Was a single
 *                     "your last setup"; adjusting the one you're on is the common case, and it
 *                     isn't always the newest row.
 *  - kit setup      → `SetupSheetModel.kitSetupJson` (admin-entered, catalog models only)
 *  - empty          → always available
 */

/**
 * How many previous setups the dropdown offers. Their values ship with the page so switching
 * between them is instant; keep this modest — each carries a full sheet of values.
 */
const PREVIOUS_SETUPS_LIMIT = 12;
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

  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();

  // Baselines, run snapshots and sheet-created setups share one table, so a single read covers
  // every "start from something I already have" case.
  const previousSnapshots = await prisma.setupSnapshot.findMany({
    where: { userId: user.id, carId },
    orderBy: { createdAt: "desc" },
    take: PREVIOUS_SETUPS_LIMIT,
    select: {
      id: true,
      name: true,
      data: true,
      isLibrary: true,
      createdAt: true,
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
          track: { select: { name: true } },
          trackNameSnapshot: true,
          event: { select: { name: true } },
        },
      },
      sourceDocuments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { originalFilename: true },
      },
    },
  });

  // Same three-way discrimination the read-only setup page uses for its title.
  const previousSetups = previousSnapshots.map((s) => {
    const run = s.runs[0] ?? null;
    const document = s.sourceDocuments[0] ?? null;
    const label = s.isLibrary
      ? (s.name ?? "Untitled baseline")
      : run
        ? [
            run.event?.name ?? null,
            formatRunSessionDisplay(run, { fallback: "Testing run" }),
            run.track?.name ?? run.trackNameSnapshot ?? null,
          ]
            .filter(Boolean)
            .join(" · ")
        : (document?.originalFilename.replace(/\.[a-z0-9]+$/i, "") ?? "Setup");
    return {
      id: s.id,
      label,
      kind: s.isLibrary ? ("baseline" as const) : run ? ("run" as const) : ("sheet" as const),
      dateLabel: formatRunDateShort(s.createdAt, displayTimeZone),
      data: normalizeSetupData(s.data),
    };
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
            previousSetups={previousSetups}
          />
        </div>
      </section>
    </>
  );
}
