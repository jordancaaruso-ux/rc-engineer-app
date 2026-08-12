import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
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

/**
 * Edit a saved baseline on the full grid sheet (the sequential flow is for a blank fill only).
 * Only library rows are editable — run and sheet setups are history.
 *
 * Every saved-setup row in the app lands here directly now, so this page carries the doors the
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
    where: { id: setupId, userId: user.id, carId, isLibrary: true },
    select: { id: true, name: true, data: true, _count: { select: { runs: true } } },
  });
  if (!setup) notFound();

  /*
   * A saved setup that a run points at is that run's own record — read it, don't edit it.
   *
   * Saving from "All setups" marks the run's existing snapshot rather than copying it, so these
   * rows now reach the editor's URL for the first time. Send them to the read-only view, which
   * offers the copy door ("Save as new setup") for anyone who wants to change the numbers. The
   * API refuses the same write, so this redirect is the courtesy, not the enforcement.
   */
  if (setup._count.runs > 0) {
    redirect(`/cars/${car.id}/setups/${setup.id}`);
  }

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
            <h1 className="page-title truncate">{setup.name ?? "Untitled setup"}</h1>
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
              setupName={setup.name}
              setupSheetModelId={car.setupSheetModelId}
              initialValues={normalizeSetupData(setup.data)}
              templateKey={template.templateKey}
            />
          ) : (
            <LibrarySetupEditorClient
              carId={car.id}
              setupId={setup.id}
              setupName={setup.name}
              initialValues={normalizeSetupData(setup.data)}
              template={template}
            />
          )}
        </div>
      </section>
    </>
  );
}
