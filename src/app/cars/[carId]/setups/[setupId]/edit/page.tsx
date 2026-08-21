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
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import { normalizeSetupData } from "@/lib/runSetup";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { savedRunSetupName } from "@/lib/setup/setupSaveName";
import { LibrarySetupEditorClient } from "@/components/setup/LibrarySetupEditorClient";
import { SheetSetupEditorClient } from "@/components/setup/SheetSetupEditorClient";
import { SetupEditorShareNote, SetupEditorShareProvider } from "@/components/setup/setupEditorShare";
import { ShareSetupButton } from "@/components/share/ShareSetupButton";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";
import { safeAppPath } from "@/lib/navigation/safeAppPath";
import { SETUP_EDITOR_BACK_PARAM } from "@/lib/setup/setupEditorReturn";

/**
 * Edit any setup of the driver's on the full grid sheet (the sequential flow is for a blank fill
 * only). Every setup opens here — a saved baseline, a sheet the driver uploaded, and a run's own
 * record. What differs is what a save is allowed to mean, and that is decided once here and handed
 * to the editor as `saveMode`.
 *
 * `?run=<id>` is the whole of that decision. The session log links with it, the garage links
 * without it, and the same setup therefore edits as a run correction from one door and as the
 * starting point for a new setup from the other (founder call, 2026-08-16). The id is checked
 * against this snapshot and this driver before it is believed — a hand-typed one buys nothing.
 *
 * Every saved-setup row in the app lands here directly, so this page carries the doors the
 * read-only view used to be the only route to: the PDF, and the setup's own detail page.
 */
export default async function CarSetupEditPage(props: {
  params: Promise<{ carId: string; setupId: string }>;
  searchParams: Promise<{ run?: string; back?: string }>;
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
  const search = await props.searchParams;
  const requestedRunId = search.run?.trim() || null;

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
      // Which run to correct, and what to call a snapshot that has no name of its own.
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
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
  if (!setup) notFound();

  /*
   * The `?run=` claim, checked. It must be the driver's own run AND actually point at this
   * snapshot; anything else falls back to the garage reading, which never writes to a run.
   */
  const correctableRun = requestedRunId
    ? await prisma.run.findFirst({
        where: { id: requestedRunId, userId: user.id, setupSnapshotId: setup.id },
        select: { id: true },
      })
    : null;

  const runCount = setup._count.runs;
  const saveMode: SetupSaveMode = correctableRun
    ? { kind: "correctRun", runId: correctableRun.id }
    : runCount === 0
      ? { kind: "inPlace" }
      : {
          kind: "fork",
          runCount,
          // Only when one run is named by these numbers is "this run" a thing the button can mean.
          correctableRunId: runCount === 1 ? (setup.runs[0]?.id ?? null) : null,
        };

  /*
   * A run's snapshot carries no name — the run is its name. Falling through to the bare word
   * "Setup" made every corrected run's page, and every copy taken off one, read as untitled.
   */
  const run = setup.runs[0] ?? null;
  const title =
    setup.name ??
    (run
      ? savedRunSetupName({
          eventName: run.event?.name,
          sessionDisplay: formatRunSessionDisplay(run, { fallback: "Testing run" }),
        })
      : null) ??
    setup.sourceDocuments[0]?.originalFilename.replace(/\.[a-z0-9]+$/i, "") ??
    "Setup";

  const template = await getSetupSheetTemplateForCar(user.id, car, "setup");

  // A setup edits on the surface it was filled on — the sheet, when the chassis draws one, and
  // the EDITION of that sheet whose boxes speak this setup's keys. See `sheetBlankResolve`.
  const blank = car.setupSheetModelId
    ? await pickSheetBlankForData(car.setupSheetModelId, normalizeSetupData(setup.data))
    : null;
  const sheetMode = chassisFillsAsSheet(blank);
  const editionBlankId = blank?.isEdition ? blank.id : null;
  /*
   * `explicitBack` is null when nobody said where they came from, and that
   * distinction matters twice over: the arrow falls back to the garage, but a
   * SAVE only redirects when there is somewhere real to redirect to. Without the
   * distinction, correcting a run reached from the garage would start landing on
   * the car page — a behaviour change nobody asked for.
   */
  const explicitBack = safeAppPath(search.back);
  const backHref = explicitBack ?? `/cars/${car.id}`;

  const detailsQuery = new URLSearchParams();
  // Carries the run on, so a detour through the details page doesn't quietly turn
  // a correction into a copy when the driver comes back — and carries the way out
  // with it, for the same reason.
  if (correctableRun) detailsQuery.set("run", correctableRun.id);
  if (explicitBack) detailsQuery.set(SETUP_EDITOR_BACK_PARAM, explicitBack);
  const detailsSuffix = detailsQuery.size > 0 ? `?${detailsQuery.toString()}` : "";

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* The garage is only the right way out for a driver who came from the
              garage. See `setupEditorReturn`. */}
          <PageBackLink href={backHref} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
            <p className="page-subtitle truncate">{car.name}</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        {/*
          Wraps the row AND the editor, because Share in the row has to see the editor's unsaved
          changes and its saves — the picture is drawn on the server from what is stored, so a
          share taken mid-edit would send the old numbers. See `setupEditorShare`.
        */}
        <SetupEditorShareProvider>
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
              {/* Beside the PDF on purpose, same as the details page: same artifact, one for
                  filing and one for sending. */}
              <ShareSetupButton setupSnapshotId={setup.id} label={title} />
              <ButtonLink
                href={`/cars/${car.id}/setups/${setup.id}${detailsSuffix}`}
                variant="outline"
              >
                Setup details
              </ButtonLink>
            </div>
            <SetupEditorShareNote />
            {sheetMode && car.setupSheetModelId ? (
              <SheetSetupEditorClient
                carId={car.id}
                setupId={setup.id}
                setupName={title}
                saveMode={saveMode}
                setupSheetModelId={car.setupSheetModelId}
                editionBlankId={editionBlankId}
                initialValues={normalizeSetupData(setup.data)}
                templateKey={template.templateKey}
                returnHref={explicitBack}
              />
            ) : (
              <LibrarySetupEditorClient
                carId={car.id}
                setupId={setup.id}
                setupName={title}
                saveMode={saveMode}
                initialValues={normalizeSetupData(setup.data)}
                template={template}
                returnHref={explicitBack}
              />
            )}
          </div>
        </SetupEditorShareProvider>
      </section>
    </>
  );
}
