import "server-only";
import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import { formatRelativeFromNow } from "@/lib/formatRelative";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";
import {
  sortTeammatesByLastOut,
  TEAMMATE_LIVE_WINDOW_MS,
  type TeammateLastOut,
} from "@/lib/analysis/analysisHomeModel";

/**
 * The **Last out** band — every teammate you have, ordered by how recently they last ran.
 *
 * Built 2026-08-20 on founder instruction: *"the list below should be expansive, every teammate
 * you have."* It is the deliberate opposite of the meeting half above it (`loadOutWithYou`),
 * which is scoped by co-presence and therefore includes strangers and excludes teammates who
 * stayed home. This one reads `TeamMembership` and nothing else: your team, wherever they were,
 * however long ago.
 *
 * ── Why it does not sort by lap time ─────────────────────────────────────────────────────────
 * Because the times are not comparable. This band spans every track a teammate has ever run, so
 * ranking it on pace would sort a wet Tuesday at one circuit against a dry Sunday at another and
 * present the result as a standing. Recency IS comparable — everyone's "when" is measured on the
 * same clock — so that is the axis, and each row prints its own track next to its own lap so the
 * number can never be read as a league position. The pace comparison already has a home: it is
 * the half of the card directly above this one, where everybody was at the same place on the
 * same day.
 *
 * ── What it may show ─────────────────────────────────────────────────────────────────────────
 * The same filter every other team surface uses — `shareWithTeam` + `loggingComplete`, exactly as
 * `loadTeamFeed` does. A teammate who hid a run is not "last out" on it, so an unshared run is
 * invisible here even to a teammate, and the band may quote an older run as their most recent.
 * That is correct: the alternative leaks the existence and timing of a run its owner hid.
 *
 * ── Names ────────────────────────────────────────────────────────────────────────────────────
 * The roster resolver (`loadTeamMemberDisplays`) — the opposite call from the meeting half, and
 * for a reason. That resolver falls back to the email address, which is unacceptable for a
 * stranger at the same track and is fine for someone you accepted a mutual team membership with;
 * it is already what the team roster and feed print, and two names for one person across three
 * surfaces is worse than an email on one of them. The viewer's own row is dropped rather than
 * labelled — a band called "every teammate you have" does not include you.
 */

/**
 * Teammates read. Well past any real squad (the biggest team on prod is single digits); it exists
 * so one pathological membership set cannot turn this into an unbounded `OR`. Oldest membership
 * first, so which teammates survive the cap is stable rather than arbitrary.
 */
const MAX_TEAMMATES = 200;

export async function loadTeammatesLastOut(
  userId: string,
  now: Date = new Date()
): Promise<TeammateLastOut[]> {
  return perfSpan("analysisTeammatesLastOut", async () => {
    const myTeams = await prisma.teamMembership.findMany({
      where: { userId },
      select: { teamId: true },
    });
    if (myTeams.length === 0) return [];

    /*
     * Every membership in every team of yours, oldest first — so a teammate you share two teams
     * with resolves to the one you have both been in longest. Same rule as the meeting half's
     * `sharedTeamId`, and it has to be, or the same person's row would open a different team's
     * Sessions view depending on which half of the card you tapped.
     */
    const memberships = await prisma.teamMembership.findMany({
      where: { teamId: { in: myTeams.map((t) => t.teamId) }, userId: { not: userId } },
      select: { userId: true, teamId: true },
      orderBy: { joinedAt: "asc" },
    });

    const teamByUserId = new Map<string, string>();
    for (const row of memberships) {
      if (teamByUserId.size >= MAX_TEAMMATES) break;
      if (!teamByUserId.has(row.userId)) teamByUserId.set(row.userId, row.teamId);
    }
    const teammateIds = [...teamByUserId.keys()];
    if (teammateIds.length === 0) return [];

    const sharedRunFilter = {
      userId: { in: teammateIds },
      shareWithTeam: true,
      loggingComplete: true,
    } as const;

    /*
     * Their last shared run, in two steps rather than one.
     *
     * A single "newest N runs across every teammate" query cannot do this: one teammate who
     * logged forty runs on Sunday would fill the take and push half the squad off the band. The
     * `groupBy` asks the database for each teammate's own maximum instead — one row per person,
     * whatever their volume — and the second query fetches exactly those runs back.
     */
    const [latest, displays] = await Promise.all([
      prisma.run.groupBy({
        by: ["userId"],
        where: sharedRunFilter,
        _max: { sortAt: true },
      }),
      loadTeamMemberDisplays(teammateIds, userId),
    ]);

    const latestPairs = latest
      .filter((row): row is typeof row & { _max: { sortAt: Date } } => row._max.sortAt != null)
      .map((row) => ({ userId: row.userId, sortAt: row._max.sortAt as Date }));

    const runs =
      latestPairs.length === 0
        ? []
        : await prisma.run.findMany({
            where: { ...sharedRunFilter, OR: latestPairs },
            select: {
              userId: true,
              sortAt: true,
              bestLapSeconds: true,
              track: { select: { name: true } },
            },
            orderBy: { sortAt: "desc" },
          });

    // Two runs can carry the same `sortAt` for one driver — it is stamped once at create, and a
    // bulk import writes a whole session in one go. Newest-first above, so the first wins.
    const runByUserId = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      if (!runByUserId.has(run.userId)) runByUserId.set(run.userId, run);
    }

    const rows: TeammateLastOut[] = [];
    for (const [teammateId, teamId] of teamByUserId) {
      const run = runByUserId.get(teammateId) ?? null;
      const name = displays.get(teammateId)?.name?.trim();
      // The resolver falls back all the way to a short id, so this is belt and braces — but a
      // blank row on a card about people is worth one guard.
      if (!name) continue;
      rows.push({
        userId: teammateId,
        name,
        teamId,
        lastRunAtIso: run ? run.sortAt.toISOString() : null,
        lastRunLabel: run ? formatRelativeFromNow(run.sortAt, now) : "No shared runs",
        bestLapSeconds: run?.bestLapSeconds ?? null,
        trackName: run?.track?.name ?? null,
        isLive: run ? now.getTime() - run.sortAt.getTime() < TEAMMATE_LIVE_WINDOW_MS : false,
      });
    }

    return sortTeammatesByLastOut(rows);
  });
}
