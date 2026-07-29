import "server-only";
import { prisma } from "@/lib/prisma";
import { listTeamMemberUserIds } from "@/lib/teamAccess";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  buildFeedEntry,
  pickPreviousComparableRun,
  type AlsoMovedRow,
  type SetupChangeRow,
  type TeamFeedRunInput,
} from "@/lib/teams/teamFeedModel";
import { loadTeamMemberDisplays, type TeamMemberDisplay } from "@/lib/teams/teamMemberDisplay";

/** One page of the feed. Small on purpose — this is a glanceable surface, not an archive. */
export const TEAM_FEED_PAGE_SIZE = 20;

/**
 * How far back to look for a baseline beyond the oldest run on the page. The baseline rule
 * only ever reaches within the same meeting or the same calendar day, so three days of slack
 * covers every time zone and every long weekend meeting without an open-ended scan.
 */
const BASELINE_LOOKBACK_DAYS = 3;

/** Hard ceiling on the baseline-context query so a busy race weekend can't blow up the page. */
const BASELINE_CONTEXT_TAKE = 400;

export type TeamFeedComment = {
  id: string;
  authorUserId: string;
  authorLabel: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  parentId: string | null;
  viewerCanEdit: boolean;
  viewerCanDelete: boolean;
};

export type TeamFeedEntryView = {
  runId: string;
  ownerUserId: string;
  ownerLabel: string;
  isViewer: boolean;

  sessionLabel: string;
  carName: string | null;
  trackName: string | null;
  eventName: string | null;
  raceClass: string | null;

  /** When the session happened. */
  occurredAt: string;
  /** When the run was saved. Diverges from `occurredAt` when someone logs hours later. */
  loggedAt: string;

  bestLapSeconds: number | null;
  paceDeltaSeconds: number | null;
  baselineRunId: string | null;

  changed: SetupChangeRow[];
  changedOverflow: number;
  alsoMoved: AlsoMovedRow[];
  alsoMovedOverflow: number;

  comments: TeamFeedComment[];
};

export type TeamFeedModel = {
  teamId: string;
  teamName: string;
  viewerUserId: string;
  viewerIsAdmin: boolean;
  members: TeamMemberDisplay[];
  /** Last activity per member, for the roster staleness strip. Null = nothing shared yet. */
  lastActivityByUserId: Record<string, string | null>;
  entries: TeamFeedEntryView[];
  /** Opaque `sortAt|id` cursor for "Load older". Null when the feed is exhausted. */
  nextCursor: string | null;
  /** A run deep-linked from a push notification, surfaced outside the paged list. */
  pinnedEntry: TeamFeedEntryView | null;
};

const runSelect = {
  id: true,
  userId: true,
  carId: true,
  trackId: true,
  eventId: true,
  sortAt: true,
  createdAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  shareWithTeam: true,
  loggingComplete: true,
  bestLapSeconds: true,
  setupSnapshotId: true,
  raceClass: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  conditionsAirTempC: true,
  conditionsTrackTempC: true,
  tireStintId: true,
  tireTypeId: true,
  tireRunNumber: true,
  tireAgeKnown: true,
  trackLayoutId: true,
  trackDirection: true,
  car: { select: { name: true } },
  track: { select: { name: true } },
  event: { select: { name: true } },
  tireType: { select: { displayName: true } },
} as const;

type RunRow = Awaited<ReturnType<typeof fetchRunRows>>[number];

async function fetchRunRows(args: Parameters<typeof prisma.run.findMany>[0]) {
  return prisma.run.findMany({ ...args, select: runSelect });
}

/** When the session actually happened, falling back through the columns that may be null. */
function occurredAtOf(run: {
  sessionCompletedAt: Date | null;
  loggingCompletedAt: Date | null;
  createdAt: Date;
}): Date {
  return run.sessionCompletedAt ?? run.loggingCompletedAt ?? run.createdAt;
}

function toFeedInput(run: RunRow, setupData: unknown): TeamFeedRunInput {
  return {
    id: run.id,
    userId: run.userId,
    carId: run.carId,
    trackId: run.trackId,
    eventId: run.eventId,
    sortAt: run.sortAt.toISOString(),
    occurredAt: occurredAtOf(run).toISOString(),
    shareWithTeam: run.shareWithTeam !== false,
    loggingComplete: run.loggingComplete,
    bestLapSeconds: run.bestLapSeconds,
    setupData,
    conditionsAirTempC: run.conditionsAirTempC,
    conditionsTrackTempC: run.conditionsTrackTempC,
    tireStintId: run.tireStintId,
    tireTypeId: run.tireTypeId,
    tireTypeLabel: run.tireType?.displayName ?? null,
    tireRunNumber: run.tireRunNumber,
    tireAgeKnown: run.tireAgeKnown,
    trackLayoutId: run.trackLayoutId,
    trackDirection: run.trackDirection ?? null,
  };
}

