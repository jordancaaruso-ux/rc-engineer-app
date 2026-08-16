import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { normalizeSetupData } from "@/lib/runSetup";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import {
  BASELINE_KIND_LABEL,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";
import { ReadOnlySetupSheet } from "@/components/setup/ReadOnlySetupSheet";
import { ReadOnlySheetSurface } from "@/components/setup/ReadOnlySheetSurface";
import { CopyBaselineButton } from "@/components/setup/CopyBaselineButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

/**
 * Read a published baseline against one of your cars.
 *
 * Baselines are global `BaselineSetup` rows, not `SetupSnapshot`s, which is why they cannot open at
 * `/cars/[carId]/setups/[id]` and why the All-setups row used to open nothing at all. They are also
 * the one kind of setup with no in-place edit, ever: everyone racing this chassis reads the same
 * row. The door out is a copy, which is the driver's from the moment it exists.
 *
 * Scoped to the car's chassis on purpose — a baseline for another model would be a different car's
 * numbers on this car's sheet, and the copy endpoint refuses the same pairing.
 */
export default async function CarBaselineViewPage(props: {
  params: Promise<{ carId: string; baselineId: string }>;
}): Promise<ReactNode> {
  const { carId, baselineId } = await props.params;

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <h1 className="page-title">Baseline</h1>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) notFound();

  // Global row — never scoped by userId, only by the chassis it was published against.
  const baseline = await prisma.baselineSetup.findUnique({
    where: { id: baselineId },
    select: {
      id: true,
      name: true,
      kind: true,
      notes: true,
      surface: true,
      gripLevel: true,
      data: true,
      setupSheetModelId: true,
    },
  });
  if (!baseline) notFound();
  if (!car.setupSheetModelId || baseline.setupSheetModelId !== car.setupSheetModelId) notFound();

  const template = await getSetupSheetTemplateForCar(user.id, car, "setup");
  // Baselines are authored on the canonical schema, so the PRIMARY blank is always the paper.
  const blank = await prisma.setupSheetBlank.findFirst({
    where: { setupSheetModelId: car.setupSheetModelId, isEdition: false },
    orderBy: { createdAt: "asc" },
    select: { boxesJson: true, fillSurface: true },
  });
  const sheetMode = chassisFillsAsSheet(blank);

  const subtitle = [
    car.name,
    BASELINE_KIND_LABEL[baseline.kind as BaselineSetupKindValue],
    baseline.surface,
    baseline.gripLevel ? `${baseline.gripLevel} grip` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/cars/${car.id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{baseline.name}</h1>
            <p className="page-subtitle truncate">{subtitle}</p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <CopyBaselineButton carId={car.id} baselineId={baseline.id} name={baseline.name} />
        </div>

        <p className="ui-caption px-1">
          Published for every {template.label} driver, so it can&apos;t be changed here. Save a copy
          and it&apos;s yours to edit.
        </p>

        {baseline.notes ? (
          <CardPanel contentClassName="text-sm text-muted-foreground whitespace-pre-line">
            {baseline.notes}
          </CardPanel>
        ) : null}

        {sheetMode && car.setupSheetModelId ? (
          <ReadOnlySheetSurface
            setupSheetModelId={car.setupSheetModelId}
            values={normalizeSetupData(baseline.data)}
            templateKey={template.templateKey}
            labLabels={{ s: baseline.name }}
          />
        ) : (
          <ReadOnlySetupSheet value={normalizeSetupData(baseline.data)} template={template} />
        )}
      </section>
    </>
  );
}
