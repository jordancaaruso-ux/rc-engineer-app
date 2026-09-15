import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { renderHistoryBlock, type HistoryRun } from "@/lib/engineer/historyShape";
import type { FieldPace } from "@/lib/engineer/fieldPace";
import { FIELD_RUN_SELECT, loadFieldPaceForRuns } from "@/lib/engineer/fieldPaceLoad";
import { matchDriverName } from "@/lib/engineer/nameMatch";
import { driverKey, driversOnSheets } from "@/lib/engineer/rivals";
import type { EngineerPayloadBlock } from "@/lib/engineer/payload";
import { describeRangeDates, type EngineerRangeScope } from "@/lib/engineer/rangeScope";
import { readableSetupKey, tuningValues } from "@/lib/engineer/setupDiff";
import {
  getAverageTopN,
  getBestLap,
  getDisplayFiveMinuteStint,
  primaryLapRowsFromRun,
  readFiveMinStartLap,
} from "@/lib/lapAnalysis";
import { formatFiveMinuteStint } from "@/lib/runLaps";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunPickerSessionSegment } from "@/lib/runPickerFormat";
import { formatLocalCalendarDate } from "@/lib/runs/localCalendarInTimeZone";

/**
 * The range block: the driver's runs across a track and a span of dates, as one per-turn
 * payload block (founder call 2026-09-14). The shaping and the arithmetic live in
 * historyShape.ts; this file only loads rows and resolves dates.
 *
 * The scope is the driver's, from the subject bar — never inferred from the question. When a
 * scope is on the request it REPLACES the per-run block (driverData.ts): the Engineer reads a
 * run, or a range, never both, so the driver always knows what is attached.
 *
 * Size: one run is ~45 tokens; 60 runs, the day and tyre tables and one setup sheet come to
 * ~5K tokens a turn, uncached. The whole history of the heaviest account compresses to ~9K,
 * so a range never needs raw laps — per-run summaries are the whole block.
 */

/** Most recent runs kept from the range; the block says how many older ones were left out. */
export const MAX_RANGE_RUNS = 60;
/** Enough rows to fill the cap after the exact local-date filter has removed the edges. */
const QUERY_TAKE = MAX_RANGE_RUNS * 4;
/** A local calendar day is at most ±26h from the same UTC instant; two days is safe. */
const DATE_SLACK_MS = 2 * 24 * 3600_000;

const RUN_SELECT = {
  id: true,
  createdAt: true,
  sortAt: true,
  localTimeZone: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  unconfirmedAt: true,
  sessionLabel: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  carId: true,
  eventId: true,
  carRating: true,
  tireRunNumber: true,
  tireAgeKnown: true,
  tireStintId: true,
  tireTypeId: true,
  conditionsAirTempC: true,
  conditionsTrackTempC: true,
  lapTimes: true,
  lapSession: true,
  ...FIELD_RUN_SELECT,
  car: { select: { name: true, chassis: true } },
  track: { select: { name: true } },
  tireType: { select: { displayName: true, modelCode: true } },
  setupSnapshot: { select: { data: true } },
} satisfies Prisma.RunSelect;

export type HistoryRow = Prisma.RunGetPayload<{ select: typeof RUN_SELECT }>;
type Row = HistoryRow;

/**
 * Every car of the SAME TYPE as the chosen one — the day block's rule (founder call
 * 2026-09-01): two chassis of one model share a setup vocabulary, and a driver running both
 * is having one conversation about one platform.
 */
async function sameTypeCarIds(userId: string, carId: string): Promise<string[]> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { id: true, chassis: true, setupSheetModelId: true },
  });
  if (!car) return [];
  const where = car.setupSheetModelId
    ? { userId, setupSheetModelId: car.setupSheetModelId }
    : car.chassis
      ? { userId, chassis: car.chassis }
      : null;
  if (!where) return [car.id];
  const rows = await prisma.car.findMany({ where, select: { id: true } });
  return rows.length > 0 ? rows.map((r) => r.id) : [car.id];
}

/**
 * A meeting as a scope: its own runs, plus runs at its track on its declared days (the same
 * UTC-date rule the Sessions list folds on), so runs logged at the meeting without the event
 * attached still count.
 */
