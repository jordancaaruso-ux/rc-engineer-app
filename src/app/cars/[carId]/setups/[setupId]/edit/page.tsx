import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink, outlineButtonClassName } from "@/components/ui/ButtonLink";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import { normalizeSetupData } from "@/lib/runSetup";
import { LibrarySetupEditorClient } from "@/components/setup/LibrarySetupEditorClient";
import { SheetSetupEditorClient } from "@/components/setup/SheetSetupEditorClient";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";

/**
 * Edit any setup of the driver's on the full grid sheet (the sequential flow is for a blank fill
 * only). Every setup opens here — a saved baseline, a sheet the driver uploaded, and a run's own
 * record. What differs is what a save is allowed to mean, and that is decided once here and handed
 * to the editor as `saveMode`:
 *
 * - `inPlace`    — nothing points at these values, so they save over themselves (autosave).
 * - `correctRun` — one run's record. Saving writes a NEW snapshot and repoints that run, so the
 *                  numbers the run claims to have raced change only when the driver says so.
 * - `copyOnly`   — several runs share this snapshot; correcting one would silently rewrite the
 *                  others, so the only door out is a separate setup.
 *
 * Every saved-setup row in the app lands here directly, so this page carries the doors the
 * read-only view used to be the only route to: the PDF, and the setup's own detail page.
 */
export default async function CarSetupEditPage(props: {
  params: Promise<{ carId: string; setupId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <h1 className="page-title">Setup</h1>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view setups.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const { carId, setupId } = await props.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) notFound();

  const setup = await prisma.setupSnapshot.findFirst({
    where: { id: setupId, userId: user.id, carId },
    select: {
      id: true,
      name: true,
      data: true,
      isLibrary: true,
      _count: { select: { runs: true } },
      // Which run to correct, and the filename an uploaded sheet was named after.
      runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      sourceDocuments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { originalFilename: true },
      },
    },
  });
  if (!setup) notFound();

  const runCount = setup._count.runs;
  const saveMode: SetupSaveMode =
    runCount === 0
      ? // Only a setup the driver saved as their own autosaves; an uploaded sheet's imported
        // values are a record of their paper, so replacing them is an explicit press.
        { kind: "inPlace", autosave: setup.isLibrary }
      : runCount === 1 && setup.runs[0]
        ? { kind: "correctRun", runId: setup.runs[0].id }
        : { kind: "copyOnly", runCount };

  const title =
    setup.name ??
    setup.sourceDocuments[0]?.originalFilename.replace(/\.[a-z0-9]+$/i, "") ??
    "Setup";

  const template = await getSetupSheetTemplateForCar(user.id, car, "setup");

  // A setup edits on the surface it was filled on — the sheet, when the chassis draws one.
  const blank = car.setupSheetModelId
    ? await prisma.setupSheetBlank.findUnique({
        where: { setupSheetModelId: car.setupSheetModelId },
        select: { boxesJson: true, fillSurface: true },
      })
    : null;
  const sheetMode = chassisFillsAsSheet(blank);

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/cars/${car.id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
            <p className="page-subtitle truncate">{car.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-4xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/setup-snapshots/${encodeURIComponent(setup.id)}/setup-pdf`}
              target="_blank"
              rel="noreferrer"
              className={outlineButtonClassName()}
            >
              View as PDF
            </a>
            <ButtonLink href={`/cars/${car.id}/setups/${setup.id}`} variant="outline">
              Setup details
            </ButtonLink>
          </div>
          {sheetMode && car.setupSheetModelId ? (
            <SheetSetupEditorClient
              carId={car.id}
              setupId={setup.id}
              setupName={title}
              saveMode={saveMode}
              setupSheetModelId={car.setupSheetModelId}
              initialValues={normalizeSetupData(setup.data)}
              templateKey={template.templateKey}
            />
          ) : (
            <LibrarySetupEditorClient
              carId={car.id}
              setupId={setup.id}
              setupName={title}
              saveMode={saveMode}
              initialValues={normalizeSetupData(setup.data)}
              template={template}
            />
          )}
        </div>
      </section>
    </>
  );
}
