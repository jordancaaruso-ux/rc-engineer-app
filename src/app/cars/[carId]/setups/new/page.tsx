import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { normalizeSetupData } from "@/lib/runSetup";
import {
  BASELINE_KIND_LABEL,
  baselineContextLabel,
  sortBaselineSetups,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";
import type {
  BaselineStartChoice,
  SetupFillDraftResume,
} from "@/components/setup/NewCarSetupClient";
import { getSetupFillDraftForCar } from "@/lib/setup/getSetupFillDraft";
import {
  buildSetupFillSteps,
  countAnsweredSetupFillSteps,
} from "@/lib/setup/setupFillOrder";
import { formatRunDateShort } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { NewCarSetupClient } from "@/components/setup/NewCarSetupClient";
import { SheetModeFill } from "@/components/setup/SheetModeFill";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";

/**
 * First fill for a new library setup on a car.
 *
 * The three starting points, in the order a driver actually wants them (founder call 2026-07-29):
 *  - previous setup → any of this car's recent snapshots, picked from a dropdown. Was a single
 *                     "your last setup"; adjusting the one you're on is the common case, and it
 *                     isn't always the newest row.
 *  - baseline       → any global `BaselineSetup` published against this car's chassis (kit first).
 *                     Was kit-only; a pro sheet is just as good a place to start.
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

  /*
   * A chassis somebody built from their own PDF fills as their sheet, not as a form.
   *
   * The test is whether we have geometry to draw with, never how many boxes are still unnamed. An
   * unnamed box has `showInLogRun: false`, and the ordinary form only shows fields with that flag
   * set — so falling back to the form on a half-named sheet would hand the driver a shorter form
   * and silently drop the rest of their sheet.
   */
  const blank = car.setupSheetModelId
    ? await prisma.setupSheetBlank.findUnique({
        where: { setupSheetModelId: car.setupSheetModelId },
        select: { boxesJson: true, fillSurface: true },
      })
    : null;
  const sheetMode = chassisFillsAsSheet(blank);

  // Baselines are global — never scope this read by userId. Kit first, then base, then pro.
  const baselineRows = car.setupSheetModelId
    ? await prisma.baselineSetup.findMany({
        where: { setupSheetModelId: car.setupSheetModelId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, kind: true, surface: true, gripLevel: true, data: true },
      })
    : [];
  const baselines: BaselineStartChoice[] = sortBaselineSetups(
    baselineRows.map((b) => ({ ...b, kind: b.kind as BaselineSetupKindValue }))
  ).map((b) => ({
    id: b.id,
    label: b.name,
    kindLabel: BASELINE_KIND_LABEL[b.kind],
    contextLabel: baselineContextLabel(b),
    data: normalizeSetupData(b.data),
  }));

  /*
   * A sequential fill parked on this car. The stored `answeredCount`/`stepCount` are the client's
   * own last report and are ignored here: we have the template in hand, so this is where a chassis
   * schema change since the draft was parked resolves itself, silently and correctly.
   */
  const draftRow = await getSetupFillDraftForCar(user.id, carId);
  const fillDraft: SetupFillDraftResume | null = draftRow
    ? (() => {
        const values = normalizeSetupData(draftRow.data);
        const steps = buildSetupFillSteps(template);
        return {
          values,
          stepIndex: draftRow.stepIndex,
          pendingText: draftRow.pendingText,
          pendingStepKey: draftRow.pendingStepKey,
          name: draftRow.name,
          answeredCount: countAnsweredSetupFillSteps(steps, values),
          stepCount: steps.length,
          updatedAt: draftRow.updatedAt.toISOString(),
        };
      })()
    : null;

  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();

  // Saved setups, run snapshots and sheet-created setups share one table, so a single read covers
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
      ? (s.name ?? "Untitled setup")
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
      kind: s.isLibrary ? ("saved" as const) : run ? ("run" as const) : ("sheet" as const),
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
          {sheetMode && car.setupSheetModelId ? (
            /*
             * No start-from picker here, on purpose. Those three choices — previous setup, baseline,
             * empty — answer "what should the boxes start at", and on this driver's own sheet the
             * answer already came out of their PDF. A parked draft still resumes, because that is
             * the same sheet half-finished rather than a different place to start from.
             */
            <SheetModeFill
              carId={car.id}
              setupSheetModelId={car.setupSheetModelId}
              chassisName={template.label ?? car.name}
              initialValues={fillDraft?.values as Record<string, string> | undefined}
            />
          ) : (
            <NewCarSetupClient
              carId={car.id}
              carName={car.name}
              template={template}
              baselines={baselines}
              previousSetups={previousSetups}
              fillDraft={fillDraft}
            />
          )}
        </div>
      </section>
    </>
  );
}
