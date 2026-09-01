import "server-only";
import { prisma } from "@/lib/prisma";
import { APP_SETTING_KEYS, getSettingForUsers } from "@/lib/appSettings";
import { formatRunDateOnly } from "@/lib/formatDate";
import { perfSpan } from "@/lib/perfLog";
import { isSamePlatform } from "@/lib/cars/carClasses";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";
import {
  windowAroundViewer,
  type OutWithYouDriver,
  type OutWithYouModel,
} from "@/lib/analysis/analysisHomeModel";

/**
 * The **meeting** half of the Teammates card (titled "Out with you" until 2026-08-20) — the
 * drivers who were at the same meeting, or at the same track on the same day, and the best lap of
 * their most recent run there.
 *
 * The label changed; this file did not, and the gap is deliberate. Nothing below reads
 * `TeamMembership`: the scope is co-presence, so a stranger at the same club round is a row and a
 * teammate who stayed home is not. `TeammatesCard` carries the full note. The card's LOWER half
 * is the one that means teammates literally — see `loadTeammatesLastOut`.
 *
 * ── Which meeting ────────────────────────────────────────────────────────────────────────────
 * The most recent one **that anyone else was at**, not simply your most recent one (2026-08-20,
 * founder: *"it will show the most recent event you have been at that your teammates have also
 * been at"*). Until then the anchor was your latest run full stop, and a solo Tuesday practice
 * after a Sunday club round wiped the card until the next meeting — the card went blank exactly
 * when it had the most to say, because you had just been testing on your own.
 *
 * So it now walks back through your recent scopes, newest first, and stops at the first one with
 * another driver on it. `MAX_CANDIDATE_SCOPES` bounds that walk: past about a week and a half of
 * meetings, "who was out with you" stops being a debrief and becomes history.
 *
 * ── What lets one driver see another's number ────────────────────────────────────────────────
 * The existing per-run share flag, and nothing new. Founder call (2026-08-19) after the three
 * options were put to him: *"most runs will be shared anyway, rarely will someone turn it off —
 * non issue."* So the flag that used to mean "my teams may see this run" now also means "people
 * who were out with me may see its best lap", and the run form says so in both cases — see the
 * share toggle in `NewRunForm`, which was hidden from anyone not on a team until this shipped
 * and is now shown to everyone, because it is now the only control over this.
 *
 * **The exposure is one number.** Best lap, and the driver's name. Not the setup, not the
 * conditions, not the tyre, not a link to the run. Anything richer is what a team is for, and
 * teams already work — `viewerMayAccessRun` is untouched by this file and still governs every
 * surface that shows more than a lap time.
 *
 * ── Names ────────────────────────────────────────────────────────────────────────────────────
 * "My name" from Settings, then the LiveRC driver name, then the account name, then the driver is
 * **skipped**. Deliberately NOT the team roster's resolver (`loadTeamMemberDisplays`), which falls
 * back to the email address and then the user id: those are fine for a roster you consented to
 * join and are not fine for a stranger at the same track. A driver who has never told the app who
 * they are does not get a row — a label the app invented, attached to a real person's lap time on
 * someone else's screen, is worse than one fewer row.
 */

/** Runs scanned in scope. A big club meeting is a few hundred rows across every driver. */
const SCOPE_TAKE = 400;
/** Query window for the day fallback; the exact day is settled in the driver's own zone below. */
const DAY_WINDOW_MS = 36 * 60 * 60 * 1000;
/**
 * How many of your own recent runs are read to find the candidate meetings. Two jobs: it bounds
 * the walk-back, and it is also the pool the viewer's own best lap in the winning scope comes
 * from — so it has to comfortably cover a full weekend of your runs, not just enough to name the
 * meetings.
 */
const ANCHOR_RUN_TAKE = 200;
/** Meetings walked back through before giving up. Roughly a fortnight of club racing. */
const MAX_CANDIDATE_SCOPES = 8;

const scopeRunSelect = {
  id: true,
  userId: true,
  createdAt: true,
  sortAt: true,
  localTimeZone: true,
  bestLapSeconds: true,
  // Both ids on every row, peer rows included. One query now covers several candidate meetings,
  // so the rows have to be split back apart in JS — and a row cannot say which meeting it came
  // from unless it carries the ids the query matched on.
  eventId: true,
  trackId: true,
  car: {
    select: {
      carClass: true,
      setupSheetTemplate: true,
      setupSheetModel: { select: { slug: true, discipline: true } },
    },
  },
} as const;

const anchorRunSelect = {
  ...scopeRunSelect,
  event: { select: { name: true } },
  track: { select: { name: true } },
} as const;

