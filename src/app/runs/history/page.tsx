import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting } from "@/lib/appSettings";
import { loadTeamMemberDisplays, memberDisplayLabelRecord } from "@/lib/teams/teamMemberDisplay";
import { RunHistoryTable } from "@/components/runs/RunHistoryTable";
import { RunHistoryColGroup, RunHistoryMobileHeaderRow, RUN_HISTORY_ACTION_CELL_CLASS, computeRunHistoryColSpan } from "@/components/runs/runHistoryTableColumns";
import { SessionsFocusScroll } from "@/components/runs/SessionsFocusScroll";
import { SessionsBrowser } from "@/components/runs/SessionsBrowser";
import {
  buildGroupDrivers,
  buildGroupHeadline,
  buildGroupRunRows,
  buildGroupTrendModel,
  type WorkbenchGroup,
} from "@/lib/runs/sessionWorkbenchModel";
import { buildTeamDayModel } from "@/lib/runs/teamDayModel";
import { RunHistoryViewMore } from "@/components/runs/RunHistoryViewMore";
import { OPEN_GROUP_PARAM } from "@/lib/runs/sessionsReturn";
import { SessionsFilterBar } from "@/components/runs/SessionsFilterBar";
import {
  buildDayRunNameMap,
  buildRunHistoryGroups,
  runSessionSortInstant,
  sessionGroupKey,
  type RunHistoryGroup,
} from "@/lib/runs/buildRunHistoryGroups";
import {
  applyRunHistoryPostFiltersWithReasons,
  buildRunHistoryPrismaWhere,
  computeChangedKeysByRun,
  describeRunHistoryFilters,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  sortRunsForHistory,
  type MatchReason,
} from "@/lib/runs/runHistoryFilters";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { normalizeSetupData } from "@/lib/runSetup";
import { isDocumentMetadataField } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { compareRunTimestamp } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { loadUserScopedEvents } from "@/lib/events/eventParticipation";
import { assertUserInTeam, listTeamMemberUserIds, listTeamsForUser } from "@/lib/teamAccess";
import type { Prisma } from "@prisma/client";
import { cn } from "@/lib/utils";

import { perfSpan } from "@/lib/perfLog";

/** Initial page size for Sessions — recent runs only; use ?viewAll=1 for full history. */
export const RUN_HISTORY_INITIAL_TAKE = 40;
/** Cap when loading full history (view all). */
export const RUN_HISTORY_VIEW_ALL_TAKE = 2000;

export const revalidate = 30;

// Explicit scalar list — NOT `include`. Prisma's `include` returns every scalar
// on the row, which dragged `engineerSummaryJson` + `engineerDeepDiveJson` (large
// cached LLM payloads, unread on this page) across the wire for up to 2000 rows
// on every Sessions load. That was the single biggest source of Neon egress.
// Anything a child component reads must be listed here: rows are handed to the
// client `<RunHistoryTable>` unmapped, so a missing field is a runtime hole that
// only the prop types catch. Verified-unread and deliberately omitted:
// trackId, trackLayoutId, trackLayoutNameSnapshot, trackDirection, tireSetId,
// additiveTypeId, batteryId, batteryRunNumber, sourceSetupDocumentId,
// sourceSetupCalibrationId, renderedSetupPdfPath, renderedSetupPdfGeneratedAt,
// setupPdfRenderVersion, suggestedChanges, suggestedPreRun, appliedChanges,
// importedLapTimeSessionId, incompleteLoggingPromptDismissedAt, shareWithTeam,
// practiceDayUrl, engineerSummaryJson, engineerSummaryRefRunId,
// engineerSummaryComputedAt, engineerDeepDiveJson.
const runHistorySelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  // Which day this run belongs to is decided in the DRIVER's zone, not the reader's
  // (buildRunHistoryGroups → resolveRunLocalTimeZone).
  localTimeZone: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  loggingComplete: true,
  // Read by the row's "no lap times — import them" warning (runNeedsLapImport).
  lapImportPromptDismissedAt: true,
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
  // Read at page.tsx setup-snapshot join — easy to lose in an include→select move.
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
  // Read by runConditionsFromRecord() into the RunConditions object. No current
  // consumer renders them, but they are real property accesses — kept so this
  // stays a pure egress change and not a coupling to formatConditionsChip's
  // present-day field set.
  conditionsWindDirDeg: true,
  conditionsSource: true,
  conditionsLatitude: true,
  conditionsLongitude: true,
  conditionsObservedAt: true,
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireStintId: true,
  tireAgeKnown: true,
  tireType: {
    select: {
      id: true,
      displayName: true,
    },
  },
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

