import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { savedRunSetupName } from "@/lib/setup/setupSaveName";
import { normalizeSetupData } from "@/lib/runSetup";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import { ReadOnlySetupSheet } from "@/components/setup/ReadOnlySetupSheet";
import { ReadOnlySheetSurface } from "@/components/setup/ReadOnlySheetSurface";
import { KeepSetupButton } from "@/components/setup/KeepSetupButton";
import { ShareSetupButton } from "@/components/share/ShareSetupButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink, outlineButtonClassName } from "@/components/ui/ButtonLink";
import { PageBackLink } from "@/components/ui/PageBackLink";

/**
 * Read a setup — a baseline, a run's, or one an uploaded sheet created — without opening an editor.
 *
 * Every setup here is editable, and the button says only "Edit" (founder call, 2026-08-16). What a
 * save MEANS is settled by the door, not by this page: `?run=` is carried through to the editor
 * when the driver arrived from a session, and its absence is what makes an edit from the garage a
 * new setup rather than a correction. See `setupSaveMode.ts`.
 *
 * Highlighted values are the run's own chassis changes: tires and additive are excluded, matching
 * what the car page's history counts as a setup change.
 */
export default async function CarSetupViewPage(props: {
  params: Promise<{ carId: string; setupId: string }>;
  searchParams: Promise<{ run?: string }>;
}): Promise<ReactNode> {
  const { carId, setupId } = await props.params;
  const requestedRunId = (await props.searchParams).run?.trim() || null;

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/cars" />
            <div>
              <h1 className="page-title">Setup</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
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
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) notFound();

  // Baselines, run snapshots and sheet-created setups are the same table — one read covers all.
  const setup = await prisma.setupSnapshot.findFirst({
    where: { id: setupId, userId: user.id, carId },
    select: {
      id: true,
      name: true,
      data: true,
      isLibrary: true,
      createdAt: true,
      setupDeltaJson: true,
      // The run is read for its NAME only: a run's snapshot has none of its own, so "Edited from"
      // had nothing to print and said "another setup" for every copy taken off a session.
      baseSetupSnapshot: {
        select: {
          id: true,
          name: true,
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              sessionType: true,
              meetingSessionType: true,
              meetingSessionCode: true,
              sessionLabel: true,
              event: { select: { name: true } },
            },
          },
        },
      },
      sourceBaseline: { select: { id: true, name: true } },
      sourceDocuments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        // parseStatus + diagnostic decide whether the review screen is still owed a human answer.
        select: {
          id: true,
          originalFilename: true,
          parseStatus: true,
          importDiagnosticJson: true,
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
          track: { select: { name: true } },
          event: { select: { name: true } },
        },
      },
    },
  });
  if (!setup) notFound();

  const template = await getSetupSheetTemplateForCar(user.id, car, "setup");
  /*
   * On a chassis whose sheet the app can draw, the SHEET is the setup view (founder ruling,
   * 2026-08-11): the driver's own paper with their values in its boxes. The field list stays for
   * every other chassis, and for the session view's what-changed list, which this page is not.
   */
  // Which of the chassis's sheets these values are written on: a setup imported through a rebuilt
  // EDITION speaks that edition's keys, and drawing it on the primary blank shows empty boxes.
  const blank = car.setupSheetModelId
    ? await pickSheetBlankForData(car.setupSheetModelId, normalizeSetupData(setup.data))
    : null;
  const sheetMode = chassisFillsAsSheet(blank);
  const editionBlankId = blank?.isEdition ? blank.id : null;
  const changedKeys = chassisChangedKeys(setup.setupDeltaJson);
  const run = setup.runs[0] ?? null;
  const document = setup.sourceDocuments[0] ?? null;

  /*
   * `/setup-documents/[id]` is the IMPORT REVIEW screen — "check the imported values look right",
   * with the car picker and the calibration list. Once a sheet has produced a setup, that screen is
   * not what "show me my sheet" means, so the only door left to it is the one case where it still
   * owes the driver something: the read never finished, or the chassis was ambiguous.
   */
  const documentNeedsReview = document
    ? (document.parseStatus !== "PARSED" && document.parseStatus !== "PARTIAL") ||
      (typeof document.importDiagnosticJson === "object" &&
        document.importDiagnosticJson !== null &&
        (document.importDiagnosticJson as { kind?: string }).kind ===
          "needs_chassis_disambiguation_v1")
    : false;

  const title = setup.isLibrary
    ? (setup.name ?? "Untitled setup")
    : run
      ? `${run.event?.name ? `${run.event.name} · ` : ""}${formatRunSessionDisplay(run, {
          fallback: "Testing run",
        })}`
      : (document?.originalFilename.replace(/\.[a-z0-9]+$/i, "") ?? "Setup");
  /*
   * Where this setup's numbers came from, when a person chose them. Deliberately NOT shown for a
   * plain run snapshot: every run points at the previous run's setup through the same field, and
   * "edited from" would then read as an edit on every run the driver ever logged.
   */
  const baseRun = setup.baseSetupSnapshot?.runs[0] ?? null;
  const baseLabel =
    setup.baseSetupSnapshot?.name ??
    (baseRun
      ? savedRunSetupName({
          eventName: baseRun.event?.name,
          sessionDisplay: formatRunSessionDisplay(baseRun, { fallback: "a testing run" }),
        })
      : null);
  const cameFrom = setup.sourceBaseline
    ? `Copied from ${setup.sourceBaseline.name}`
    : setup.isLibrary && setup.baseSetupSnapshot
      ? `Edited from ${baseLabel ?? "another setup"}`
      : null;

  const subtitle = [
    car.name,
    setup.isLibrary ? "Saved baseline" : run ? "From a run" : "From an uploaded sheet",
    cameFrom,
    run?.track?.name ?? null,
    formatRunCreatedAtDateTime(run?.createdAt ?? setup.createdAt, displayTimeZone),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={`/cars/${car.id}`} />
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
            <p className="page-subtitle truncate">{subtitle}</p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Every setup of yours opens an editor — an uploaded sheet is not history just because it
            arrived as a PDF, and a run's setup is not off limits just because it was raced. One
            word, always: the run count used to spell "Correct this run" / "Edit a copy" onto this
            button, which asked the driver to understand the storage model before they could press
            anything. `?run=` rides along only when they got here from a session.
          */}
          <ButtonLink
            href={`/cars/${car.id}/setups/${setup.id}/edit${
              requestedRunId ? `?run=${encodeURIComponent(requestedRunId)}` : ""
            }`}
          >
            Edit
          </ButtonLink>
          <KeepSetupButton setupId={setup.id} name={title} initialSaved={setup.isLibrary} />
          {setup.isLibrary ? (
            <ButtonLink href={`/engineer?pin=setup:${setup.id}`} variant="outline">
              Ask the Engineer
            </ButtonLink>
          ) : null}
          <a
            href={`/api/setup-snapshots/${encodeURIComponent(setup.id)}/setup-pdf`}
            target="_blank"
            rel="noreferrer"
            className={outlineButtonClassName()}
          >
            View as PDF
          </a>
          {/* Beside the PDF on purpose: same artifact, one for filing and one for sending. */}
          <ShareSetupButton setupSnapshotId={setup.id} label={title} />
          {run ? (
            <ButtonLink href={`/runs/${run.id}`} variant="outline">
              Open run
            </ButtonLink>
          ) : null}
          {/*
            The file the driver uploaded, as they uploaded it. This used to point at
            `/setup-documents/[id]` — the import-review workbench — so tapping "Open the sheet" on a
            perfectly good setup landed on "Review setup: check the imported values look right".
          */}
          {document ? (
            <a
              href={`/api/setup-documents/${encodeURIComponent(document.id)}/file`}
              target="_blank"
              rel="noreferrer"
              className={outlineButtonClassName()}
            >
              Original PDF
            </a>
          ) : null}
          {document && documentNeedsReview ? (
            <ButtonLink href={`/setup-documents/${document.id}`} variant="outline">
              Finish importing this sheet
            </ButtonLink>
          ) : null}
        </div>

        {/*
          Where these numbers came from, in the body rather than the header.
          `.page-header .page-subtitle` is `display: none` (globals.css, the centered-title
          restructure), so the subtitle this line used to ride in has been invisible on every page
          that uses the chrome — and a copy made from a run therefore said nothing at all about the
          run it was taken off. Provenance is the entire promise of "Save as new setup"; it cannot
          live somewhere the driver can't see.
        */}
        {cameFrom ? <p className="ui-caption px-1">{cameFrom}</p> : null}

        {changedKeys.length > 0 && !sheetMode ? (
          <p className="ui-caption px-1">
            Highlighted values differ from{" "}
            {setup.baseSetupSnapshot?.name ?? "the setup this was based on"}.
          </p>
        ) : null}

        {sheetMode && car.setupSheetModelId ? (
          <ReadOnlySheetSurface
            setupSheetModelId={car.setupSheetModelId}
            editionBlankId={editionBlankId}
            values={normalizeSetupData(setup.data)}
            templateKey={template.templateKey}
            labLabels={{ s: title }}
            labSource={{ kind: "setup", id: setup.id }}
          />
        ) : (
          <ReadOnlySetupSheet
            value={normalizeSetupData(setup.data)}
            template={template}
            changedKeys={changedKeys}
          />
        )}
      </section>
    </>
  );
}
