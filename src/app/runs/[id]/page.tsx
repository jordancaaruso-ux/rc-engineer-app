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
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { isSamePlatform } from "@/lib/cars/carClasses";
import {
  BACK_PARAM,
  SESSIONS_RETURN_KEY,
  safeSessionsBackHref,
} from "@/lib/runs/sessionsReturn";
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

/**
 * A peer's team-shared runs in the same discipline as `anchorCarId`.
 *
 * Discipline can't be expressed in SQL — it resolves from the chassis catalog with the
 * `Car.carClass` column as an override (`disciplineForCar`) — so the owner's cars are mapped
 * first and the runs filtered in memory. `isSamePlatform` semantics are deliberate: an unknown
 * discipline on either side counts as the same one, the same safe default the car-swap tire rule
 * uses. On today's data that means no narrowing at all — every catalogued chassis is `touring`
 * and nothing writes `carClass` — so this reads as "all their shared runs" until the discipline
 * data actually exists. The filter is here so it tightens on its own when it does.
 *
 * Caller must already have established that the viewer may see this owner's runs.
 */
async function loadPeerRunsInSameDiscipline(ownerUserId: string, anchorCarId: string | null) {
  const [cars, runs] = await Promise.all([
    prisma.car.findMany({
      where: { userId: ownerUserId },
      select: {
        id: true,
        carClass: true,
        setupSheetTemplate: true,
        setupSheetModel: { select: { slug: true, discipline: true } },
      },
    }),
    prisma.run.findMany({
      where: { userId: ownerUserId, shareWithTeam: { not: false } },
      orderBy: { sortAt: "desc" },
      take: PICKER_RUNS_TAKE,
      select: runDetailSelect,
    }),
  ]);

  const disciplineByCarId = new Map(cars.map((c) => [c.id, disciplineForCar(c)]));
  const anchorDiscipline = anchorCarId ? disciplineByCarId.get(anchorCarId) ?? null : null;
  return runs.filter((r) =>
    isSamePlatform(anchorDiscipline, r.carId ? disciplineByCarId.get(r.carId) ?? null : null)
  );
}

export default async function RunPage(props: {
  params: Promise<{ id: string }>;
  /**
   * `back=<sessions url>` is stamped on by the Sessions row that opened this run, and
   * already carries that list's filters, team scope and `openGroup`. Anything else (a
   * shared link, a dashboard "View run", a push notification) falls back to plain
   * Sessions — the arrow always has somewhere to go.
   */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const { id } = await props.params;
  const resolvedSearch = (await props.searchParams) ?? {};
  const backHref = safeSessionsBackHref(resolvedSearch[BACK_PARAM]);

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href={backHref} />
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

  // Own runs get the same-car list the Sessions pickers had.
  //
  // A teammate's run page used to get only the run itself ("the viewer has no claim on the
  // owner's other runs"), which left the lap sheet with nothing of theirs to compare against —
  // no other sessions, no earlier heat. That was already inconsistent with the two surfaces
  // either side of it: team Sessions lists every run they shared, and the Setup modal on this
  // same page fetches teammate runs over `teammate-for-setup-compare`. It now loads their
  // shared runs under the identical gate — `shareWithTeam: { not: false }` keeps null/legacy
  // rows, matching `isRunSharedWithTeam` and `teammate-for-picker` — scoped to the anchor's
  // discipline rather than its exact car (founder call: compare across the class, not the
  // chassis). `viewerMayAccessRun` above already established mutual team access to this owner,
  // so this adds no reach the page didn't have.
  const pickerSource = isOwner
    ? await prisma.run.findMany({
        where: { userId: user.id, carId: run.carId ?? undefined },
        orderBy: { sortAt: "desc" },
        take: PICKER_RUNS_TAKE,
        select: runDetailSelect,
      })
    : await loadPeerRunsInSameDiscipline(run.userId, run.carId);
  const pickerRuns = pickerSource.map(toCompareRunShape);

  // Lap columns are attributed to whoever *drove* the run, not whoever opened it: on a
  // teammate's shared session the viewer's own name sat on the target column above
  // someone else's lap times. `loadTeamMemberDisplays` is a plain user lookup (my-name
  // setting → account name → email), so it also covers a run shared by link.
  const runOwnerDisplayName = isOwner
    ? await getMyNameSetting(user.id)
    : (await loadTeamMemberDisplays([run.userId], user.id)).get(run.userId)?.name ?? null;

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
          <PageBackLink
            href={backHref}
            historyBackToken={{ key: SESSIONS_RETURN_KEY, value: run.id }}
          />
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
          runOwnerDisplayName={runOwnerDisplayName}
          runOwnedByViewer={isOwner}
        />
      </section>
    </>
  );
}