type RunInGroup = Prisma.RunGetPayload<{ select: typeof runHistorySelect }>;

async function fetchRunHistoryRows(where: Prisma.RunWhereInput, take: number): Promise<RunInGroup[]> {
  return perfSpan(`fetchRunHistoryRows(take=${take})`, () =>
    prisma.run.findMany({
      where,
      orderBy: { sortAt: "desc" },
      take,
      select: runHistorySelect,
    })
  );
}

async function loadRunHistoryPage(opts: {
  where: Prisma.RunWhereInput;
  viewAll: boolean;
  focusRunId: string | null;
  takeWhenNotViewAll: number;
}): Promise<{
  runs: RunInGroup[];
  totalRunCount: number;
  viewAll: boolean;
  hasMoreRuns: boolean;
}> {
  let viewAll = opts.viewAll;
  const take = viewAll ? RUN_HISTORY_VIEW_ALL_TAKE : opts.takeWhenNotViewAll;
  // Count and first-page fetch are independent — run them concurrently rather
  // than count-then-fetch serially.
  const [totalRunCount, initialRuns] = await Promise.all([
    perfSpan("countRunHistoryRows", () => prisma.run.count({ where: opts.where })),
    fetchRunHistoryRows(opts.where, take),
  ]);
  let runs = initialRuns;

  if (
    opts.focusRunId &&
    !runs.some((r) => r.id === opts.focusRunId) &&
    runs.length < totalRunCount
  ) {
    viewAll = true;
    runs = await fetchRunHistoryRows(opts.where, RUN_HISTORY_VIEW_ALL_TAKE);
  }

  const hasMoreRuns = !viewAll && totalRunCount > runs.length;
  return { runs, totalRunCount, viewAll, hasMoreRuns };
}

// NOTE: A one-shot backfill for `carNameSnapshot`/`trackNameSnapshot` used to
// run on every Analysis page load. It has been removed from the request path
// because (a) the UI already falls back to the relations when snapshots are
// missing, and (b) scanning up to 500 rows and issuing N writes per page load
// was the single biggest cause of Analysis feeling slow.
// If old rows ever need patching, call a one-shot migration endpoint — do not
// reintroduce this on render.

type Group = RunHistoryGroup<RunInGroup>;

/**
 * Above this many rows the totals query stops and reports nothing. A ratio built
 * from a truncated count would understate the denominator — "2 of 5" when it was
 * really 2 of 8 — and a quietly wrong number is worse than no number.
 */
const SESSION_TOTALS_TAKE_CAP = 5000;
/** Slack on the lower bound so a session straddling the boundary is counted whole. */
const SESSION_TOTALS_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Unfiltered run count per session, for the workbench rail's "2 of 8 runs".
 *
 * Selects just the fields {@link sessionGroupKey} reads, and bounds itself to the
 * span already on screen: without a filter this isn't called at all, and with one
 * it reads a few scalar columns rather than whole runs.
 *
 * `userIds` is the visibility scope the page already resolved — the viewer alone
 * in solo, the (possibly driver-narrowed) roster in team. Team scope additionally
 * counts only runs shared with the team, matching the list's own `where`; without
 * that the denominator would include runs the reader is not allowed to see.
 *
 * Returns null whenever the number can't be trusted (disabled, nothing displayed,
 * cap hit) — the rail then prints the plain "N runs" it always has.
 */