export function encodeFeedCursor(run: { sortAt: Date; id: string }): string {
  return `${run.sortAt.toISOString()}|${run.id}`;
}

/** Keyset cursor — stable while people keep logging, unlike an offset. */
function decodeFeedCursor(cursor: string | null | undefined): { sortAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  if (!iso || !id) return null;
  const sortAt = new Date(iso);
  if (Number.isNaN(sortAt.getTime())) return null;
  return { sortAt, id };
}

export type LoadTeamFeedParams = {
  viewerId: string;
  teamId: string;
  timeZone: string;
  cursor?: string | null;
  /** Run id from a notification deep link (`?run=`). Returned separately from the page. */
  pinnedRunId?: string | null;
};

/**
 * Load one page of a team's delta feed.
 *
 * Returns `null` when the viewer is not in the team — callers must treat that as 404, never
 * as an empty feed. The membership check returns rather than throwing, so it has to be
 * checked, not awaited and forgotten.
 */
export async function loadTeamFeedModel(params: LoadTeamFeedParams): Promise<TeamFeedModel | null> {
  const { viewerId, teamId, timeZone } = params;

  const team = await prisma.team.findFirst({
    where: { id: teamId },
    select: { id: true, name: true, memberships: { select: { userId: true, role: true } } },
  });
  if (!team) return null;

  const memberIds = team.memberships.map((m) => m.userId);
  const viewerIsAdmin = team.memberships.some((m) => m.userId === viewerId && m.role === "admin");

  /*
   * Membership is derived from the row above rather than asked for separately.
   * `assertUserInTeam` is exactly a `teamMembership.findFirst` on (teamId, userId), and
   * this query already selects that team's memberships — so the answer was arriving one
   * round trip later anyway. Non-members still get null, which the page turns into a 404
   * so team existence is never confirmed to an outsider. Unchanged behaviour, one query
   * fewer, and the gate now sits above every read below it.
   */
  if (!memberIds.includes(viewerId)) return null;

  // Only runs the owner chose to share, and never half-logged drafts — a draft has no laps
  // and an unfinished setup, so it would render as a pace-less entry with a huge diff.
  const sharedRunFilter = {
    userId: { in: memberIds },
    shareWithTeam: true,
    loggingComplete: true,
  } as const;

  const cursor = decodeFeedCursor(params.cursor);

  /*
   * One wave. Member displays, the feed page, the pinned run, and last-activity all need
   * nothing but `memberIds`, yet each used to wait for the one before it. This route was
   * the slowest soft-navigation in the app at 569ms p75, roughly six times every other
   * route, and this chain is why.
   */
  const [displays, pageRows, pinnedRow, lastActivityByUserId] = await Promise.all([
    loadTeamMemberDisplays(memberIds, viewerId),
    fetchRunRows({
      where: {
        ...sharedRunFilter,
        ...(cursor
          ? {
              OR: [
                { sortAt: { lt: cursor.sortAt } },
                { sortAt: cursor.sortAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortAt: "desc" }, { id: "desc" }],
      take: TEAM_FEED_PAGE_SIZE + 1,
    }),
    params.pinnedRunId
      ? fetchRunRows({
          where: { ...sharedRunFilter, id: params.pinnedRunId },
          take: 1,
        }).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    loadLastActivityByUser(memberIds),
  ]);

  const hasMore = pageRows.length > TEAM_FEED_PAGE_SIZE;
  const pageRuns = hasMore ? pageRows.slice(0, TEAM_FEED_PAGE_SIZE) : pageRows;

  const focusRuns = pinnedRow && !pageRuns.some((r) => r.id === pinnedRow.id)
    ? [...pageRuns, pinnedRow]
    : pageRuns;

  const entriesByRunId = focusRuns.length
    ? await buildEntriesForRuns({ focusRuns, memberIds, sharedRunFilter, timeZone, displays, viewerId, teamId, viewerIsAdmin })
    : new Map<string, TeamFeedEntryView>();

  const oldest = pageRuns[pageRuns.length - 1];

  return {
    teamId: team.id,
    teamName: team.name,
    viewerUserId: viewerId,
    viewerIsAdmin,
    members: [...displays.values()],
    lastActivityByUserId,
    entries: pageRuns.map((r) => entriesByRunId.get(r.id)!).filter(Boolean),
    nextCursor: hasMore && oldest ? encodeFeedCursor(oldest) : null,
    pinnedEntry: pinnedRow ? entriesByRunId.get(pinnedRow.id) ?? null : null,
  };
}

async function buildEntriesForRuns(args: {
  focusRuns: RunRow[];
  memberIds: string[];
  sharedRunFilter: { userId: { in: string[] }; shareWithTeam: true; loggingComplete: true };
  timeZone: string;
  displays: ReadonlyMap<string, TeamMemberDisplay>;
  viewerId: string;
  teamId: string;
  viewerIsAdmin: boolean;
}): Promise<Map<string, TeamFeedEntryView>> {
  const { focusRuns, sharedRunFilter, timeZone, displays, viewerId, teamId, viewerIsAdmin } = args;

  // Baseline candidates: the same members' runs within a few days of the oldest entry on the
  // page, plus everything from the meetings on this page (a meeting can span several days).
  const oldestOccurred = focusRuns.reduce<Date>(
    (min, r) => (occurredAtOf(r) < min ? occurredAtOf(r) : min),
    occurredAtOf(focusRuns[0])
  );
  const lookbackFrom = new Date(oldestOccurred.getTime() - BASELINE_LOOKBACK_DAYS * 86_400_000);
  const newestSortAt = focusRuns.reduce<Date>(
    (max, r) => (r.sortAt > max ? r.sortAt : max),
    focusRuns[0].sortAt
  );
  const eventIds = [...new Set(focusRuns.map((r) => r.eventId).filter((id): id is string => !!id))];

  const contextRows = await fetchRunRows({
    where: {
      ...sharedRunFilter,
      id: { notIn: focusRuns.map((r) => r.id) },
      OR: [
        { sortAt: { gte: lookbackFrom, lte: newestSortAt } },
        ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
      ],
    },
    orderBy: [{ sortAt: "desc" }, { id: "desc" }],
    take: BASELINE_CONTEXT_TAKE,
  });

  const byId = new Map<string, RunRow>();
  for (const row of [...focusRuns, ...contextRows]) byId.set(row.id, row);
  const combinedRows = [...byId.values()].sort(
    (a, b) => b.sortAt.getTime() - a.sortAt.getTime() || (a.id < b.id ? 1 : -1)
  );

  // First pass without setup data — baseline selection never looks at the setup blob, so we
  // only have to load snapshots for the runs actually being diffed.
  const dryInputs = combinedRows.map((r) => toFeedInput(r, null));
  const indexById = new Map(dryInputs.map((input, i) => [input.id, i]));

  const neededSnapshotIds = new Set<string>();
  for (const run of focusRuns) {
    if (run.setupSnapshotId) neededSnapshotIds.add(run.setupSnapshotId);
    const idx = indexById.get(run.id);
    if (idx == null) continue;
    const baseline = pickPreviousComparableRun(dryInputs, idx, timeZone);
    const baselineRow = baseline ? byId.get(baseline.id) : null;
    if (baselineRow?.setupSnapshotId) neededSnapshotIds.add(baselineRow.setupSnapshotId);
  }

  const snapshots = neededSnapshotIds.size
    ? await prisma.setupSnapshot.findMany({
        where: { id: { in: [...neededSnapshotIds] } },
        select: { id: true, data: true },
      })
    : [];
  const dataBySnapshotId = new Map(snapshots.map((s) => [s.id, s.data]));

  const hydrated = combinedRows.map((r) =>
    toFeedInput(r, r.setupSnapshotId ? dataBySnapshotId.get(r.setupSnapshotId) ?? null : null)
  );

  const commentsByRunId = await loadCommentsForRuns({
    teamId,
    runIds: focusRuns.map((r) => r.id),
    viewerId,
    viewerIsAdmin,
    displays,
  });

  const out = new Map<string, TeamFeedEntryView>();
  for (const run of focusRuns) {
    const idx = indexById.get(run.id);
    if (idx == null) continue;
    const entry = buildFeedEntry(hydrated, idx, timeZone);
    const display = displays.get(run.userId);
    out.set(run.id, {
      runId: run.id,
      ownerUserId: run.userId,
      ownerLabel: display?.label ?? "Teammate",
      isViewer: run.userId === viewerId,
      sessionLabel: formatRunSessionDisplay(
        {
          sessionType: run.sessionType,
          meetingSessionType: run.meetingSessionType,
          meetingSessionCode: run.meetingSessionCode,
          sessionLabel: run.sessionLabel,
        },
        { fallback: "Run" }
      ),
      carName: run.car?.name ?? null,
      trackName: run.track?.name ?? null,
      eventName: run.event?.name ?? null,
      raceClass: run.raceClass ?? null,
      occurredAt: occurredAtOf(run).toISOString(),
      loggedAt: (run.loggingCompletedAt ?? run.createdAt).toISOString(),
      bestLapSeconds: entry.bestLapSeconds,
      paceDeltaSeconds: entry.paceDeltaSeconds,
      baselineRunId: entry.baselineRunId,
      changed: entry.changed,
      changedOverflow: entry.changedOverflow,
      alsoMoved: entry.alsoMoved,
      alsoMovedOverflow: entry.alsoMovedOverflow,
      comments: commentsByRunId.get(run.id) ?? [],
    });
  }
  return out;
}

/** All comments for a page of runs in one query, grouped in memory. */
export async function loadCommentsForRuns(args: {
  teamId: string;
  runIds: string[];
  viewerId: string;
  viewerIsAdmin: boolean;
  displays: ReadonlyMap<string, TeamMemberDisplay>;
}): Promise<Map<string, TeamFeedComment[]>> {
  const { teamId, runIds, viewerId, viewerIsAdmin, displays } = args;
  if (runIds.length === 0) return new Map();

  const rows = await prisma.teamRunComment.findMany({
    where: { teamId, runId: { in: runIds } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      runId: true,
      authorUserId: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      parentId: true,
      author: { select: { name: true, email: true } },
    },
  });

  const byRunId = new Map<string, TeamFeedComment[]>();
  for (const row of rows) {
    const display = displays.get(row.authorUserId);
    const fallback = row.author?.name?.trim() || row.author?.email?.trim() || "Teammate";
    const isAuthor = row.authorUserId === viewerId;
    const edited = row.updatedAt.getTime() - row.createdAt.getTime() > 1000;
    const list = byRunId.get(row.runId) ?? [];
    list.push({
      id: row.id,
      authorUserId: row.authorUserId,
      authorLabel: display?.label ?? fallback,
      body: row.deletedAt ? "" : row.body,
      createdAt: row.createdAt.toISOString(),
      editedAt: edited && !row.deletedAt ? row.updatedAt.toISOString() : null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      parentId: row.parentId,
      viewerCanEdit: isAuthor && !row.deletedAt,
      viewerCanDelete: (isAuthor && !row.deletedAt) || viewerIsAdmin,
    });
    byRunId.set(row.runId, list);
  }
  return byRunId;
}

/**
 * Most recent shared run per member — the roster strip's staleness read.
 *
 * Teammates log at very different latencies, so "Kirra · 3 days ago" is as much a part of
 * reading the feed as any delta on it.
 */
async function loadLastActivityByUser(
  memberIds: string[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = Object.fromEntries(memberIds.map((id) => [id, null]));
  if (memberIds.length === 0) return out;

  const rows = await prisma.run.groupBy({
    by: ["userId"],
    where: { userId: { in: memberIds }, shareWithTeam: true, loggingComplete: true },
    _max: { sortAt: true },
  });
  for (const row of rows) {
    out[row.userId] = row._max.sortAt?.toISOString() ?? null;
  }
  return out;
}

/** Team rows for the index page, newest activity first. */
export async function listTeamsWithActivity(userId: string): Promise<
  Array<{ id: string; name: string; role: string; memberCount: number; lastActivityAt: string | null }>
> {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: {
      role: true,
      team: {
        select: { id: true, name: true, memberships: { select: { userId: true } } },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) return [];

  const rows = await Promise.all(
    memberships.map(async (m) => {
      const memberIds = m.team.memberships.map((x) => x.userId);
      const latest = await prisma.run.findFirst({
        where: { userId: { in: memberIds }, shareWithTeam: true, loggingComplete: true },
        orderBy: { sortAt: "desc" },
        select: { sortAt: true },
      });
      return {
        id: m.team.id,
        name: m.team.name,
        role: m.role,
        memberCount: memberIds.length,
        lastActivityAt: latest?.sortAt.toISOString() ?? null,
      };
    })
  );

  return rows.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}

export { listTeamMemberUserIds };
