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
import { SetupSheetCompareView } from "@/components/setup/SetupSheetCompareView";
import { KeepSetupButton } from "@/components/setup/KeepSetupButton";
import { ShareSetupButton } from "@/components/share/ShareSetupButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { ActionChip } from "@/components/ui/ActionChip";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { IconEngineer } from "@/components/icons/JRCIcons";
import { Paperclip, Pencil, Timer } from "lucide-react";

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
      sheetBlankId: true,
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
  // Which of the chassis's sheets to draw: the paper this setup was born on (its stamp), else the
  // one whose boxes speak its keys. See `pickSheetBlankForData`.
  const blank = car.setupSheetModelId
    ? await pickSheetBlankForData(car.setupSheetModelId, normalizeSetupData(setup.data), {
        sheetBlankId: setup.sheetBlankId,
      })
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

  /*
   * ONE row, and every door in it — no "⋯" on this page any more.
   *
   * Founder call 2026-09-01, at his desk: downloading his own sheet took four taps (⋯ → View as
   * PDF → Download → a share dialog), the Engineer was hidden behind the same "⋯", and "on desktop
   * all the chips can be shown — there's more than enough room". So the row holds everything, and
   * Share IS the download: on a sheet chassis it hands over the filled PDF rather than a picture.
   *
   * EVERY chip keeps its word at every width. Hiding them below `md` was tried the same afternoon
   * and pulled: "don't try to make them just icons, just keep the words on all the buttons all the
   * time". The row wraps on a phone, and that is the accepted cost.
   *
   * "View as PDF" is gone as a separate door, and that ends the "what's the difference between
   * Original PDF and View PDF?" question it created: the app-drawn sheet is already ON this page,
   * so a second way to look at it earned nothing. What remains is the ONE thing this page can't
   * show — the file the driver uploaded, under a name that says so.
   *
   * Edit says one word, always: the run count used to spell "Correct this run" / "Edit a copy"
   * onto this button, which asked the driver to understand the storage model before they could
   * press anything. `?run=` rides along only when they got here from a session.
   */
  const leadingActions = (
    <>
      <ActionChip
        href={`/cars/${car.id}/setups/${setup.id}/edit${
          requestedRunId ? `?run=${encodeURIComponent(requestedRunId)}` : ""
        }`}
        label="Edit"
        // The one yellow chip in the row: this page's #1 action, and the only one that changes
        // anything. Everything beside it is a door.
        variant="primary"
        icon={<Pencil className="size-3.5" strokeWidth={2} aria-hidden />}
      />
      <KeepSetupButton setupId={setup.id} name={title} initialSaved={setup.isLibrary} />
      <ShareSetupButton setupSnapshotId={setup.id} label={title} asPdf={sheetMode} />
    </>
  );
  /*
    The uploaded file opens through `/pdf-view` — the in-app frame with a header and a way back. It
    was a raw `target="_blank"` API link, which a desktop browser shows as a closable tab but the
    installed PWA and the iOS shell show as a bare PDF with no chrome and no back (founder report,
    2026-09-01).
  */
  const backHere = `/cars/${car.id}/setups/${setup.id}`;
  const trailingActions = (
    <>
      {/* Out of the "⋯" by founder call. The pin works for ANY setup, so it no longer waits for a
          setup to be marked as a baseline before the driver can ask about it. */}
      <ActionChip
        href={`/engineer?pin=setup:${setup.id}`}
        label="Engineer"
        icon={<IconEngineer size={14} aria-hidden />}
      />
      {run ? (
        <ActionChip
          href={`/runs/${run.id}`}
          label="View run"
          icon={<Timer className="size-3.5" strokeWidth={2} aria-hidden />}
        />
      ) : null}
      {/*
        The file the driver uploaded, as they uploaded it. This used to point at
        `/setup-documents/[id]` — the import-review workbench — so tapping it on a perfectly good
        setup landed on "Review setup: check the imported values look right".
      */}
      {document ? (
        <ActionChip
          href={`/pdf-view?document=${encodeURIComponent(document.id)}&back=${encodeURIComponent(backHere)}`}
          label="View original file"
          icon={<Paperclip className="size-3.5" strokeWidth={2} aria-hidden />}
        />
      ) : null}
    </>
  );

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
        {/*
          The one un-quiet door, kept OUT of the "⋯" sheet: the import never finished, and this
          page owes the driver that answer before anything else on it can be trusted.
        */}
        {document && documentNeedsReview ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <ButtonLink href={`/setup-documents/${document.id}`} variant="outline">
              Finish importing this sheet
            </ButtonLink>
          </div>
        ) : null}

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
          /*
            The same paper as before, with the compare the session view has always had — a setup
            read from the garage could not be held against another one, only a setup read from its
            run could. `SetupSheetCompareView` wraps the read-only surface rather than replacing
            it, so nothing about reading a setup changed.
          */
          <SetupSheetCompareView
            setupSheetModelId={car.setupSheetModelId}
            editionBlankId={editionBlankId}
            values={normalizeSetupData(setup.data)}
            label={title}
            templateKey={template.templateKey}
            labLabels={{ s: title }}
            labSource={{ kind: "setup", id: setup.id }}
            /*
              Never offer this setup as its own comparison. A kept run's snapshot is in two pools at
              once — among your runs under its RUN id, and in your library under its own.
            */
            excludeEntryIds={[
              ...(setup.isLibrary ? [`saved-${setup.id}`] : []),
              ...(run ? [`run-${run.id}`] : []),
            ]}
            leadingActions={leadingActions}
            trailingActions={trailingActions}
          />
        ) : (
          <>
            {/* No sheet to flip on this chassis, so the same row minus Compare. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {leadingActions}
              {trailingActions}
            </div>
            <ReadOnlySetupSheet
              value={normalizeSetupData(setup.data)}
              template={template}
              changedKeys={changedKeys}
            />
          </>
        )}
      </section>
    </>
  );
}