async function loadSessionRunTotals(input: {
  enabled: boolean;
  userIds: string[];
  sharedWithTeamOnly: boolean;
  displayTimeZone: string | null;
  ownerTimeZoneByUserId: Record<string, string | null>;
  oldestDisplayed: RunInGroup | null;
}): Promise<Map<string, number> | null> {
  if (!input.enabled || !input.oldestDisplayed || input.userIds.length === 0) return null;
  const since = new Date(
    runSessionSortInstant(input.oldestDisplayed).getTime() - SESSION_TOTALS_LOOKBACK_MS
  );
  const rows = await perfSpan("countSessionRunTotals", () =>
    prisma.run.findMany({
      // `sortAt` is non-null in the schema (`@default(now())`) and is the axis
      // `runSessionSortInstant` uses, so it's the only bound needed here — the
      // `sortAt: Date | null` in `RunForHistoryGroup` is defensive typing, not a
      // shape the database produces.
      where: {
        userId: { in: input.userIds },
        sortAt: { gte: since },
        ...(input.sharedWithTeamOnly ? { shareWithTeam: true } : {}),
      },
      select: {
        id: true,
        userId: true,
        eventId: true,
        createdAt: true,
        sortAt: true,
        localTimeZone: true,
        trackNameSnapshot: true,
        track: { select: { name: true } },
      },
      take: SESSION_TOTALS_TAKE_CAP + 1,
    })
  );
  if (rows.length > SESSION_TOTALS_TAKE_CAP) return null;

  const zones = {
    ownerTimeZoneByUserId: input.ownerTimeZoneByUserId,
    viewerTimeZone: input.displayTimeZone,
  };
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = sessionGroupKey(row, zones);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return totals;
}

