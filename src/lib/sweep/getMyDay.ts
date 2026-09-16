import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import { resolveTrackTimeZone } from "@/lib/tracks/trackTimeZone";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { outingKindFor } from "@/lib/runs/outingSpan";
import { outingSessionFromImportedRow } from "@/lib/runs/outingsFromImportedSessions";
import {
  fileDayForUser,
  fileImportedRowsForUser,
  type FileOutcome,
  type FilingRow,
  type GatheredCandidate,
} from "@/lib/sweep/fileDay";
import { dayBoundsForYmd, splitDayCandidates } from "@/lib/sweep/getMyDayDays";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import type { SweepSource } from "@/lib/sweep/sweepDocs";

/**
 * "Get my day" (founder call 2026-09-15): the driver names a track and a day, and the app reads
 * the timing sites ONCE, for that driver, and files the day through the same code as the 8 pm
 * pass. No background scanning — one look per tap. Pressing again is safe: sessions already on a
 * run are skipped, and a session that overlaps a run joins it (`fileDay.ts`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACK_LOOKBACK_DAYS = 180;
const TRACK_LIST_MAX = 10;
/** A day's loose sessions are looked up by stored time; wall-clock sources sit up to a day off. */
const LOOSE_WINDOW_SLACK_MS = 36 * 60 * 60 * 1000;

export type GetMyDayTrack = {
  id: string;
  name: string;
  speedhiveUrl: string | null;
  liveRcUrl: string | null;
  timeZone: string;
};

export type GetMyDayResult = {
  /** Sessions the timing sites hold for the driver that day, however they were filed. */
  found: number;
  /** Of those, already on a run before this press. */
  alreadyOnRuns: number;
  /** New runs the app made (unconfirmed until the driver checks them). */
  added: number;
  /** Laps put on a run the driver had opened — a draft, or a run saved without laps. */
  attached: number;
  /** Outings that joined a run the driver already had for that time on track. */
  joined: number;
  /** Sessions that could not be filed (a page that would not import, the daily cap). */
  skipped: number;
  /** Sessions the app could not give a car; the sheet asks which. */
  needsCar: number;
  /** Timing sites that could not be read. */
  failedSources: SweepSource[];
  /** The day in Sessions, where the Debrief lives. Null when the day has no runs there. */
  dayHref: string | null;
};

/**
 * Where the driver has raced lately, then their favourites, then tracks they added themselves —
 * only tracks with a timing link. The last group covers a track added this week and not raced yet.
 */
export async function listGetMyDayTracks(userId: string): Promise<Array<{ id: string; name: string }>> {
  const since = new Date(Date.now() - TRACK_LOOKBACK_DAYS * DAY_MS);
  const [recent, favourites, owned] = await Promise.all([
    prisma.run.findMany({
      where: { userId, trackId: { not: null }, sortAt: { gte: since } },
      orderBy: { sortAt: "desc" },
      select: { trackId: true },
      take: 500,
    }),
    getFavouriteTrackIdsForUser(userId).catch(() => [] as string[]),
    prisma.track.findMany({
      where: { userId, OR: [{ liveRcUrl: { not: null } }, { speedhiveUrl: { not: null } }] },
      orderBy: { createdAt: "desc" },
      select: { id: true },
      take: TRACK_LIST_MAX,
    }),
  ]);
  const order: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !order.includes(id)) order.push(id);
  };
  for (const r of recent) add(r.trackId);
  for (const id of favourites) add(id);
  for (const t of owned) add(t.id);
  if (order.length === 0) return [];

  const rows = await prisma.track.findMany({
    where: { id: { in: order } },
    select: { id: true, name: true, liveRcUrl: true, speedhiveUrl: true },
  });
  const usable = new Map(
    rows.filter((t) => t.liveRcUrl?.trim() || t.speedhiveUrl?.trim()).map((t) => [t.id, t]),
  );
  const out: Array<{ id: string; name: string }> = [];
  for (const id of order) {
    const t = usable.get(id);
    if (t) out.push({ id: t.id, name: t.name });
    if (out.length >= TRACK_LIST_MAX) break;
  }
  return out;
}

export async function loadGetMyDayTrack(trackId: string): Promise<GetMyDayTrack | null> {
  const t = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      name: true,
      speedhiveUrl: true,
      liveRcUrl: true,
      timeZone: true,
      latitude: true,
      longitude: true,
      user: { select: { timeZone: true } },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    speedhiveUrl: t.speedhiveUrl?.trim() || null,
    liveRcUrl: t.liveRcUrl?.trim() || null,
    timeZone: resolveTrackTimeZone(t, t.user),
  };
}

