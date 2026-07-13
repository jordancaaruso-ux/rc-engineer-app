import type { ReactNode } from "react";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting, getMyNameSettingsForUsers } from "@/lib/appSettings";
import { RunHistoryTable } from "@/components/runs/RunHistoryTable";
import { RunHistoryColGroup, RunHistoryMobileHeaderRow, RUN_HISTORY_ACTION_CELL_CLASS, computeRunHistoryColSpan } from "@/components/runs/runHistoryTableColumns";
import { SessionGroupsPager } from "@/components/runs/SessionGroupsPager";
import { RunHistoryViewMore } from "@/components/runs/RunHistoryViewMore";
import { SessionsFilterBar } from "@/components/runs/SessionsFilterBar";
import { buildRunHistoryGroups, type RunHistoryGroup } from "@/lib/runs/buildRunHistoryGroups";
import {
  applyRunHistoryPostFiltersWithReasons,
  buildRunHistoryPrismaWhere,
  computeChangedKeysByRun,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  sortRunsForHistory,
  type MatchReason,
} from "@/lib/runs/runHistoryFilters";
import { normalizeSetupData } from "@/lib/runSetup";
import { getBestLap, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { formatLap } from "@/lib/runLaps";
import { isDocumentMetadataField } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { compareRunTimestamp } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import Link from "next/link";
import { ChevronRight, Flag, Wrench } from "lucide-react";
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

const runHistoryInclude = {
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireSet: {
    select: {
      id: true,
      label: true,
      setNumber: true,
      tireType: { select: { displayName: true } },
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
} satisfies Prisma.RunInclude;

type RunInGroup = Prisma.RunGetPayload<{ include: typeof runHistoryInclude }>;

async function fetchRunHistoryRows(where: Prisma.RunWhereInput, take: number): Promise<RunInGroup[]> {
  return perfSpan(`fetchRunHistoryRows(take=${take})`, () =>
    prisma.run.findMany({
      where,
      orderBy: { sortAt: "desc" },
      take,
      include: runHistoryInclude,
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
  const totalRunCount = await perfSpan("countRunHistoryRows", () =>
    prisma.run.count({ where: opts.where })
  );
  let viewAll = opts.viewAll;
  let take = viewAll ? RUN_HISTORY_VIEW_ALL_TAKE : opts.takeWhenNotViewAll;
  let runs = await fetchRunHistoryRows(opts.where, take);

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

export default async function RunHistoryPage({
  searchParams,
}: {
  // `expandLatest=1` is set when the driver completes a run from the log
  // form. Pre-opens the most recent group so the just-completed run is
  // visible without an extra click.
  // `focusRun=<runId>` opens the session group that contains the run and
  // expands that row (e.g. from dashboard "View run").
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
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/analysis" />
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
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
  const userDisplayName = await getMyNameSetting(user.id);
  const teamsForUser = await listTeamsForUser(user.id);

  const rawFocus = resolvedSearch.focusRun;
  const focusRunRaw = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const focusRunParam =
    typeof focusRunRaw === "string" && focusRunRaw.trim() ? focusRunRaw.trim() : null;

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
      const baseWhere = buildRunHistoryPrismaWhere(filters, {
        userId: { in: memberIds },
        shareWithTeam: true,
      });
      const loaded = await loadRunHistoryPage({
        where: baseWhere,
        viewAll: effectiveViewAllRequested,
        focusRunId: focusRunParam,
        takeWhenNotViewAll,
      });
      runs = loaded.runs;
      totalRunCount = loaded.totalRunCount;
      viewAll = loaded.viewAll;
      hasMoreRuns = loaded.hasMoreRuns;
      const [members, myNames] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, name: true, email: true },
        }),
        // Display names are stored per-user in AppSetting (Settings → "My name"),
        // not User.name — prefer that so the roster matches what each member set.
        getMyNameSettingsForUsers(memberIds),
      ]);
      memberDisplayByUserId = Object.fromEntries(
        members.map((m) => {
          const base =
            myNames[m.id]?.trim() || m.name?.trim() || m.email?.trim() || m.id.slice(0, 8);
          return [m.id, m.id === user.id ? `You (${base})` : base] as const;
        })
      );
    }
  } else {
    const baseWhere = buildRunHistoryPrismaWhere(filters, { userId: user.id });
    const loaded = await loadRunHistoryPage({
      where: baseWhere,
      viewAll: effectiveViewAllRequested,
      focusRunId: focusRunParam,
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
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      loadUserScopedEvents({ userId: user.id, take: 200 }),
      prisma.tireSet.findMany({
        where: { userId: user.id },
        orderBy: [{ label: "asc" }, { setNumber: "asc" }],
        select: { id: true, label: true, tireType: { select: { displayName: true } } },
      }),
    ]);
    filterCars = cars.map((c) => ({ id: c.id, label: c.name }));
    filterTracks = tracks.map((t) => ({ id: t.id, label: t.name }));
    filterEvents = scopedEvents.map((e) => ({ id: e.id, label: e.name }));
    // Group physical sets into tire *types*: linked type name, else legacy label.
    const tireTypeCounts = new Map<string, number>();
    for (const ts of tireSets) {
      const identity = ts.tireType?.displayName ?? ts.label;
      tireTypeCounts.set(identity, (tireTypeCounts.get(identity) ?? 0) + 1);
    }
    filterTireTypes = [...tireTypeCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([identity, count]) => ({
        id: identity,
        label: `${identity} · ${count} set${count === 1 ? "" : "s"}`,
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
  // Changed-keys diffing is O(runs × setup keys) — only pay for it when the
  // "setup item changed" filter is actually in play.
  const changedKeysByRunId = filters.setupChangedField
    ? computeChangedKeysByRun<RunInGroup>(runs, { setupDataByRunId })
    : undefined;
  const matchResult = applyRunHistoryPostFiltersWithReasons<RunInGroup>(
    runs,
    filters,
    displayTimeZone,
    { setupDataByRunId, changedKeysByRunId }
  );
  runs = sortRunsForHistory(matchResult.runs, filters.sort);
  const matchReasonsById: Record<string, MatchReason[]> = Object.fromEntries(
    matchResult.reasonsById
  );
  const matchedRunCount = runs.length;

  const groups: Group[] =
    filters.layout === "flat" ? [] : buildRunHistoryGroups(runs, displayTimeZone);
  const allRunsDescending = [...runs].sort(compareRunTimestamp);
  const compareRunsDescending = allRunsDescending.map(toCompareRunShape);
  const focusRunId =
    focusRunParam && runs.some((r) => r.id === focusRunParam) ? focusRunParam : null;
  const focusGroupIndex =
    focusRunId == null ? -1 : groups.findIndex((g) => g.runs.some((r) => r.id === focusRunId));
  const pagerInitial =
    focusGroupIndex >= 0 ? Math.max(8, focusGroupIndex + 1) : 8;

  const teamMode = Boolean(teamId && !teamAccessDenied);
  const pageTitle = teamAccessDenied ? "Sessions" : teamMode ? `Team — ${teamTitle}` : "Sessions";
  const mySessionsViewDescription =
    "Your runs grouped by session. Filter, compare, and drag to reorder within a group.";
  const activeTeamViewDescription = teamTitle
    ? `Runs shared with everyone in ${teamTitle}. Open any member’s run read-only; reordering is disabled.`
    : "Runs shared with your team. Open any member’s run read-only; reordering is disabled.";
  const activeViewDescription = teamMode ? activeTeamViewDescription : mySessionsViewDescription;
  const pageSubtitle = teamAccessDenied
    ? "That team was not found or you are not a member."
    : activeViewDescription;

  /**
   * The Best/Top5/Median grid table for a set of runs. Reused for solo groups,
   * single-driver team groups, and inside each per-driver accordion. Column
   * layout follows `showMemberColumn` (dropped when a driver sub-heading already
   * names the member) and reorder is team-disabled.
   */
  function renderRunsTable(
    tableRuns: RunInGroup[],
    opts: { showMemberColumn: boolean; initialExpandedRunId: string | null }
  ) {
    const showSessionColumn = tableRuns.some((r) => formatRunSessionDisplay(r) !== "—");
    const columnLayout = {
      showReorderColumn: !teamMode,
      showMemberColumn: opts.showMemberColumn,
      showSessionColumn,
    };
    const colSpan = computeRunHistoryColSpan(columnLayout);
    return (
      <div className="min-w-0 max-w-full max-md:overflow-x-hidden md:overflow-x-auto">
        <table className="w-full max-w-full text-sm table-fixed">
          <RunHistoryColGroup layout={columnLayout} />
          <thead>
            <RunHistoryMobileHeaderRow colSpan={colSpan} />
            <tr className="hidden md:table-row border-b border-border bg-muted/70 text-left">
              {!teamMode ? (
                <th
                  className="hidden md:table-cell w-6 px-1 py-2"
                  aria-label="Drag to reorder"
                />
              ) : null}
              {columnLayout.showMemberColumn ? (
                <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 max-w-[4.5rem] md:max-w-none">
                  <span className="hidden sm:inline">Member</span>
                  <span className="sm:hidden">Who</span>
                </th>
              ) : null}
              <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                Date
              </th>
              {showSessionColumn ? (
                <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 min-w-0">
                  Session
                </th>
              ) : null}
              <th className="table-col-header hidden md:table-cell px-4 py-2">Car</th>
              <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                Best
              </th>
              <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                <span className="md:hidden">Top 5</span>
                <span className="hidden md:inline">Avg top 5</span>
              </th>
              <th className="table-col-header hidden md:table-cell px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                Avg top 10
              </th>
              <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
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
              runs={tableRuns}
              allRunsDescending={compareRunsDescending}
              runListSource={teamMode ? "team_runs" : "my_runs"}
              userDisplayName={userDisplayName}
              displayTimeZone={displayTimeZone}
              enableReorder={!teamMode}
              viewerUserId={teamMode ? user.id : null}
              memberDisplayByUserId={teamMode ? memberDisplayByUserId : undefined}
              showMemberColumn={columnLayout.showMemberColumn}
              showSessionColumn={showSessionColumn}
              matchReasonsById={matchReasonsById}
              initialExpandedRunId={opts.initialExpandedRunId}
            />
          </tbody>
        </table>
      </div>
    );
  }

  function renderSessionGroup(group: Group, idx: number) {
    const isRaceMeeting = group.type === "Race Meeting";
    // Test days: the date now lives on the meta line, so the generic
    // "Test day – <date>" title collapses to just "Test day".
    const displayTitle = isRaceMeeting ? group.title : "Test day";
    const trackDisplay =
      group.trackName && group.trackName !== "—" ? group.trackName : null;
    const groupHasFocus =
      focusRunId != null && group.runs.some((r) => r.id === focusRunId);

    // Team view: cluster a group's runs by driver, ranked by pace (best included
    // lap), and expose each driver as its own accordion — the collation surface
    // ("what's everyone running here"). Solo / single-driver groups skip the
    // driver level and show runs directly.
    const driverClusters = teamMode
      ? (() => {
          const byUser = new Map<string, RunInGroup[]>();
          for (const r of group.runs) {
            const uid = r.userId ?? "unknown";
            const list = byUser.get(uid);
            if (list) list.push(r);
            else byUser.set(uid, [r]);
          }
          const clusters = [...byUser.entries()].map(([userId, driverRuns]) => {
            const bests = driverRuns
              .map((r) => getBestLap(primaryLapRowsFromRun(r)))
              .filter((n): n is number => n != null);
            return {
              userId,
              name: memberDisplayByUserId?.[userId] ?? "Unknown driver",
              runs: driverRuns,
              best: bests.length ? Math.min(...bests) : null,
            };
          });
          // Fastest driver first; drivers with no timed lap fall to the bottom.
          clusters.sort((a, b) =>
            a.best == null && b.best == null
              ? 0
              : a.best == null
                ? 1
                : b.best == null
                  ? -1
                  : a.best - b.best
          );
          return clusters;
        })()
      : null;
    const multiDriver = driverClusters != null && driverClusters.length > 1;
    return (
      // Track-forward session row inside the single Sessions card: icon well
      // carries the type (flag = race meeting, wrench = testing), date + run
      // count sit under the full (never truncated) title, track holds the
      // right column. Approved artifact: sessions-redesign (variant C).
      <details
        key={group.id}
        className="min-w-0 max-w-full group/details border-t border-border first:border-t-0"
        open={
          focusRunId
            ? group.runs.some((r) => r.id === focusRunId)
            : expandLatest && idx === 0
        }
      >
        <summary className="list-none cursor-pointer overflow-x-hidden">
          <div className="flex min-w-0 items-center gap-3 px-3 py-3 hover:bg-muted/50 transition sm:px-4">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground"
              title={group.type}
              aria-label={group.type}
            >
              {isRaceMeeting ? (
                <Flag className="h-4 w-4" aria-hidden />
              ) : (
                <Wrench className="h-4 w-4" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="session-group-title block">{displayTitle}</span>
              <span className="type-timestamp mt-0.5 block leading-none">
                {group.dateLabel}
                <span className="whitespace-nowrap">
                  {" "}· {group.runs.length} run{group.runs.length !== 1 ? "s" : ""}
                </span>
              </span>
            </span>
            {trackDisplay ? (
              <span className="min-w-0 max-w-[45%] shrink text-right text-xs font-semibold leading-tight text-muted-foreground">
                {trackDisplay}
              </span>
            ) : null}
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-open/details:rotate-90"
              aria-hidden
            />
          </div>
        </summary>
        <div className="min-w-0 max-w-full border-t border-border bg-background/60">
          {multiDriver && driverClusters ? (
            driverClusters.map((driver, dIdx) => {
              const driverHasFocus =
                focusRunId != null && driver.runs.some((r) => r.id === focusRunId);
              return (
                <details
                  key={driver.userId}
                  className="group/driver min-w-0 max-w-full border-t border-border first:border-t-0"
                  open={driverHasFocus}
                >
                  <summary className="list-none cursor-pointer overflow-x-hidden">
                    <div className="flex min-w-0 items-center gap-3 py-2.5 pl-4 pr-3 hover:bg-muted/50 transition sm:pl-6 sm:pr-4">
                      {/* Pace rank — the driver list is a mini leaderboard. */}
                      <span className="type-timestamp w-4 shrink-0 text-center text-faint">
                        {dIdx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                        {driver.name}
                      </span>
                      <span className="type-timestamp shrink-0 whitespace-nowrap">
                        {driver.runs.length} run{driver.runs.length !== 1 ? "s" : ""}
                        {driver.best != null ? (
                          <>
                            {" "}· best{" "}
                            <span className="text-foreground">{formatLap(driver.best)}</span>
                          </>
                        ) : null}
                      </span>
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-open/driver:rotate-90"
                        aria-hidden
                      />
                    </div>
                  </summary>
                  {renderRunsTable(driver.runs, {
                    showMemberColumn: false,
                    initialExpandedRunId: driverHasFocus ? focusRunId : null,
                  })}
                </details>
              );
            })
          ) : (
            renderRunsTable(group.runs, {
              // Single-driver team group keeps the member column to attribute the
              // one driver; solo groups have no member column.
              showMemberColumn: teamMode,
              initialExpandedRunId: groupHasFocus ? focusRunId : null,
            })
          )}
        </div>
      </details>
    );
  }

  function renderFlatRunList() {
    const showSessionColumn = runs.some((r) => formatRunSessionDisplay(r) !== "—");
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
                  <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 max-w-[4.5rem] md:max-w-none">
                    <span className="hidden sm:inline">Member</span>
                    <span className="sm:hidden">Who</span>
                  </th>
                ) : null}
                <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 whitespace-nowrap">Date</th>
                {showSessionColumn ? (
                  <th className="table-col-header px-2 py-1.5 md:px-3 md:py-2 min-w-0">Session</th>
                ) : null}
                <th className="table-col-header hidden md:table-cell px-4 py-2">Car</th>
                <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">Best</th>
                <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                  <span className="md:hidden">Top 5</span>
                  <span className="hidden md:inline">Avg top 5</span>
                </th>
                <th className="table-col-header hidden md:table-cell px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                  Avg top 10
                </th>
                <th className="table-col-header px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
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
                matchReasonsById={matchReasonsById}
                initialExpandedRunId={focusRunId}
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
    ...(focusRunId ? { focusRun: focusRunId } : {}),
    ...(viewAll ? { viewAll: "1" } : {}),
  }).toString();

  if (teamAccessDenied) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/analysis" />
            <div>
              <h1 className="page-title">{pageTitle}</h1>
              <p className="page-subtitle">{pageSubtitle}</p>
            </div>
          </div>
        </header>
      <section className="page-body min-w-0 max-w-full">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            <Link href="/runs/history" className="text-accent underline">
              Back to my sessions
            </Link>
          </CardPanel>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/analysis" />
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            <p className="page-subtitle">{pageSubtitle}</p>
          </div>
        </div>
      </header>
      <section className="page-body min-w-0 max-w-full">
        <Suspense fallback={<div className="h-20 rounded-lg border border-border bg-card animate-pulse" />}>
          <SessionsFilterBar
            cars={filterCars}
            tracks={filterTracks}
            events={filterEvents}
            tireTypes={filterTireTypes}
            setupFields={filterSetupFields}
            teams={teamsForUser.map((t) => ({ id: t.id, name: t.name }))}
            teamId={teamId}
            focusRun={focusRunId}
            viewAll={viewAll}
          />
        </Suspense>
        {matchedRunCount === 0 ? (
          <CardPanel className="text-sm text-muted-foreground">
            {filtersActive ? (
              <>No runs match these filters.</>
            ) : teamMode ? (
              <>No runs from team members yet.</>
            ) : (
              <>
                No runs yet. <Link href="/runs/new" className="text-accent underline">Create your first run</Link>.
              </>
            )}
          </CardPanel>
        ) : filters.layout === "flat" ? (
          <div className="space-y-2">
            {renderFlatRunList()}
            <RunHistoryViewMore
              viewAll={viewAll}
              hasMoreRuns={hasMoreRuns}
              totalRunCount={totalRunCount}
              loadedRunCount={dbMatchedCount}
              teamId={teamId}
              focusRun={focusRunId}
              filterQuery={filterQuery}
            />
          </div>
        ) : (
          <div className="space-y-2">
            {/* One glass card holds every session group (approved artifact:
                sessions-redesign); groups divide with hairlines inside it. */}
            <SurfaceCard variant="panel" contentClassName="p-0" className="min-w-0 max-w-full">
              {viewAll ? (
                groups.map((group, idx) => renderSessionGroup(group, idx))
              ) : (
                <SessionGroupsPager initial={pagerInitial} step={12}>
                  {groups.map((group, idx) => renderSessionGroup(group, idx))}
                </SessionGroupsPager>
              )}
            </SurfaceCard>
            <RunHistoryViewMore
              viewAll={viewAll}
              hasMoreRuns={hasMoreRuns}
              totalRunCount={totalRunCount}
              loadedRunCount={dbMatchedCount}
              teamId={teamId}
              focusRun={focusRunId}
              filterQuery={filterQuery}
            />
          </div>
        )}
      </section>
    </>
  );
}