export type ResolvedEvent = { id: string; name: string; trackId: string | null; from: string; to: string };

async function resolveEvent(eventId: string): Promise<ResolvedEvent | null> {
  const e = await prisma.event
    .findUnique({ where: { id: eventId }, select: { id: true, name: true, trackId: true, startDate: true, endDate: true } })
    .catch(() => null);
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    trackId: e.trackId,
    from: e.startDate.toISOString().slice(0, 10),
    to: e.endDate.toISOString().slice(0, 10),
  };
}

function dateWindow(from: string | null, to: string | null): Prisma.DateTimeFilter | null {
  const sortAt: Prisma.DateTimeFilter = {};
  if (from) sortAt.gte = new Date(new Date(`${from}T00:00:00Z`).getTime() - DATE_SLACK_MS);
  if (to) sortAt.lte = new Date(new Date(`${to}T00:00:00Z`).getTime() + DATE_SLACK_MS + 24 * 3600_000);
  return from || to ? sortAt : null;
}

function runWhere(
  userId: string,
  scope: EngineerRangeScope,
  carIds: string[] | null,
  event: ResolvedEvent | null
): Prisma.RunWhereInput {
  const where: Prisma.RunWhereInput = { userId };
  if (carIds) where.carId = { in: carIds };
  if (event) {
    const days = dateWindow(event.from, event.to);
    where.OR = [{ eventId: event.id }, ...(event.trackId && days ? [{ trackId: event.trackId, sortAt: days }] : [])];
    return where;
  }
  if (scope.trackId) where.trackId = scope.trackId;
  const days = dateWindow(scope.from, scope.to);
  if (days) where.sortAt = days;
  return where;
}

type DatedRow = Pick<Row, "createdAt" | "sortAt" | "localTimeZone" | "sessionCompletedAt" | "loggingCompletedAt" | "unconfirmedAt">;

export function localYmd(run: DatedRow, fallbackZone: string | null): string {
  return formatLocalCalendarDate(resolveRunDisplayInstant(run), run.localTimeZone ?? fallbackZone ?? "UTC");
}

function localClock(run: DatedRow, fallbackZone: string | null): string | null {
  const zone = run.localTimeZone ?? fallbackZone;
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(
      resolveRunDisplayInstant(run)
    );
  } catch {
    return null;
  }
}

function inWindow(r: Row, ymd: string, scope: EngineerRangeScope, event: ResolvedEvent | null): boolean {
  if (event) return r.eventId === event.id || (ymd >= event.from && ymd <= event.to);
  if (scope.from && ymd < scope.from) return false;
  if (scope.to && ymd > scope.to) return false;
  return true;
}

async function ownerZone(userId: string): Promise<string | null> {
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }).catch(() => null);
  return owner?.timeZone ?? null;
}

/**
 * The rows in the driver's chosen range, earliest first, capped to the most recent
 * MAX_RANGE_RUNS. `omittedOlder` is how many in-range runs fell off the old end.
 */
export async function loadRunsInRange(
  userId: string,
  scope: EngineerRangeScope
): Promise<{
  rows: Row[];
  omittedOlder: number;
  zone: string | null;
  carIds: string[] | null;
  event: ResolvedEvent | null;
}> {
  const carIds = scope.carId ? await sameTypeCarIds(userId, scope.carId) : null;
  const event = scope.eventId ? await resolveEvent(scope.eventId) : null;
  if ((carIds && carIds.length === 0) || (scope.eventId && !event)) {
    return { rows: [], omittedOlder: 0, zone: null, carIds, event };
  }
  const zone = await ownerZone(userId);

  const rows = await prisma.run.findMany({
    where: runWhere(userId, scope, carIds, event),
    orderBy: { sortAt: "desc" },
    take: QUERY_TAKE,
    select: RUN_SELECT,
  });
  const inRange = rows.filter((r) => inWindow(r, localYmd(r, zone), scope, event));
  const kept = inRange.slice(0, MAX_RANGE_RUNS).reverse();
  return { rows: kept, omittedOlder: inRange.length - kept.length, zone, carIds, event };
}

