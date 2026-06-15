import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting } from "@/lib/appSettings";
import { formatGroupDate } from "@/lib/formatDate";
import { RunHistoryTable } from "@/components/runs/RunHistoryTable";
import { SessionGroupsPager } from "@/components/runs/SessionGroupsPager";
import { RunHistoryViewMore } from "@/components/runs/RunHistoryViewMore";
import { compareRunTimestamp } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunSessionDisplay } from "@/lib/runSession";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { assertUserInTeam, listTeamMemberUserIds, listTeamsForUser } from "@/lib/teamAccess";
import type { Prisma } from "@prisma/client";

import { perfSpan } from "@/lib/perfLog";

/** Initial page size for Sessions — recent runs only; use ?viewAll=1 for full history. */
export const RUN_HISTORY_INITIAL_TAKE = 40;
/** Cap when loading full history (view all). */
export const RUN_HISTORY_VIEW_ALL_TAKE = 2000;

export const revalidate = 30;

const runHistoryInclude = {
  car: { select: { id: true, name: true, setupSheetTemplate: true, setupSheetModelId: true } },
  track: { select: { id: true, name: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
  event: { include: { track: { select: { name: true } } } },
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

function dateKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * List-ordering instant. Always reads from `sortAt` (the stable ordering axis
 * stamped once at create, mutated only by explicit user reorder). Falls back
 * to createdAt defensively for rows older than the migration that somehow
 * arrived without a sortAt value — shouldn't happen post-backfill.
 */
function runSessionSortInstant(run: RunInGroup): Date {
  const s = run.sortAt ?? run.createdAt;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(run.createdAt) : d;
}

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

type Group = {
  id: string;
  title: string;
  type: "Testing" | "Race Meeting";
  trackName: string | null;
  dateLabel: string;
  runs: RunInGroup[];
};

function buildGroups(runs: RunInGroup[]): Group[] {
  const byKey = new Map<string, RunInGroup[]>();
  for (const run of runs) {
    const key = run.eventId ? `event-${run.eventId}` : `day-${dateKey(runSessionSortInstant(run))}`;
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }
  const groups: Group[] = [];
  for (const [key, groupRuns] of byKey) {
    const run = groupRuns[0];
    const isEvent = !!run.eventId && run.event;
    const title = isEvent && run.event
      ? run.event.name
      : `Test day – ${formatGroupDate(runSessionSortInstant(run))}`;
    const type: Group["type"] = isEvent ? "Race Meeting" : "Testing";
    const trackName = isEvent && run.event
      ? (run.event.track?.name ?? run.track?.name ?? run.trackNameSnapshot ?? "—")
      : (run.track?.name ?? run.trackNameSnapshot ?? "—");
    const dateLabel = isEvent && run.event
      ? (() => {
          const start = run.event.startDate ? new Date(run.event.startDate) : runSessionSortInstant(run);
          const end = run.event.endDate ? new Date(run.event.endDate) : runSessionSortInstant(run);
          if (dateKey(start) === dateKey(end)) return formatGroupDate(start);
          return `${formatGroupDate(start)} – ${formatGroupDate(end)}`;
        })()
      : formatGroupDate(runSessionSortInstant(run));
    groups.push({
      id: key,
      title,
      type,
      trackName,
      dateLabel,
      runs: groupRuns.sort(
        (a, b) => runSessionSortInstant(b).getTime() - runSessionSortInstant(a).getTime()
      ),
    });
  }
  groups.sort((a, b) => {
    const aMax = Math.max(...a.runs.map((r) => runSessionSortInstant(r).getTime()));
    const bMax = Math.max(...b.runs.map((r) => runSessionSortInstant(r).getTime()));
    return bMax - aMax;
  });
  return groups;
}

export default async function RunHistoryPage({
  searchParams,
}: {
  // `expandLatest=1` is set when the driver completes a run from the log
  // form. Pre-opens the most recent group so the just-completed run is
  // visible without an extra click.
  // `focusRun=<runId>` opens the session group that contains the run and
  // expands that row (e.g. from dashboard "View run").
  searchParams?: Promise<{
    expandLatest?: string | string[];
    focusRun?: string | string[];
    teamId?: string | string[];
    viewAll?: string | string[];
  }>;
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
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Sessions</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view run history.
          </div>
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
  let viewAll = viewAllRequested;
  let hasMoreRuns = false;
  let teamTitle: string | null = null;
  let memberDisplayByUserId: Record<string, string> = {};
  let teamAccessDenied = false;

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
      const loaded = await loadRunHistoryPage({
        where: { userId: { in: memberIds }, shareWithTeam: true },
        viewAll: viewAllRequested,
        focusRunId: focusRunParam,
        takeWhenNotViewAll,
      });
      runs = loaded.runs;
      totalRunCount = loaded.totalRunCount;
      viewAll = loaded.viewAll;
      hasMoreRuns = loaded.hasMoreRuns;
      const members = await prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, name: true, email: true },
      });
      memberDisplayByUserId = Object.fromEntries(
        members.map((m) => {
          const base = m.name?.trim() || m.email?.trim() || m.id.slice(0, 8);
          return [m.id, m.id === user.id ? `You (${base})` : base] as const;
        })
      );
    }
  } else {
    const loaded = await loadRunHistoryPage({
      where: { userId: user.id },
      viewAll: viewAllRequested,
      focusRunId: focusRunParam,
      takeWhenNotViewAll: RUN_HISTORY_INITIAL_TAKE,
    });
    runs = loaded.runs;
    totalRunCount = loaded.totalRunCount;
    viewAll = loaded.viewAll;
    hasMoreRuns = loaded.hasMoreRuns;
  }

  const groups = buildGroups(runs);
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
  const pageSubtitle = teamAccessDenied
    ? "That team was not found or you are not a member."
    : teamMode
      ? "Runs from everyone in this team (mutual pilot). Reordering is disabled; open a member’s run read-only."
      : "";

  function renderSessionGroup(group: Group, idx: number) {
    const showSessionColumn = group.runs.some((r) => formatRunSessionDisplay(r) !== "—");
    return (
      <details
        key={group.id}
        className="rounded-xl border border-border bg-muted/70 min-w-0 max-w-full group/details"
        open={
          focusRunId
            ? group.runs.some((r) => r.id === focusRunId)
            : expandLatest && idx === 0
        }
      >
        <summary className="list-none cursor-pointer">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50 transition">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="page-title text-sm text-foreground">{group.title}</span>
              <span className="ui-title text-xs text-muted-foreground">{group.type}</span>
              {group.trackName && (
                <span className="ui-title text-xs text-muted-foreground">
                  · {group.trackName}
                </span>
              )}
              <span className="ui-title text-xs text-muted-foreground">{group.dateLabel}</span>
            </div>
            <span className="ui-title text-sm text-muted-foreground tabular-nums">
              {group.runs.length} run{group.runs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </summary>
        <div className="min-w-0 max-w-full border-t border-border bg-muted/40">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <thead>
                <tr className="border-b border-border bg-muted/70 text-left text-xs text-muted-foreground ui-title">
                  {!teamMode ? (
                    <th
                      className="hidden md:table-cell w-6 px-1 py-2"
                      aria-label="Drag to reorder"
                    />
                  ) : null}
                  {teamMode ? (
                    <th className="px-2 py-1.5 md:px-3 md:py-2 max-w-[4.5rem] md:max-w-none">
                      <span className="hidden sm:inline">Member</span>
                      <span className="sm:hidden">Who</span>
                    </th>
                  ) : null}
                  <th className="px-2 py-1.5 md:px-3 md:py-2 whitespace-nowrap">
                    Date
                  </th>
                  {showSessionColumn ? (
                    <th className="px-2 py-1.5 md:px-3 md:py-2 min-w-0">
                      Session
                    </th>
                  ) : null}
                  <th className="px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap max-md:text-[10px]">
                    Best
                  </th>
                  <th className="px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap max-md:text-[10px]">
                    <span className="md:hidden">Top 5</span>
                    <span className="hidden md:inline">Avg top 5</span>
                  </th>
                  <th className="px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap max-md:text-[10px]">
                    <span className="md:hidden">Top 10</span>
                    <span className="hidden md:inline">Avg top 10</span>
                  </th>
                  <th className="px-1.5 py-1.5 md:px-3 md:py-2 whitespace-nowrap max-md:text-[10px]">
                    Median
                  </th>
                  <th className="hidden md:table-cell px-4 py-2">Car</th>
                  <th
                    className="px-1 py-1.5 md:px-2 md:py-2 max-md:w-[26%] md:w-auto whitespace-nowrap max-md:text-[10px]"
                    aria-label="Setup and laps"
                  />
                  <th className="hidden md:table-cell px-4 py-2">Track</th>
                  <th className="hidden md:table-cell px-4 py-2">Tires</th>
                </tr>
              </thead>
              <tbody>
                <RunHistoryTable
                  runs={group.runs}
                  allRunsDescending={compareRunsDescending}
                  runListSource={teamMode ? "team_runs" : "my_runs"}
                  userDisplayName={userDisplayName}
                  displayTimeZone={displayTimeZone}
                  enableReorder={!teamMode}
                  viewerUserId={teamMode ? user.id : null}
                  memberDisplayByUserId={teamMode ? memberDisplayByUserId : undefined}
                  showMemberColumn={teamMode}
                  showSessionColumn={showSessionColumn}
                  initialExpandedRunId={
                    focusRunId && group.runs.some((r) => r.id === focusRunId)
                      ? focusRunId
                      : null
                  }
                />
              </tbody>
            </table>
          </div>
        </div>
      </details>
    );
  }

  if (teamAccessDenied) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            <p className="page-subtitle">{pageSubtitle}</p>
          </div>
        </header>
        <section className="page-body space-y-3 min-w-0 max-w-full">
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            <Link href="/runs/history" className="text-accent underline">
              Back to my sessions
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          {pageSubtitle ? <p className="page-subtitle">{pageSubtitle}</p> : null}
        </div>
      </header>
      <section className="page-body space-y-3 min-w-0 max-w-full">
        {teamsForUser.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">View:</span>
            <Link
              href="/runs/history"
              className={!teamMode ? "font-semibold text-foreground underline" : "hover:text-foreground underline-offset-2 hover:underline"}
            >
              My sessions
            </Link>
            {teamsForUser.map((t) => (
              <Link
                key={t.id}
                href={`/runs/history?teamId=${encodeURIComponent(t.id)}`}
                className={
                  teamId === t.id
                    ? "font-semibold text-foreground underline"
                    : "hover:text-foreground underline-offset-2 hover:underline"
                }
              >
                {t.name}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ButtonLink href="/runs/new" variant="primary" className="btn-brand">
            New run
          </ButtonLink>
          <span className="text-[11px] text-muted-foreground">
            {groups.length === 0
              ? "No runs yet."
              : hasMoreRuns
                ? `${runs.length} of ${totalRunCount} runs across ${groups.length} session${groups.length === 1 ? "" : "s"}`
                : `${runs.length} run${runs.length === 1 ? "" : "s"} across ${groups.length} session${groups.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {groups.length === 0 ? (
          <CardPanel className="text-sm text-muted-foreground">
            {teamMode ? (
              <>No runs from team members yet.</>
            ) : (
              <>
                No runs yet. <Link href="/runs/new" className="text-accent underline">Create your first run</Link>.
              </>
            )}
          </CardPanel>
        ) : (
          <div className="space-y-2">
            {viewAll ? (
              groups.map((group, idx) => renderSessionGroup(group, idx))
            ) : (
              <SessionGroupsPager initial={pagerInitial} step={12}>
                {groups.map((group, idx) => renderSessionGroup(group, idx))}
              </SessionGroupsPager>
            )}
            <RunHistoryViewMore
              viewAll={viewAll}
              hasMoreRuns={hasMoreRuns}
              totalRunCount={totalRunCount}
              loadedRunCount={runs.length}
              teamId={teamId}
              focusRun={focusRunId}
            />
          </div>
        )}
      </section>
    </>
  );
}
