import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting } from "@/lib/appSettings";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { RunPageClient } from "@/components/runs/RunPageClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The run view (founder call 2026-07-29, Option A) — one place to look at a run. Renders the
 * same `RunDetailPanel` the Sessions expanded row used, so the two can never drift; Sessions
 * rows navigate here. Editing stays at `/runs/[id]/edit`.
 *
 * Deliberately absent: `EngineerRunSummaryPanel` — its loader writes the summary cache onto
 * the Run row on a miss, and opening a run must not be a write.
 */

// Same field set as Sessions' `runHistorySelect` (see the egress note there), plus
// `shareWithTeam` for the access check. Anything `RunDetailPanel` reads must be listed.
const runDetailSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  loggingComplete: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  eventId: true,
  raceClass: true,
  tireRunNumber: true,
  warmerTimingMinutes: true,
  tirePrep: true,
  setupSnapshotId: true,
  lapTimes: true,
  lapSession: true,
  bestLapSeconds: true,
  avgTop5LapSeconds: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  carRating: true,
  conditionsAirTempC: true,
  conditionsTrackTempC: true,
  conditionsCloudCoverPct: true,
  conditionsWeatherCode: true,
  conditionsHumidityPct: true,
  conditionsWindKph: true,
  conditionsWindDirDeg: true,
  conditionsSource: true,
  conditionsLatitude: true,
  conditionsLongitude: true,
  conditionsObservedAt: true,
  shareWithTeam: true,
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireStintId: true,
  tireAgeKnown: true,
  tireType: { select: { id: true, displayName: true } },
  additiveType: { select: { id: true, displayName: true } },
  event: {
    select: {
      name: true,
      startDate: true,
      endDate: true,
      trackNameSnapshot: true,
      track: { select: { name: true } },
    },
  },
  setupSnapshot: { select: { id: true } },
  importedLapSets: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      driverId: true,
      driverName: true,
      displayName: true,
      surname: true,
      normalizedName: true,
      isPrimaryUser: true,
    },
  },
} satisfies Prisma.RunSelect;

/** Compare/setup pickers and the previous-run diff only ever look at the same car. */
const PICKER_RUNS_TAKE = 200;

export default async function RunPage(props: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await props.params;

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/runs/history" />
            <div>
              <h1 className="page-title">Run</h1>
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

  const run = await prisma.run.findUnique({ where: { id }, select: runDetailSelect });
  if (!run) notFound();
  if (!(await viewerMayAccessRun(user.id, run))) notFound();

  const isOwner = run.userId === user.id;

  // Own runs get the same-car list the Sessions pickers had. A teammate's run page gets only
  // the run itself: the viewer has no claim on the owner's other runs, and the per-run
  // setup-snapshot API re-checks access anyway.
  const pickerSource = isOwner
    ? await prisma.run.findMany({
        where: { userId: user.id, carId: run.carId ?? undefined },
        orderBy: { sortAt: "desc" },
        take: PICKER_RUNS_TAKE,
        select: runDetailSelect,
      })
    : [run];
  const pickerRuns = pickerSource.map(toCompareRunShape);

  const myName = await getMyNameSetting(user.id);

  const sessionDisplay = formatRunSessionDisplay(run, { fallback: "Testing run" });
  const title = `${run.event?.name ? `${run.event.name} · ` : ""}${sessionDisplay}`;
  const subtitle = [
    run.car?.name ?? run.carNameSnapshot ?? null,
    run.track?.name ?? run.trackNameSnapshot ?? null,
    formatRunDateTime(resolveRunDisplayInstant(run), displayTimeZone),
    isOwner ? null : "Shared by a teammate — read only",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/runs/history" />
          <div className="min-w-0">
            <h1 className="page-title truncate">{title}</h1>
            <p className="page-subtitle truncate">{subtitle}</p>
          </div>
        </div>
      </header>

      <section className="page-body max-w-4xl">
        <RunPageClient
          run={run}
          pickerRuns={pickerRuns}
          runListSource="my_runs"
          displayTimeZone={displayTimeZone}
          allowRunMutations={isOwner}
          userDisplayName={myName}
        />
      </section>
    </>
  );
}