/** How many runs the range holds — for the subject bar's label before the driver asks. */
export async function countRunsInRange(userId: string, scope: EngineerRangeScope): Promise<number> {
  const { rows, omittedOlder } = await loadRunsInRange(userId, scope);
  return rows.length + omittedOlder;
}

/** Exported for the read-only prod capture, which assembles rows by raw SQL. */
export function toHistoryRun(r: Row, zone: string | null, field: FieldPace | null = null): HistoryRun {
  const laps = primaryLapRowsFromRun(r);
  const stint = getDisplayFiveMinuteStint(laps, readFiveMinStartLap(r.lapSession));
  return {
    id: r.id,
    dateYmd: localYmd(r, zone),
    clock: localClock(r, zone),
    trackName: r.track?.name ?? null,
    carId: r.carId,
    carName: r.car?.name ?? r.car?.chassis ?? null,
    session: sessionSegment(r),
    lapCount: laps.length,
    best: getBestLap(laps),
    top5: getAverageTopN(laps, 5),
    fiveMin: stint ? formatFiveMinuteStint(stint, 1) : null,
    rating: r.carRating,
    tyreName: r.tireType?.displayName ?? r.tireType?.modelCode ?? null,
    tyreTypeId: r.tireTypeId,
    tyreRun: r.tireRunNumber,
    tyreAgeKnown: r.tireAgeKnown,
    tyreStintId: r.tireStintId,
    airC: r.conditionsAirTempC,
    trackC: r.conditionsTrackTempC,
    unconfirmed: r.unconfirmedAt != null,
    tuning: tuningValues(r.setupSnapshot?.data),
    field,
  };
}

/** "Q2", "Race 3", "Practice" — the meeting session; plain testing prints nothing. */
function sessionSegment(r: Row): string | null {
  const seg = formatRunPickerSessionSegment(r);
  return seg === "Testing" || seg === "Session" ? null : seg;
}

/**
 * "Keilor, 1 Jun – 14 Sep 2026, A800RR (cars of this type)" — the range in words, for the
 * block's first line, so the Engineer can tell the driver what it is and isn't looking at.
 */
async function describeScope(
  scope: EngineerRangeScope,
  carIds: string[] | null,
  rows: Row[],
  event: ResolvedEvent | null
): Promise<string> {
  const parts: string[] = [];
  if (event) {
    const track = rows.find((r) => r.track?.name)?.track?.name;
    parts.push(`the meeting "${event.name}"${track ? ` at ${track}` : ""}, ${describeRangeDates({ from: event.from, to: event.to })}`);
  } else if (scope.trackId) {
    const track = rows.find((r) => r.track?.name)?.track?.name ??
      (await prisma.track.findUnique({ where: { id: scope.trackId }, select: { name: true } }).catch(() => null))?.name;
    parts.push(track ?? "one track");
  } else {
    parts.push("every track");
  }
  if (!event) parts.push(describeRangeDates(scope));
  if (scope.carId) {
    const names = [...new Set(rows.map((r) => r.car?.name ?? r.car?.chassis).filter(Boolean))];
    const chosen = names[0] ?? "one car";
    parts.push(carIds && carIds.length > 1 ? `${chosen} (every car of this type)` : chosen);
  } else {
    parts.push("every car");
  }
  return parts.join(", ");
}

/**
 * Build the range block. [] when the range holds no runs — the request is then byte-identical
 * to the data-less one, and the Engineer will say it can see nothing for that range.
 */
