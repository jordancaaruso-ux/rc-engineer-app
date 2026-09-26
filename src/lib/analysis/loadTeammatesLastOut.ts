import "server-only";
import { prisma } from "@/lib/prisma";
import { perfSpan } from "@/lib/perfLog";
import { calendarYmdInTimeZone } from "@/lib/formatDate";
import { formatRelativeFromNow } from "@/lib/formatRelative";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";
import { resolveRunLocalTimeZone, runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";
import {
  sortTeammatesByLastOut,
  TEAMMATE_LIVE_WINDOW_MS,
  type TeammateLastOut,
} from "@/lib/analysis/analysisHomeModel";

/**
 * The **Your teammates** card — every teammate you have, the teammates out with you today first.
 *
 * Built 2026-08-20 on founder instruction: *"the list below should be expansive, every teammate
 * you have."* It reads `TeamMembership` and nothing else: your team, wherever they were, however
 * long ago.
 *
 * ── The only cross-driver read on the page, since 2026-09-14 ─────────────────────────────────
 * Until then an "Out with you" card sat above this one and listed whoever had logged a run at
 * the same track on the same day — teammate or not — with their name and best lap. A driver saw
 * a stranger's lap on his screen and the founder ruled: *"nobody outside my team ever sees
 * anything I logged."* That card and its loader are deleted. This card took over the one part
 * of its job that survives the rule, as an ORDER rather than a second scope: teammates out with
 * you today, then teammates out today somewhere else, then everyone else newest first.
 *
 * ── "With you" ───────────────────────────────────────────────────────────────────────────────
 * The app cannot see where you are; the only thing it knows is where you last logged a run. So
 * "the track you are at" is the track of your most recent run, and only if that run is today in
 * your own local day. Three days after a club round you are not "at" that club, and a teammate
 * testing there on a Tuesday must not jump to the top of your list while you are at work — on a
 * day with no run of yours, nobody is "with you" and the first tier is simply empty.
 *
 * ── "Today", not the 20-minute pip ───────────────────────────────────────────────────────────
 * A heat at a club round is every 45–60 minutes, so a teammate who ran the heat before yours is
 * out with you today even though the pip on their row has gone out. "Logging now" for the
 * ordering is therefore the local calendar day, resolved in the run's own zone, exactly as the
 * Sessions list decides which day a run belongs to. The pip keeps its 20 minutes: it says who is
 * on track this minute, and that is a different question.
 *
 * ── Why it does not sort by lap time ─────────────────────────────────────────────────────────
 * Because the times are not comparable. The card spans every track a teammate has ever run, so
 * ranking it on pace would sort a wet Tuesday at one circuit against a dry Sunday at another and
 * present the result as a standing. Recency IS comparable — everyone's "when" is measured on the
 * same clock — so that is the axis inside each tier, and each row prints its own track next to
 * its own lap so the number can never be read as a league position.
 *
 * ── What it may show ─────────────────────────────────────────────────────────────────────────
 * The same filter every other team surface uses — `shareWithTeam` + `loggingComplete`, exactly as
 * `loadTeamFeed` does. A teammate who hid a run is not "last out" on it, so an unshared run is
 * invisible here even to a teammate, and the card may quote an older run as their most recent.
 * That is correct: the alternative leaks the existence and timing of a run its owner hid.
 *
 * ── Names ────────────────────────────────────────────────────────────────────────────────────
 * The roster resolver (`loadTeamMemberDisplays`). It falls back to the email address and then a
 * short id, which is acceptable for someone you accepted a mutual team membership with — it is
 * already what the team roster and feed print, and two names for one person across three
 * surfaces is worse than an email on one of them. The viewer's own row is dropped rather than
 * labelled — a card called "every teammate you have" does not include you.
 */

/**
 * Teammates read. Well past any real squad (the biggest team on prod is single digits); it exists
 * so one pathological membership set cannot turn this into an unbounded `OR`. Oldest membership
 * first, so which teammates survive the cap is stable rather than arbitrary.
 */
const MAX_TEAMMATES = 200;

export async function loadTeammatesLastOut(
  userId: string,
  timeZone: string,
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
     * with resolves to the one you have both been in longest, and the same person's row opens
     * the same team's Sessions view on every load.
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
     * Was a run today, where it was logged? Resolved in the run's own zone (falling back to the
     * viewer's), so a teammate on the far side of a zone boundary is still judged on THEIR day.
     */
    const zones = { viewerTimeZone: timeZone };
    const runWasToday = (run: {
      createdAt: Date;
      sortAt: Date | null;
      localTimeZone: string | null;
      userId: string;
    }): boolean => {
      const zone = resolveRunLocalTimeZone(run, zones) ?? timeZone;
      return runLocalDayKey(run, zones) === calendarYmdInTimeZone(now, zone);
    };

    /*
     * Their last shared run, in two steps rather than one.
     *
     * A single "newest N runs across every teammate" query cannot do this: one teammate who
     * logged forty runs on Sunday would fill the take and push half the squad off the card. The
     * `groupBy` asks the database for each teammate's own maximum instead — one row per person,
     * whatever their volume — and the second query fetches exactly those runs back.
     *
     * The viewer's own latest run rides the same wave. Not filtered on sharing or completeness:
     * a run you are still logging is proof you are at that track, and it is yours to see.
     */
    const [latest, displays, myLatest] = await Promise.all([
      prisma.run.groupBy({
        by: ["userId"],
        where: sharedRunFilter,
        _max: { sortAt: true },
      }),
      loadTeamMemberDisplays(teammateIds, userId),
      prisma.run.findFirst({
        where: { userId },
        orderBy: { sortAt: "desc" },
        select: {
          userId: true,
          trackId: true,
          createdAt: true,
          sortAt: true,
          localTimeZone: true,
        },
      }),
    ]);

    // The track you are at today, or null — see the header for why "today" is the condition.
    const hereTrackId =
      myLatest?.trackId && runWasToday(myLatest) ? myLatest.trackId : null;

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
              createdAt: true,
              sortAt: true,
              localTimeZone: true,
              trackId: true,
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
      const isToday = run ? runWasToday(run) : false;
      rows.push({
        userId: teammateId,
        name,
        teamId,
        lastRunAtIso: run ? run.sortAt.toISOString() : null,
        lastRunLabel: run ? formatRelativeFromNow(run.sortAt, now) : "No shared runs",
        bestLapSeconds: run?.bestLapSeconds ?? null,
        trackName: run?.track?.name ?? null,
        isLive: run ? now.getTime() - run.sortAt.getTime() < TEAMMATE_LIVE_WINDOW_MS : false,
        isToday,
        isHere: isToday && hereTrackId != null && run?.trackId === hereTrackId,
      });
    }

    return sortTeammatesByLastOut(rows);
  });
}