type ScopeRun = {
  id: string;
  userId: string;
  createdAt: Date;
  sortAt: Date;
  localTimeZone: string | null;
  bestLapSeconds: number | null;
  eventId: string | null;
  trackId: string | null;
  car: {
    carClass: string | null;
    setupSheetTemplate: string | null;
    setupSheetModel: { slug: string } | null;
  } | null;
};

type AnchorRun = ScopeRun & {
  event: { name: string } | null;
  track: { name: string } | null;
};

/** One meeting the card could be about: an event, or a track on a given local day. */
type CandidateScope = {
  anchor: AnchorRun;
  /** Set only for the day fallback; an event scope is settled by id alone. */
  dayKey: string | null;
};

export async function loadOutWithYou(
  userId: string,
  timeZone: string
): Promise<OutWithYouModel | null> {
  const myRecent: AnchorRun[] = await perfSpan("analysisOutWithYouMine", () =>
    prisma.run.findMany({
      where: {
        userId,
        OR: [{ eventId: { not: null } }, { trackId: { not: null } }],
        // No timed lap, no place on this card — for you as much as for anyone else, since your
        // own best is the anchor every delta is measured from.
        bestLapSeconds: { not: null },
      },
      orderBy: { sortAt: "desc" },
      take: ANCHOR_RUN_TAKE,
      select: anchorRunSelect,
    })
  );
  if (myRecent.length === 0) return null;

  /*
   * Two shapes of scope, and the card tells them apart because they are not equally trustworthy.
   * An event is exact: everyone on it entered the same meeting. Same-track-same-day is a guess —
   * one venue can run a club practice in the morning and a race in the evening.
   */
  const candidates: CandidateScope[] = [];
  const seenScopeKeys = new Set<string>();
  for (const run of myRecent) {
    const dayKey = run.eventId ? null : runLocalDayKey(run, { viewerTimeZone: timeZone });
    const key = run.eventId ? `event:${run.eventId}` : `day:${run.trackId}:${dayKey}`;
    if (seenScopeKeys.has(key)) continue;
    seenScopeKeys.add(key);
    candidates.push({ anchor: run, dayKey });
    if (candidates.length >= MAX_CANDIDATE_SCOPES) break;
  }

  const eventIds = candidates.map((c) => c.anchor.eventId).filter((id): id is string => !!id);
  const dayCandidates = candidates.filter((c) => !c.anchor.eventId);
  const trackIds = [
    ...new Set(dayCandidates.map((c) => c.anchor.trackId).filter((id): id is string => !!id)),
  ];

  const scopeOr: object[] = [];
  if (eventIds.length > 0) scopeOr.push({ eventId: { in: eventIds } });
  if (trackIds.length > 0) {
    // One range spanning every day candidate; the exact day is settled per run below, in that
    // run's own zone, so a driver logging near midnight doesn't fall out of their own day.
    const times = dayCandidates.map((c) => c.anchor.sortAt.getTime());
    scopeOr.push({
      trackId: { in: trackIds },
      sortAt: {
        gte: new Date(Math.min(...times) - DAY_WINDOW_MS),
        lte: new Date(Math.max(...times) + DAY_WINDOW_MS),
      },
    });
  }
  if (scopeOr.length === 0) return null;

  /*
   * One query covering every candidate, newest first. That order is what makes a single `take`
   * safe across several scopes: the newest meeting's rows are read first, and the newest meeting
   * with anyone on it is the one that wins, so a busy recent weekend can only ever crowd out
   * scopes that had already lost.
   */
  const peerRows: ScopeRun[] = await perfSpan("analysisOutWithYou", () =>
    prisma.run.findMany({
      where: {
        OR: scopeOr,
        userId: { not: userId },
        // The consent. One flag, and it is absolute here exactly as it is on every team surface.
        shareWithTeam: true,
        // A run still being logged is not a result yet. Not applied to the viewer's own rows —
        // their half-finished run is theirs to see.
        loggingComplete: true,
        bestLapSeconds: { not: null },
      },
      orderBy: { sortAt: "desc" },
      take: SCOPE_TAKE,
      select: scopeRunSelect,
    })
  );

  for (const candidate of candidates) {
    /*
     * Same discipline only. A buggy time in a touring list is a card nobody trusts twice, and the
     * app already resolves a car's discipline from its chassis for the teammate lap-compare —
     * reusing that keeps one answer to "are these two comparable". `isSamePlatform` is permissive
     * when either side is unknown, which is the same call the run page makes.
     */
    const anchorDiscipline = disciplineForCar(candidate.anchor.car);

    /*
     * One predicate for both sides, and it re-tests the scope rather than trusting the query.
     * The query now covers up to eight candidate meetings at once, so a row in `peerRows` may
     * belong to any of them — an event row and a day row can even be the same row, when a driver
     * ran your track on your day as part of their own event. Splitting on the ids the query
     * matched on is what keeps each candidate's rows its own.
     */
    const inScope = (run: ScopeRun): boolean => {
      if (!isSamePlatform(anchorDiscipline, disciplineForCar(run.car))) return false;
      if (candidate.anchor.eventId) return run.eventId === candidate.anchor.eventId;
      if (run.trackId !== candidate.anchor.trackId) return false;
      // The query window above is deliberately wide; this is what actually decides the day,
      // resolved in each run's OWN zone so a driver logging near midnight doesn't fall out of it.
      return runLocalDayKey(run, { viewerTimeZone: timeZone }) === candidate.dayKey;
    };

    const mine = myRecent.filter(inScope);
    if (mine.length === 0) continue;

    const model = await buildScopeModel({
      userId,
      timeZone,
      anchor: candidate.anchor,
      mine,
      peers: peerRows.filter(inScope),
      candidateIsEvent: Boolean(candidate.anchor.eventId),
    });
    if (model) return model;
  }

  return null;
}

