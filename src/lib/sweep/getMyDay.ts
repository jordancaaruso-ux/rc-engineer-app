import "server-only";

import { prisma } from "@/lib/prisma";
import { getLiveRcDriverIdSetting, getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { discoverLiveRcSessionsForUser } from "@/lib/lapWatch/discoverLiveRcSessionsForUser";
import { discoverSpeedhiveSessionsForUser } from "@/lib/speedhive/discoverSpeedhiveSessionsForUser";
import { resolveTrackTimeZone } from "@/lib/tracks/trackTimeZone";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { communityTrackListWhere, type TrackCatalogViewer } from "@/lib/tracks/communityTrackAccess";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { outingKindFor } from "@/lib/runs/outingSpan";
import { outingSessionFromImportedRow } from "@/lib/runs/outingsFromImportedSessions";
import {
  rawSessionDriversFromImportedPayload,
  sessionHintNameFromPayload,
} from "@/lib/lapImport/importedIngestPlan";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import {
  carsForPendingOutings,
  fileDayForUser,
  logChosenOutingsForUser,
  type FileOutcome,
  type FilingRow,
  type GatheredCandidate,
} from "@/lib/sweep/fileDay";
import { dayBoundsForYmd, splitDayCandidates } from "@/lib/sweep/getMyDayDays";
import { pendingOutingsFrom, splitChosen, type PendingOutingSource } from "@/lib/sweep/pendingOutings";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import type { SweepSource } from "@/lib/sweep/sweepDocs";

/**
 * "Import your last runs" (founder call 2026-09-15, "Get my day" then): the driver names a track
 * and a day, and the app reads the timing sites ONCE, for that driver, through the same code as
 * the 8 pm pass. Since 2026-09-18 neither files a run on its own: what the sites hold that is not
 * already on a run comes back as a PENDING list — one row per time on track — and the driver
 * ticks the ones they want (`logChosenForDay`). No background scanning — one look per tap.
 * Pressing again is safe: sessions already on a run are skipped, an outing that overlaps a run
 * joins it, and a row the driver unticked stays put away (`fileDay.ts`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACK_LOOKBACK_DAYS = 180;
const TRACK_LIST_MAX = 10;
const TRACK_SEARCH_MAX = 12;
/**
 * The race crawl's ceiling for a day asked for by hand. The route has 120 s; a live look keeps 35 s
 * so a trackside tap stays quick, but a day read after the fact would rather wait than come back
 * short. What it still cannot finish is reported, never dropped (`incomplete`).
 */
const DAY_RACE_CRAWL_BUDGET_MS = 75_000;
/** A day's loose sessions are looked up by stored time; wall-clock sources sit up to a day off. */
const LOOSE_WINDOW_SLACK_MS = 36 * 60 * 60 * 1000;

export type GetMyDayTrack = {
  id: string;
  name: string;
  speedhiveUrl: string | null;
  liveRcUrl: string | null;
  timeZone: string;
};

/** One row of the sheet: a time on track the driver did not log, as the timing sites hold it. */
export type PendingOutingView = {
  /** The primary session's id — sent back ticked or unticked. */
  id: string;
  kind: "race" | "practice";
  startIso: string;
  /** "10:42 am", on the track's clock. */
  when: string;
  lapCount: number | null;
  bestLapSeconds: number | null;
  /** The car the app can place it in from the driver's own facts; null → the sheet asks. */
  carId: string | null;
  carName: string | null;
};

export type PendingDay = {
  pending: PendingOutingView[];
  /** Rows the app cannot give a car — the sheet asks once, for these. */
  needsCar: number;
  /** The day in Sessions, where the Debrief lives. Null when the day has no runs there. */
  dayHref: string | null;
};

export type GetMyDayResult = PendingDay & {
  /** Sessions the timing sites hold for the driver that day, however they were placed. */
  found: number;
  /** Of those, already on a run before this press. */
  alreadyOnRuns: number;
  /** Laps put on a run the driver had opened — a draft, or a run saved without laps. */
  attached: number;
  /** Outings that joined a run the driver already had for that time on track. */
  joined: number;
  /** Sessions that could not be placed (a page that would not import). */
  skipped: number;
  /** Timing sites that could not be read. */
  failedSources: SweepSource[];
};

export type LogChosenResult = PendingDay & {
  /** Runs made from the ticked rows. */
  logged: number;
  /** Ticked rows that turned out to overlap a run logged since the list was read. */
  joined: number;
  skipped: number;
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

/**
 * Every track in the catalog with a timing link, by name, town, state or LiveRC host — busiest
 * first. How a driver with no tracks of their own (a new account, a new venue) reaches the import
 * at all; the list above only knows where they have already been.
 */
export async function searchGetMyDayTracks(
  viewer: TrackCatalogViewer,
  query: string,
): Promise<Array<{ id: string; name: string; location: string | null }>> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.track.findMany({
    // Nested under AND: the search is a top-level OR, and a second one would overwrite it.
    where: {
      AND: [
        communityTrackListWhere(viewer, q),
        { OR: [{ liveRcUrl: { not: null } }, { speedhiveUrl: { not: null } }] },
      ],
    },
    orderBy: [{ catalogEventCount: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    take: TRACK_SEARCH_MAX,
    select: { id: true, name: true, location: true, liveRcUrl: true, speedhiveUrl: true },
  });
  return rows
    .filter((t) => t.liveRcUrl?.trim() || t.speedhiveUrl?.trim())
    .map((t) => ({ id: t.id, name: t.name, location: t.location }));
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
      ? discoverSpeedhiveSessionsForUser({
          userId,
          trackSpeedhiveUrl: track.speedhiveUrl,
          day,
          dayYmd: ymd,
          timeZone: zone,
        }).catch((err: unknown) => {
          reportSweepFailure(err, { stage: "day", source: "speedhive", trackId: track.id, userId });
          return null;
        })
      : Promise.resolve(null),
    readLiveRc
      ? discoverLiveRcSessionsForUser({
          userId,
          trackLiveRcUrl: track.liveRcUrl!,
          referenceDate: noon,
          practiceDayYmd: ymd,
          raceCrawlBudgetMs: DAY_RACE_CRAWL_BUDGET_MS,
        }).catch((err: unknown) => {
          reportSweepFailure(err, { stage: "day", source: "liverc", trackId: track.id, userId });
          return null;
        })
      : Promise.resolve(null),
  ]);

  // A source that could not be read IN FULL counts as failed, not just one that could not be
  // reached: every run in the day is the promise, and a short list must not pass for a whole one.
  const failedSources: SweepSource[] = [];
  if (track.speedhiveUrl && (!speedhive || speedhive.status?.code === "unreachable" || speedhive.incomplete)) {
    failedSources.push("speedhive");
  }
  if (readLiveRc && (!liveRc || liveRc.status?.code === "unreachable" || liveRc.incomplete)) {
    failedSources.push("liverc");
  }

  const sh = splitDayCandidates(speedhive?.candidates ?? [], ymd, "speedhive", zone);
  const lr = splitDayCandidates(liveRc?.candidates ?? [], ymd, "liverc", zone);
  const candidates: GatheredCandidate[] = [
    ...sh.toFile.map((c) => ({
      sessionUrl: c.sessionUrl,
      source: "speedhive" as const,
      sourceKind: c.sourceKind,
      chipCode: c.chipCode ?? null,
      // A Speedhive race page carries no time of its own; the event listing does.
      listedAtIso: c.sessionCompletedAtIso,
    })),
    ...lr.toFile.map((c) => ({
      sessionUrl: c.sessionUrl,
      source: "liverc" as const,
      sourceKind: c.sourceKind,
      listedAtIso: c.sessionCompletedAtIso,
    })),
  ];

  const outcomes = await fileDayForUser({
    userId,
    track: { id: track.id, timeZone: zone },
    candidates,
    now,
    trigger: "driver",
  });
  const alreadyOnRuns = sh.alreadyOnRuns + lr.alreadyOnRuns;
  return {
    found: candidates.length + alreadyOnRuns,
    alreadyOnRuns,
    attached: outcomes.filter((o) => o.kind === "attached").length,
    joined: outcomes.filter((o) => o.kind === "joined").length,
    skipped: outcomes.filter((o) => o.kind === "skipped" && !NOT_A_FAILURE.has(o.reason)).length,
    failedSources,
    ...(await pendingForDay({ userId, track, ymd })),
  };
}

const NOT_A_FAILURE = new Set(["already on a run", "declined"]);

/**
 * The day's runs the driver did not log, without reading a timing site. The 8 pm pass has
 * already imported them, so a driver arriving from the notification must not pay for another
 * crawl (LiveRC alone can take 35 s) just to tick a list.
 */
export async function pendingForDay(params: {
  userId: string;
  track: GetMyDayTrack;
  ymd: string;
}): Promise<PendingDay> {
  const { userId, track, ymd } = params;
  const day = dayBoundsForYmd(ymd, track.timeZone);
  const { pending, rowById } = await pendingOutingsForDay(userId, track, day);
  const cars = await carsForPendingOutings({ userId, track, day, pending, rowById });
  const clock = new Intl.DateTimeFormat("en-AU", { timeZone: track.timeZone, hour: "numeric", minute: "2-digit" });
  const views: PendingOutingView[] = pending.map((o) => {
    const car = cars.get(o.id) ?? null;
    return {
      id: o.id,
      kind: o.kind === "official" ? "race" : "practice",
      startIso: o.start.toISOString(),
      when: clock.format(o.start),
      lapCount: o.lapCount,
      bestLapSeconds: o.bestLapSeconds,
      carId: car?.carId ?? null,
      carName: car?.carName ?? null,
    };
  });
  return {
    pending: views,
    needsCar: views.filter((v) => !v.carId).length,
    dayHref: await dayHrefFor(userId, track.id, day),
  };
}

/**
 * The sheet answered: `keep` are the rows the driver ticked, `decline` the ones they unticked,
 * `carId` the car they named when asked. Runs are made from the ticked rows only.
 */
export async function logChosenForDay(params: {
  userId: string;
  track: GetMyDayTrack;
  ymd: string;
  keep: readonly string[];
  decline: readonly string[];
  carId: string | null;
}): Promise<LogChosenResult> {
  const { userId, track, ymd, carId } = params;
  const day = dayBoundsForYmd(ymd, track.timeZone);
  const { pending, rowById } = await pendingOutingsForDay(userId, track, day);
  const chosen = splitChosen(pending, params.keep, params.decline);
  const outcomes = await logChosenOutingsForUser({
    userId,
    track: { id: track.id, timeZone: track.timeZone },
    day,
    keep: chosen.keep,
    decline: chosen.decline,
    rowById,
    carId,
  });
  return {
    logged: outcomes.filter((o) => o.kind === "logged").length,
    joined: outcomes.filter((o) => o.kind === "joined").length,
    skipped: outcomes.filter((o) => o.kind === "skipped").length,
    ...(await pendingForDay({ userId, track, ymd })),
  };
}

/** How many runs the sheet would list for that day — the notification's count. */
export async function countPendingForDay(params: {
  userId: string;
  track: GetMyDayTrack;
  day: { start: Date; end: Date };
}): Promise<number> {
  return (await pendingOutingsForDay(params.userId, params.track, params.day)).pending.length;
}

/** The day's loose sessions at this track as outings, with the driver's own laps on each. */
async function pendingOutingsForDay(
  userId: string,
  track: GetMyDayTrack,
  day: { start: Date; end: Date },
): Promise<{ pending: ReturnType<typeof pendingOutingsFrom>; rowById: Map<string, FilingRow> }> {
  const rows = await looseRowsForDay(userId, track, day);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  if (rows.length === 0) return { pending: [], rowById };
  const [liveRcDriverId, liveRcDriverName] = await Promise.all([
    getLiveRcDriverIdSetting(userId).catch(() => null),
    getLiveRcDriverNameSetting(userId).catch(() => null),
  ]);
  const sources: PendingOutingSource[] = [];
  for (const row of rows) {
    const s = outingSessionFromImportedRow(row, track.timeZone);
    if (!s) continue;
    sources.push({ ...s, ...ownLaps(row, { liveRcDriverId, liveRcDriverName }) });
  }
  return { pending: pendingOutingsFrom(sources), rowById };
}

/** The driver's own row on the sheet — the same pick the run would make of it. */
function ownLaps(
  row: FilingRow,
  opts: { liveRcDriverId: string | null; liveRcDriverName: string | null },
): { ownLapCount: number | null; ownBestLapSeconds: number | null } {
  const drivers = rawSessionDriversFromImportedPayload(row.parsedPayload);
  if (!drivers || drivers.length === 0) return { ownLapCount: null, ownBestLapSeconds: null };
  const mine = pickPrimarySessionDriver(drivers, {
    ...opts,
    sessionHintName: sessionHintNameFromPayload(row.parsedPayload),
  });
  const laps = mine.laps.filter((n) => Number.isFinite(n) && n > 0);
  return {
    ownLapCount: laps.length,
    ownBestLapSeconds: laps.length > 0 ? Math.min(...laps) : null,
  };
}

/**
 * Sessions the app imported at this track for that day that are on no run and were not unticked
 * (`detectionPromptDismissedAt` — the sheet's "not this one", kept so no read offers it again).
 */
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
      detectionPromptDismissedAt: null,
      hiddenAt: null,
      sessionCompletedAt: {
        gte: new Date(day.start.getTime() - LOOSE_WINDOW_SLACK_MS),
        lt: new Date(day.end.getTime() + LOOSE_WINDOW_SLACK_MS),
      },
    },
    select: {
      id: true,
      sourceUrl: true,
      parserId: true,
      parsedPayload: true,
      sessionCompletedAt: true,
      sweepChipCode: true,
    },
    take: 60,
  });
  const out: FilingRow[] = [];
  for (const { sweepChipCode, ...r } of rows) {
    const s = outingSessionFromImportedRow(r, track.timeZone);
    if (!s || s.start < day.start || s.start >= day.end) continue;
    out.push({
      ...r,
      chipCode: sweepChipCode,
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

export type { FileOutcome };