export default async function RunHistoryPage({
  searchParams,
}: {
  // `expandLatest=1` is set when the driver completes a run from the log
  // form. Pre-opens the most recent group so the just-completed run is
  // visible without an extra click.
  // `openGroup=<runId>` opens the session group that contains the run, scrolls
  // to it and marks the row — the back trip from the run view.
  // `focusRun=<runId>` is the legacy deep link and redirects to the run view.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const resolvedSearch = (await searchParams) ?? {};
  const rawTeam = resolvedSearch.teamId;
  const teamIdParam = Array.isArray(rawTeam) ? rawTeam[0] : rawTeam;
  const teamId =
    typeof teamIdParam === "string" && teamIdParam.trim() ? teamIdParam.trim() : null;
  const rawExpand = resolvedSearch.expandLatest;
  const expandLatest =
    (Array.isArray(rawExpand) ? rawExpand[0] : rawExpand) === "1";
  const rawViewAll = resolvedSearch.viewAll;
  const viewAllRequested =
    (Array.isArray(rawViewAll) ? rawViewAll[0] : rawViewAll) === "1";
  const filters = parseRunHistoryFilters(resolvedSearch);
  const filtersActive = runHistoryFiltersActive(filters);
  const effectiveViewAllRequested = viewAllRequested || filtersActive;
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/analysis" className="md:hidden" />
            <div>
              <h1 className="page-title">Sessions</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view run history.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  // These three are independent of each other — run them concurrently instead of
  // three serial round trips before any run data is fetched.
  const [displayTimeZone, userDisplayName, teamsForUser] = await Promise.all([
    getExplicitTimeZoneForRunFormatting(),
    getMyNameSetting(user.id),
    listTeamsForUser(user.id),
  ]);

  const rawFocus = resolvedSearch.focusRun;
  const focusRunRaw = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const legacyFocusRun =
    typeof focusRunRaw === "string" && focusRunRaw.trim() ? focusRunRaw.trim() : null;
  // `?focusRun=` predates the run view: it expanded that run's row in place. The run view is
  // now the one place a run is looked at (Option A, 2026-07-29), so the deep link — still in
  // old push notifications and bookmarks — redirects there. Access is re-checked on the page.
  if (legacyFocusRun) redirect(`/runs/${encodeURIComponent(legacyFocusRun)}`);

  // `?openGroup=` is the return trip *from* that view, so it must expand in place — which is
  // why it can't reuse `focusRun` above (that one redirects, and has to keep redirecting).
  const rawOpenGroup = resolvedSearch[OPEN_GROUP_PARAM];
  const openGroupRaw = Array.isArray(rawOpenGroup) ? rawOpenGroup[0] : rawOpenGroup;
  const openGroupParam =
    typeof openGroupRaw === "string" && openGroupRaw.trim() ? openGroupRaw.trim() : null;

  let runs: RunInGroup[] = [];
  let totalRunCount = 0;
  let viewAll = effectiveViewAllRequested;
  let hasMoreRuns = false;
  let teamTitle: string | null = null;
  let memberDisplayByUserId: Record<string, string> = {};
  let teamAccessDenied = false;
  let filterCars: { id: string; label: string }[] = [];
  let filterTracks: { id: string; label: string }[] = [];
  let filterEvents: { id: string; label: string }[] = [];
  let filterTireTypes: { id: string; label: string }[] = [];
  let filterSetupFields: { id: string; label: string }[] = [];
  /** Team scope only — the roster, as Driver filter options. Empty in solo scope. */
  let filterDrivers: { id: string; label: string }[] = [];
  /** Whose runs this page is allowed to show — the viewer, or the (narrowed) roster. */
  let scopedUserIds: string[] = [user.id];

  if (teamId) {
    const allowed = await assertUserInTeam(teamId, user.id);
    if (!allowed) {
      teamAccessDenied = true;
    } else {
      const teamRow = await prisma.team.findFirst({
        where: { id: teamId },
        select: { name: true },
      });
      teamTitle = teamRow?.name ?? "Team";
      const memberIds = await listTeamMemberUserIds(teamId);
      const takeWhenNotViewAll = Math.min(
        120,
        Math.max(RUN_HISTORY_INITIAL_TAKE, RUN_HISTORY_INITIAL_TAKE * memberIds.length)
      );
      // The Driver filter narrows *within* the roster, never outside it. Intersecting
      // here — the one place that decides whose runs a viewer may see — means a
      // hand-edited `driverIds` naming someone from another team falls back to the
      // roster instead of reaching their runs.
      const selectedDriverIds = filters.driverIds.filter((id) => memberIds.includes(id));
      const scopedMemberIds = selectedDriverIds.length ? selectedDriverIds : memberIds;
      scopedUserIds = scopedMemberIds;
      const baseWhere = buildRunHistoryPrismaWhere(filters, {
        userId: { in: scopedMemberIds },
        shareWithTeam: true,
      });
      const loaded = await loadRunHistoryPage({
        where: baseWhere,
        viewAll: effectiveViewAllRequested,
        focusRunId: openGroupParam,
        takeWhenNotViewAll,
      });
      runs = loaded.runs;
      totalRunCount = loaded.totalRunCount;
      viewAll = loaded.viewAll;
      hasMoreRuns = loaded.hasMoreRuns;
      memberDisplayByUserId = memberDisplayLabelRecord(
        await loadTeamMemberDisplays(memberIds, user.id)
      );
      // Options come from the full roster, not the filtered result, so narrowing to one
      // driver doesn't remove everyone else from the picker you'd use to widen again.
      filterDrivers = memberIds
        .map((id) => ({ id, label: memberDisplayByUserId[id] ?? "Unknown driver" }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
  } else {
    const baseWhere = buildRunHistoryPrismaWhere(filters, { userId: user.id });
    const loaded = await loadRunHistoryPage({
      where: baseWhere,
      viewAll: effectiveViewAllRequested,
      focusRunId: openGroupParam,
      takeWhenNotViewAll: RUN_HISTORY_INITIAL_TAKE,
    });
    runs = loaded.runs;
    totalRunCount = loaded.totalRunCount;
    viewAll = loaded.viewAll;
    hasMoreRuns = loaded.hasMoreRuns;
  }

  if (!teamAccessDenied) {
    const [cars, tracks, scopedEvents, tireSets] = await Promise.all([
      prisma.car.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.track.findMany({
        where: trackCatalogScopeWhere(user),
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      loadUserScopedEvents({ userId: user.id, take: 200 }),
      prisma.run.groupBy({
        by: ["tireTypeId"],
        where: { userId: user.id, tireTypeId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    filterCars = cars.map((c) => ({ id: c.id, label: c.name }));
    filterTracks = tracks.map((t) => ({ id: t.id, label: t.name }));
    filterEvents = scopedEvents.map((e) => ({ id: e.id, label: e.name }));
    // Compounds the driver has actually run, with how many runs are on each.
    const tireTypeNames = new Map<string, string>(
      (
        await prisma.tireType.findMany({
          where: { id: { in: tireSets.map((t) => t.tireTypeId!).filter(Boolean) } },
          select: { id: true, displayName: true },
        })
      ).map((t) => [t.id, t.displayName] as const)
    );
    const tireTypeCounts = new Map<string, number>();
    for (const row of tireSets) {
      const identity = tireTypeNames.get(row.tireTypeId!);
      if (!identity) continue;
      tireTypeCounts.set(identity, (tireTypeCounts.get(identity) ?? 0) + row._count._all);
    }
    filterTireTypes = [...tireTypeCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([identity, count]) => ({
        id: identity,
        label: `${identity} · ${count} run${count === 1 ? "" : "s"}`,
      }));
  }

  // Server-side setup parameters for the loaded runs — powers smart search over
  // setup values, the "setup changed" filter, and the setup-field pickers. Kept
  // server-side (not serialized to the client; RunDetail still fetches per-run).
  const setupSnapshotIds = [...new Set(runs.map((r) => r.setupSnapshotId).filter(Boolean))];
  const setupSnaps = setupSnapshotIds.length
    ? await perfSpan("fetchRunHistorySetupData", () =>
        prisma.setupSnapshot.findMany({
          where: { id: { in: setupSnapshotIds } },
          select: { id: true, data: true },
        })
      )
    : [];
  const setupDataBySnapshotId = new Map<string, unknown>(
    setupSnaps.map((s) => [s.id, s.data as unknown])
  );
  const setupDataByRunId = new Map<string, unknown>(
    runs.map((r) => [r.id, setupDataBySnapshotId.get(r.setupSnapshotId)])
  );
  const setupFieldKeys = new Set<string>();
  for (const data of setupDataByRunId.values()) {
    for (const key of Object.keys(normalizeSetupData(data))) {
      // Sheet header fields (name/race/track/date…) aren't setup parameters.
      if (!isDocumentMetadataField(key)) setupFieldKeys.add(key);
    }
  }
  filterSetupFields = [...setupFieldKeys]
    .map((key) => ({ id: key, label: setupFieldLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const dbMatchedCount = runs.length;
  // Account-level zone per driver — the fallback for runs logged before
  // `Run.localTimeZone` existed. Without it those runs would fall back to the
  // reader's zone, which is what split a teammate's test day across two dates.
  const ownerTimeZoneByUserId: Record<string, string | null> = {};
  {
    const driverIds = [...new Set(runs.map((r) => r.userId).filter(Boolean))];
    if (driverIds.length > 0) {
      const owners = await prisma.user.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, timeZone: true },
      });
      for (const o of owners) ownerTimeZoneByUserId[o.id] = o.timeZone;
    }
  }
  // Each run's name, resolved against its whole day — a name today REPEATS says
  // nothing, so it becomes the run's position ("Run 2"). Computed from the full
  // fetched set (pre-search-filter) so filtering never renumbers a day.
  const dayRunNameByRunId = buildDayRunNameMap(runs, displayTimeZone, {
    ownerTimeZoneByUserId,
  });
  // Changed-keys diffing is O(runs × setup keys) — only pay for it when the
  // "setup item changed" filter is actually in play.
  const changedKeysByRunId = filters.setupChangedField
    ? computeChangedKeysByRun<RunInGroup>(runs, { setupDataByRunId })
    : undefined;
  const matchResult = applyRunHistoryPostFiltersWithReasons<RunInGroup>(
    runs,
    filters,
    displayTimeZone,
    { setupDataByRunId, changedKeysByRunId, memberLabelByUserId: memberDisplayByUserId }
  );
  runs = sortRunsForHistory(matchResult.runs, filters.sort);
  const matchReasonsById: Record<string, MatchReason[]> = Object.fromEntries(
    matchResult.reasonsById
  );
  const matchedRunCount = runs.length;

  const groups: Group[] =
    filters.layout === "flat"
      ? []
      : buildRunHistoryGroups(runs, displayTimeZone, { ownerTimeZoneByUserId });
  const allRunsDescending = [...runs].sort(compareRunTimestamp);
  const compareRunsDescending = allRunsDescending.map(toCompareRunShape);
  const focusRunId =
    openGroupParam && runs.some((r) => r.id === openGroupParam) ? openGroupParam : null;
  // Landing target for the trip back from a run page (`?openGroup=<runId>`): the
  // session that holds it. The browser then opens that day, so "back" returns you
  // to the thing you were reading rather than to a cold list.
  const focusGroupId =
    focusRunId == null
      ? null
      : groups.find((g) => g.runs.some((r) => r.id === focusRunId))?.id ?? null;

  const teamMode = Boolean(teamId && !teamAccessDenied);

  // The grouped view, both scopes and both layouts. Team used to fall back to the
  // `<details>` accordion here because "a team group nests by driver first, which
  // is a different shape than sessions → runs" — that driver level now exists
  // (`buildGroupDrivers`), so there is one browser and one shape.
  const browserActive = filters.layout !== "flat" && groups.length > 0;
  // "2 of 8 runs" needs the session's UNFILTERED size, which nothing above has:
  // `groups` is built from rows both the Prisma where and the JS post-filters have
  // already thinned. One extra query, only when a filter is on, selecting just the
  // fields `sessionGroupKey` reads — bounded to the span already on screen so it
  // never walks the whole archive.
  const sessionTotalsByGroupId = await loadSessionRunTotals({
    enabled: browserActive && filtersActive,
    userIds: scopedUserIds,
    sharedWithTeamOnly: teamMode,
    displayTimeZone,
    ownerTimeZoneByUserId,
    oldestDisplayed: groups.at(-1)?.runs.at(-1) ?? null,
  });
  const groupZones = { ownerTimeZoneByUserId, viewerTimeZone: displayTimeZone };
  /**
   * Your previous session at the same track, per group — the "vs Wed 12 Aug −0.72"
   * on a solo day header. `groups` is newest-first, so the first later index at the
   * same track is the last time you were here. Solo only: in team scope the day
   * belongs to the field, not to you, and the comparison has no single subject.
   */
  const priorRowsByGroupId = new Map<string, { dateLabel: string; rows: ReturnType<typeof buildGroupRunRows> }>();
  if (!teamMode) {
    const rowsByGroupId = new Map(groups.map((g) => [g.id, buildGroupRunRows(g, groupZones)]));
    groups.forEach((group, index) => {
      for (let i = index + 1; i < groups.length; i++) {
        const older = groups[i]!;
        if (older.trackName !== group.trackName) continue;
        priorRowsByGroupId.set(group.id, {
          dateLabel: older.dateLabel,
          rows: rowsByGroupId.get(older.id) ?? [],
        });
        return;
      }
    });
  }
  const browserGroups: WorkbenchGroup[] = browserActive
    ? groups.map((group) => {
        const rows = buildGroupRunRows(group, groupZones, { setupDataByRunId });
        return {
          id: group.id,
          // A test day's date lives on the meta line, so "Test day – 19 Jul 2026"
          // collapses to "Test day".
          title: group.type === "Event" ? group.title : "Test day",
          type: group.type,
          trackName: group.trackName && group.trackName !== "—" ? group.trackName : null,
          dateLabel: group.dateLabel,
          runs: rows,
          trend: buildGroupTrendModel(group, { setupDataByRunId, zones: groupZones }),
          headline: teamMode
            ? null
            : buildGroupHeadline(rows, priorRowsByGroupId.get(group.id) ?? null),
          drivers: teamMode
            ? buildGroupDrivers(group, { memberDisplayByUserId, setupDataByRunId, zones: groupZones })
            : null,
          teamDay: teamMode
            ? buildTeamDayModel(group.runs, { memberDisplayByUserId, zones: groupZones })
            : null,
          totalRuns: sessionTotalsByGroupId?.get(group.id) ?? null,
        };
      })
    : [];
  // Short labels for the browser's filter ribbon. Tire-type values are already
  // human ("Blue compound"); the rest need the same option lists the bar uses.
  const browserFilterLabels =
    browserActive && filtersActive
      ? describeRunHistoryFilters(filters, {
          cars: filterCars,
          tracks: filterTracks,
          events: filterEvents,
          drivers: filterDrivers,
        })
      : [];
  const pageTitle = teamAccessDenied ? "Sessions" : teamMode ? `Team — ${teamTitle}` : "Sessions";
  const mySessionsViewDescription =
    "Every day you have been on track. Pick a day to read it, then a run.";
  const activeTeamViewDescription = teamTitle
    ? `Runs shared with everyone in ${teamTitle}. Pick a day to see the field, a driver to read their session.`
    : "Runs shared with your team. Pick a day to see the field, a driver to read their session.";
  const activeViewDescription = teamMode ? activeTeamViewDescription : mySessionsViewDescription;
  const pageSubtitle = teamAccessDenied
    ? "That team was not found or you are not a member."
    : activeViewDescription;

  function renderFlatRunList() {
    const showSessionColumn = runs.some(
      (r) => (dayRunNameByRunId[r.id] ?? formatRunSessionDisplay(r)) !== "—"
    );
    const columnLayout = {
      showReorderColumn: !teamMode,
      showMemberColumn: teamMode,
      showSessionColumn,
    };
    const colSpan = computeRunHistoryColSpan(columnLayout);
    return (
      <SurfaceCard variant="panel" contentClassName="p-0" className="min-w-0 max-w-full">
      <div className="min-w-0 max-w-full">
        <div className="min-w-0 max-w-full max-md:overflow-x-hidden md:overflow-x-auto">
          <table className="w-full max-w-full text-sm md:table-fixed">
            <RunHistoryColGroup
              layout={columnLayout}
            />
            <thead>
              <RunHistoryMobileHeaderRow colSpan={colSpan} />
              <tr className="hidden md:table-row border-b border-border bg-muted/70 text-left">
                {!teamMode ? (
                  <th
                    className="hidden md:table-cell w-6 px-1 py-2"
                    aria-label="Drag to reorder"
                  />
                ) : null}
                {teamMode ? (
                  <th className="table-col-header px-2 py-1.5 md:px-2 md:py-2 max-w-[4.5rem] md:max-w-none">
                    <span className="hidden sm:inline">Member</span>
                    <span className="sm:hidden">Who</span>
                  </th>
                ) : null}
                <th className="table-col-header px-2 py-1.5 md:px-2 md:py-2 whitespace-nowrap">Date</th>
                {showSessionColumn ? (
                  <th className="table-col-header px-2 py-1.5 md:px-2 md:py-2 min-w-0">Session</th>
                ) : null}
                <th className="table-col-header hidden md:table-cell px-2 py-2">Car</th>
                <th className="table-col-header px-1.5 py-1.5 md:px-2 md:py-2 whitespace-nowrap">Best</th>
                {/* "Top 5" / "Top 10", not "Avg top 5" — the long labels are wider
                    than the columns they head and were already overlapping each
                    other at 1440. The phone header has always said this. */}
                <th
                  className="table-col-header px-1.5 py-1.5 md:px-2 md:py-2 whitespace-nowrap"
                  title="Average of the 5 best laps"
                >
                  Top 5
                </th>
                <th
                  className="table-col-header hidden md:table-cell px-1.5 py-1.5 md:px-2 md:py-2 whitespace-nowrap"
                  title="Average of the 10 best laps"
                >
                  Top 10
                </th>
                <th className="table-col-header px-1.5 py-1.5 md:px-2 md:py-2 whitespace-nowrap">
                  Median
                </th>
                <th
                  className={cn(RUN_HISTORY_ACTION_CELL_CLASS, "text-[10px]")}
                  aria-label="Setup and laps"
                />
              </tr>
            </thead>
            <tbody>
              <RunHistoryTable
                runs={runs}
                allRunsDescending={compareRunsDescending}
                runListSource={teamMode ? "team_runs" : "my_runs"}
                userDisplayName={userDisplayName}
                displayTimeZone={displayTimeZone}
                enableReorder={!teamMode}
                viewerUserId={teamMode ? user.id : null}
                memberDisplayByUserId={teamMode ? memberDisplayByUserId : undefined}
                showMemberColumn={teamMode}
                showSessionColumn={showSessionColumn}
                dayRunNameByRunId={dayRunNameByRunId}
                matchReasonsById={matchReasonsById}
                focusRunId={focusRunId}
              />
            </tbody>
          </table>
        </div>
      </div>
      </SurfaceCard>
    );
  }

  const filterQuery = filtersToSearchParams(filters, {
    ...(teamId ? { teamId } : {}),
    ...(focusRunId ? { [OPEN_GROUP_PARAM]: focusRunId } : {}),
    ...(viewAll ? { viewAll: "1" } : {}),
  }).toString();

  // One node, three placements — the flat list, the phone/team accordion, and the
  // foot of the workbench rail. Built once so the props can't drift apart.
  const viewMore = (
    <RunHistoryViewMore
      viewAll={viewAll}
      hasMoreRuns={hasMoreRuns}
      totalRunCount={totalRunCount}
      loadedRunCount={dbMatchedCount}
      teamId={teamId}
      openGroup={focusRunId}
      filterQuery={filterQuery}
    />
  );

  if (teamAccessDenied) {
    return (
      <>
        <header className="page-header is-echo">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/analysis" className="md:hidden" />
            <div>
              <h1 className="page-title">{pageTitle}</h1>
              <p className="page-subtitle">{pageSubtitle}</p>
            </div>
          </div>
        </header>
      <section className="page-body min-w-0 max-w-full">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            <Link href="/runs/history" className="text-primary-ink underline">
              Back to my sessions
            </Link>
          </CardPanel>
        </section>
      </>
    );
  }

  return (
    <>
      {/* `sessions-chrome` — this header names the LIST, so on a phone it folds
          away once you push into a day (globals.css, keyed off `data-sessions-depth`). */}
      <header className="page-header is-echo sessions-chrome">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/*
            Phone only, and the breakpoint is the whole point (2026-08-08).

            Below md the dock's Analysis tab is `/analysis` and Sessions is a door on it, so
            back-to-the-hub is the true parent. From md up the sidebar appears and its Analysis
            item IS `/runs/history` (navConfig `ANALYSIS_DESKTOP`) — Sessions is a top-level
            destination there, and an arrow to `/analysis` walks sideways into a page the
            desktop nav can no longer reach. Dashboard, Engineer, Garage and Tools carry no
            back arrow for the same reason. Repeated verbatim on the two early-return headers
            below; move all three together.
          */}
          <PageBackLink href="/analysis" className="md:hidden" />
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            <p className="page-subtitle">{pageSubtitle}</p>
          </div>
        </div>
      </header>
      <section className="page-body min-w-0 max-w-full">
        {/* Flat-list only. In the grouped view the trip back from a run lands on
            `?g=<session>` — the day the run belongs to — so there is no row to
            hunt for and nothing to scroll to. */}
        {filters.layout === "flat" ? <SessionsFocusScroll runId={focusRunId} /> : null}
        <Suspense fallback={<div className="h-20 rounded-lg border border-border bg-card animate-pulse" />}>
          <div className="sessions-chrome">
          <SessionsFilterBar
            cars={filterCars}
            tracks={filterTracks}
            events={filterEvents}
            tireTypes={filterTireTypes}
            setupFields={filterSetupFields}
            drivers={filterDrivers}
            teams={teamsForUser.map((t) => ({ id: t.id, name: t.name }))}
            teamId={teamId}
            openGroup={focusRunId}
            viewAll={viewAll}
          />
          </div>
        </Suspense>
        {matchedRunCount === 0 ? (
          <CardPanel className="text-sm text-muted-foreground">
            {filtersActive ? (
              <>No runs match these filters.</>
            ) : teamMode ? (
              <>No runs from team members yet.</>
            ) : (
              <>
                No runs yet. <Link href="/runs/new" className="text-primary-ink underline">Create your first run</Link>.
              </>
            )}
          </CardPanel>
        ) : filters.layout === "flat" ? (
          <div className="space-y-2">
            {renderFlatRunList()}
            {viewMore}
          </div>
        ) : (
          /* One browser, both scopes, both layouts: the rail beside a reading pane
             at lg+, the same selection as a push stack on a phone. "View more"
             rides at the foot of the rail rather than under the page, because it
             belongs to the archive — you reach it by running out of sessions. */
          <SessionsBrowser
            groups={browserGroups}
            runs={runs}
            pickerRuns={compareRunsDescending}
            runListSource={teamMode ? "team_runs" : "my_runs"}
            displayTimeZone={displayTimeZone}
            userDisplayName={userDisplayName}
            memberDisplayByUserId={memberDisplayByUserId}
            viewerUserId={user.id}
            teamMode={teamMode}
            teamTitle={teamTitle}
            teamId={teamId}
            filtersActive={filtersActive}
            filterLabels={browserFilterLabels}
            railFooter={viewMore}
            initialGroupId={focusGroupId}
            initialRunId={focusRunId}
          />
        )}
      </section>
    </>
  );
}