export async function buildDriverHistoryBlocks(params: {
  userId: string;
  scope: EngineerRangeScope;
  /**
   * The driver's latest message. A driver named in it (matched against the names on the
   * loaded timing sheets, typos forgiven — nameMatch.ts) gets a VS section (rivals.ts).
   */
  question?: string | null;
}): Promise<EngineerPayloadBlock[]> {
  const { rows, omittedOlder, zone, carIds, event } = await loadRunsInRange(params.userId, params.scope).catch(() => ({
    rows: [] as Row[],
    omittedOlder: 0,
    zone: null,
    carIds: null,
    event: null,
  }));
  if (rows.length === 0) return [];

  const fieldByRun = await loadFieldPaceForRuns(params.userId, rows).catch(() => new Map<string, FieldPace>());
  const runs = rows.map((r) => toHistoryRun(r, zone, fieldByRun.get(r.id) ?? null));
  const last = rows[rows.length - 1];
  const lastTuning = tuningValues(last.setupSnapshot?.data);
  const lastSetup =
    Object.keys(lastTuning).length > 0
      ? {
          carName: last.car?.name ?? last.car?.chassis ?? null,
          dateYmd: localYmd(last, zone),
          rows: Object.entries(lastTuning)
            .map(([k, v]) => `${readableSetupKey(k)}: ${v}`)
            .sort(),
        }
      : null;

  const rivalName = params.question
    ? matchDriverName(params.question, driversOnSheets(runs).map((d) => d.name))
    : null;
  const content = renderHistoryBlock({
    scopeLabel: await describeScope(params.scope, carIds, rows, event),
    runs,
    omittedOlder,
    lastSetup,
    rival: rivalName ? driverKey(rivalName) : null,
  });
  if (!content) return [];
  return [{ id: "driver-history", cacheStable: false, content }];
}

/**
 * The lists the range picker offers: the tracks and cars the driver has run, with counts, and
 * the span of their logging. One query each; no lap blobs.
 */
export type RangeOptionEvent = {
  id: string;
  name: string;
  trackName: string | null;
  from: string;
  to: string;
  runs: number;
};

export async function loadRangeOptions(userId: string): Promise<{
  events: RangeOptionEvent[];
  tracks: Array<{ id: string; name: string; runs: number }>;
  cars: Array<{ id: string; name: string; runs: number }>;
  first: string | null;
  last: string | null;
}> {
  const [byTrack, byCar, byEvent, edges, zone] = await Promise.all([
    prisma.run.groupBy({ by: ["trackId"], where: { userId, trackId: { not: null } }, _count: { _all: true } }),
    prisma.run.groupBy({ by: ["carId"], where: { userId, carId: { not: null } }, _count: { _all: true } }),
    prisma.run.groupBy({ by: ["eventId"], where: { userId, eventId: { not: null } }, _count: { _all: true } }),
    prisma.run.aggregate({ where: { userId }, _min: { sortAt: true }, _max: { sortAt: true } }),
    ownerZone(userId),
  ]);
  const trackIds = byTrack.map((t) => t.trackId).filter((id): id is string => id != null);
  const carIds = byCar.map((c) => c.carId).filter((id): id is string => id != null);
  const eventIds = byEvent.map((e) => e.eventId).filter((id): id is string => id != null);
  const [tracks, cars, events] = await Promise.all([
    trackIds.length ? prisma.track.findMany({ where: { id: { in: trackIds } }, select: { id: true, name: true } }) : [],
    carIds.length
      ? prisma.car.findMany({ where: { id: { in: carIds }, userId }, select: { id: true, name: true, chassis: true } })
      : [],
    eventIds.length
      ? prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, name: true, startDate: true, endDate: true, track: { select: { name: true } } },
        })
      : [],
  ]);
  const trackCount = new Map(byTrack.map((t) => [t.trackId, t._count._all]));
  const carCount = new Map(byCar.map((c) => [c.carId, c._count._all]));
  const eventCount = new Map(byEvent.map((e) => [e.eventId, e._count._all]));
  const z = zone ?? "UTC";
  return {
    events: events
      .map((e) => ({
        id: e.id,
        name: e.name,
        trackName: e.track?.name ?? null,
        from: e.startDate.toISOString().slice(0, 10),
        to: e.endDate.toISOString().slice(0, 10),
        runs: eventCount.get(e.id) ?? 0,
      }))
      .sort((a, b) => b.from.localeCompare(a.from)),
    tracks: tracks
      .map((t) => ({ id: t.id, name: t.name, runs: trackCount.get(t.id) ?? 0 }))
      .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
    cars: cars
      .map((c) => ({ id: c.id, name: c.name || c.chassis || "Car", runs: carCount.get(c.id) ?? 0 }))
      .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
    first: edges._min.sortAt ? formatLocalCalendarDate(edges._min.sortAt, z) : null,
    last: edges._max.sortAt ? formatLocalCalendarDate(edges._max.sortAt, z) : null,
  };
}