export async function getMyDay(params: {
  userId: string;
  track: GetMyDayTrack;
  ymd: string;
  now?: Date;
}): Promise<GetMyDayResult> {
  const now = params.now ?? new Date();
  const { userId, track, ymd } = params;
  const zone = track.timeZone;
  const day = dayBoundsForYmd(ymd, zone);
  // LiveRC's meeting check reads a date off an instant; noon at the track is that day anywhere.
  const noon = wallClockAsUtcToInstant(new Date(`${ymd}T12:00:00.000Z`), zone);

  // LiveRC's practice page lists every driver: with no name to match, all of them would be "yours".
  const liveRcName = track.liveRcUrl
    ? ((await getLiveRcDriverNameSetting(userId).catch(() => null))?.trim() ?? "")
    : "";
  const readLiveRc = Boolean(track.liveRcUrl && liveRcName);

  const [speedhive, liveRc] = await Promise.all([
    track.speedhiveUrl
      ? discoverSpeedhiveSessionsForUser({ userId, trackSpeedhiveUrl: track.speedhiveUrl, day }).catch(
          (err: unknown) => {
            reportSweepFailure(err, { stage: "day", source: "speedhive", trackId: track.id, userId });
            return null;
          },
        )
      : Promise.resolve(null),
    readLiveRc
      ? discoverLiveRcSessionsForUser({
          userId,
          trackLiveRcUrl: track.liveRcUrl!,
          referenceDate: noon,
          practiceDayYmd: ymd,
        }).catch((err: unknown) => {
          reportSweepFailure(err, { stage: "day", source: "liverc", trackId: track.id, userId });
          return null;
        })
      : Promise.resolve(null),
  ]);

  const failedSources: SweepSource[] = [];
  if (track.speedhiveUrl && (!speedhive || speedhive.status?.code === "unreachable")) {
    failedSources.push("speedhive");
  }
  if (readLiveRc && (!liveRc || liveRc.status?.code === "unreachable")) failedSources.push("liverc");

  const sh = splitDayCandidates(speedhive?.candidates ?? [], ymd, "speedhive", zone);
  const lr = splitDayCandidates(liveRc?.candidates ?? [], ymd, "liverc", zone);
  const candidates: GatheredCandidate[] = [
    ...sh.toFile.map((c) => ({
      sessionUrl: c.sessionUrl,
      source: "speedhive" as const,
      sourceKind: c.sourceKind,
      chipCode: c.chipCode ?? null,
    })),
    ...lr.toFile.map((c) => ({ sessionUrl: c.sessionUrl, source: "liverc" as const, sourceKind: c.sourceKind })),
  ];

  const outcomes = await fileDayForUser({
    userId,
    track: { id: track.id, timeZone: zone },
    candidates,
    now,
    trigger: "driver",
  });
  const alreadyOnRuns = sh.alreadyOnRuns + lr.alreadyOnRuns;
  const loose = await looseRowsForDay(userId, track, day);
  return {
    found: candidates.length + alreadyOnRuns,
    alreadyOnRuns,
    ...tally(outcomes),
    needsCar: loose.length,
    failedSources,
    dayHref: await dayHrefFor(userId, track.id, day),
  };
}

/**
 * How many of that day's sessions are still waiting on a car, without reading a timing site.
 * The 8 pm pass has already imported them, so a driver arriving from the notification must not
 * pay for another crawl (LiveRC alone can take 35 s) just to be asked one question.
 */
export async function pendingCarQuestion(params: {
  userId: string;
  track: GetMyDayTrack;
  ymd: string;
}): Promise<{ needsCar: number; dayHref: string | null }> {
  const day = dayBoundsForYmd(params.ymd, params.track.timeZone);
  const rows = await looseRowsForDay(params.userId, params.track, day);
  return { needsCar: rows.length, dayHref: await dayHrefFor(params.userId, params.track.id, day) };
}

/** "Which car?" answered: the day's loose sessions at this track, filed with that car. */
export async function fileDayLooseWithCar(params: {
  userId: string;
  track: GetMyDayTrack;
  ymd: string;
  carId: string;
}): Promise<GetMyDayResult> {
  const { userId, track, ymd, carId } = params;
  const day = dayBoundsForYmd(ymd, track.timeZone);
  const rows = await looseRowsForDay(userId, track, day);
  const outcomes = await fileImportedRowsForUser({
    userId,
    track: { id: track.id, timeZone: track.timeZone },
    rows,
    carId,
  });
  const stillLoose = await looseRowsForDay(userId, track, day);
  return {
    found: rows.length,
    alreadyOnRuns: 0,
    ...tally(outcomes),
    needsCar: stillLoose.length,
    failedSources: [],
    dayHref: await dayHrefFor(userId, track.id, day),
  };
}

function tally(outcomes: readonly FileOutcome[]): Pick<GetMyDayResult, "added" | "attached" | "joined" | "skipped"> {
  let added = 0;
  let attached = 0;
  let joined = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o.kind === "placeholder") added += 1;
    else if (o.kind === "attached") attached += 1;
    else if (o.kind === "joined") joined += 1;
    else if (o.kind === "skipped" && o.reason !== "already on a run") skipped += 1;
  }
  return { added, attached, joined, skipped };
}

/** Sessions the app imported at this track for that day and could not put on a run. */
async function looseRowsForDay(
  userId: string,
  track: GetMyDayTrack,
  day: { start: Date; end: Date },
): Promise<FilingRow[]> {
  const rows = await prisma.importedLapTimeSession.findMany({
    where: {
      userId,
      trackId: track.id,
      linkedRunId: null,
      sweepFiledAt: { not: null },
      sessionCompletedAt: {
        gte: new Date(day.start.getTime() - LOOSE_WINDOW_SLACK_MS),
        lt: new Date(day.end.getTime() + LOOSE_WINDOW_SLACK_MS),
      },
    },
    select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
    take: 60,
  });
  const out: FilingRow[] = [];
  for (const r of rows) {
    const s = outingSessionFromImportedRow(r, track.timeZone);
    if (!s || s.start < day.start || s.start >= day.end) continue;
    out.push({
      ...r,
      chipCode: null,
      sourceKind: outingKindFor(r.parserId, r.sourceUrl) === "official" ? "race" : "practice",
    });
  }
  return out;
}

/** The day's first logged run at the track, opened as its day in Sessions. */
async function dayHrefFor(
  userId: string,
  trackId: string,
  day: { start: Date; end: Date },
): Promise<string | null> {
  const where = { userId, trackId, sortAt: { gte: day.start, lt: day.end } };
  const first =
    (await prisma.run.findFirst({
      where: { ...where, loggingComplete: true },
      orderBy: { sortAt: "asc" },
      select: { id: true },
    })) ??
    (await prisma.run.findFirst({ where, orderBy: { sortAt: "asc" }, select: { id: true } }));
  return first ? confirmRunReturnHref(first.id) : null;
}