/**
 * Turn one resolved scope into the card model, or null when it cannot carry a card.
 *
 * Split out from the walk above so the "is there anybody here" test and the name resolution
 * happen once, on the winning scope only — resolving display names for every candidate would be
 * seven wasted round trips on the common case where the newest meeting already has people on it.
 */
async function buildScopeModel({
  userId,
  timeZone,
  anchor,
  mine,
  peers,
  candidateIsEvent,
}: {
  userId: string;
  timeZone: string;
  anchor: AnchorRun;
  mine: ScopeRun[];
  peers: ScopeRun[];
  candidateIsEvent: boolean;
}): Promise<OutWithYouModel | null> {
  if (peers.length === 0) return null;

  /*
   * One row per driver: their most recent run in scope, which is what "their last run" means.
   * `peers` is already newest-first, so the first sighting of a user id is the one to keep.
   */
  const latestByUser = new Map<string, ScopeRun>();
  for (const run of peers) {
    if (!latestByUser.has(run.userId)) latestByUser.set(run.userId, run);
  }

  const peerIds = [...latestByUser.keys()];
  const [myNames, timingNames, accounts, sharedMemberships] = await Promise.all([
    getSettingForUsers(peerIds, APP_SETTING_KEYS.myName),
    getSettingForUsers(peerIds, APP_SETTING_KEYS.liveRcDriverName),
    prisma.user.findMany({ where: { id: { in: peerIds } }, select: { id: true, name: true } }),
    /*
     * Teams the viewer shares with each of these drivers — the only thing that makes a row in
     * THIS half a door (2026-08-20). One query, not two: `team.memberships.some({ userId })` does
     * the intersection in the database rather than fetching the viewer's teams and filtering in
     * JS, and it rides this wave so it costs no extra round trip.
     *
     * Oldest membership first, so a driver in two of your teams resolves to the team you have
     * both been in longest — stable across page loads, which a `findFirst` with no order is not.
     */
    prisma.teamMembership.findMany({
      where: { userId: { in: peerIds }, team: { memberships: { some: { userId } } } },
      select: { userId: true, teamId: true },
      orderBy: { joinedAt: "asc" },
    }),
  ]);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const sharedTeamByUserId = new Map<string, string>();
  for (const row of sharedMemberships) {
    if (!sharedTeamByUserId.has(row.userId)) sharedTeamByUserId.set(row.userId, row.teamId);
  }

  // Your own best in scope — the anchor every delta is measured against.
  const myBest = Math.min(...mine.map((run) => run.bestLapSeconds!));

  const rows: OutWithYouDriver[] = [
    {
      userId,
      name: "You",
      isViewer: true,
      bestLapSeconds: myBest,
      deltaSeconds: null,
      sharedTeamId: null,
    },
  ];
  for (const [peerId, run] of latestByUser) {
    const name =
      myNames[peerId]?.trim() ||
      timingNames[peerId]?.trim() ||
      accountNameById.get(peerId)?.trim() ||
      null;
    // No name, no row. See the header — never an email, never an id.
    if (!name) continue;
    rows.push({
      userId: peerId,
      name,
      isViewer: false,
      bestLapSeconds: run.bestLapSeconds!,
      // `theirs − yours`: positive = slower than you, the app-wide convention.
      deltaSeconds: run.bestLapSeconds! - myBest,
      sharedTeamId: sharedTeamByUserId.get(peerId) ?? null,
    });
  }
  if (rows.length < 2) return null;

  rows.sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);

  return {
    scopeLabel: candidateIsEvent
      ? anchor.event?.name ?? "This meeting"
      : [anchor.track?.name, formatRunDateOnly(anchor.sortAt, timeZone)]
          .filter(Boolean)
          .join(" · "),
    isEvent: candidateIsEvent,
    drivers: windowAroundViewer(rows),
    driverCount: rows.length,
  };
}
