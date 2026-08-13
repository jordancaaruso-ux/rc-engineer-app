import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { normalizeSetupData } from "@/lib/runSetup";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import { ReadOnlySetupSheet } from "@/components/setup/ReadOnlySetupSheet";
import { ReadOnlySheetSurface } from "@/components/setup/ReadOnlySheetSurface";
import { KeepSetupButton } from "@/components/setup/KeepSetupButton";
import { ShareSetupButton } from "@/components/share/ShareSetupButton";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink, outlineButtonClassName } from "@/components/ui/ButtonLink";
import { PageBackLink } from "@/components/ui/PageBackLink";

/**
 * Read a setup — a baseline, a run's, or one an uploaded sheet created — without opening an editor.
 * Run and sheet setups are history, so they have no Edit action; baselines link to the editor.
 *
 * Highlighted values are the run's own chassis changes: tires and additive are excluded, matching
 * what the car page's history counts as a setup change.
 */
export default async function CarSetupViewPage(props: {
  params: Promise<{ carId: string; setupId: string }>;
}): Promise<ReactNode> {
  const { carId, setupId } = await props.params;

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
      baseSetupSnapshot: { select: { id: true, name: true } },
      sourceDocuments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, originalFilename: true },
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
  const blank = car.setupSheetModelId
    ? await prisma.setupSheetBlank.findUnique({
        where: { setupSheetModelId: car.setupSheetModelId },
        select: { boxesJson: true, fillSurface: true },
      })
    : null;
  const sheetMode = chassisFillsAsSheet(blank);
  const changedKeys = chassisChangedKeys(setup.setupDeltaJson);
  const run = setup.runs[0] ?? null;
  const document = setup.sourceDocuments[0] ?? null;

  const title = setup.isLibrary
    ? (setup.name ?? "Untitled setup")
    : run
      ? `${run.event?.name ? `${run.event.name} · ` : ""}${formatRunSessionDisplay(run, {
          fallback: "Testing run",
        })}`
      : (document?.originalFilename.replace(/\.[a-z0-9]+$/i, "") ?? "Setup");
  const subtitle = [
    car.name,
    setup.isLibrary ? "Saved baseline" : run ? "From a run" : "From an uploaded sheet",
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
            Editing is only ever offered for a setup no run points at. A saved run setup is that
            run's own record: saving marks the snapshot rather than copying it, so its values are
            frozen and the door here is Save / Rename, not Edit.
          */}
          {setup.isLibrary && setup.runs.length === 0 ? (
            <ButtonLink href={`/cars/${car.id}/setups/${setup.id}/edit`}>Edit</ButtonLink>
          ) : null}
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
          {document ? (
            <ButtonLink href={`/setup-documents/${document.id}`} variant="outline">
              Open the sheet
            </ButtonLink>
          ) : null}
        </div>

        {changedKeys.length > 0 && !sheetMode ? (
          <p className="ui-caption px-1">
            Highlighted values differ from{" "}
            {setup.baseSetupSnapshot?.name ?? "the setup this was based on"}.
          </p>
        ) : null}

        {sheetMode && car.setupSheetModelId ? (
          <ReadOnlySheetSurface
            setupSheetModelId={car.setupSheetModelId}
            values={normalizeSetupData(setup.data)}
            templateKey={template.templateKey}
            labLabels={{ s: title }}
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
