import "server-only";
import { prisma } from "@/lib/prisma";
import { formatRunDateOnly } from "@/lib/formatDate";
import { loadEventsSeasonModel } from "@/lib/events/seasonModel";
import { todayYmdInTimeZone } from "@/lib/eventActive";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere, type TrackCatalogViewer } from "@/lib/tracks/communityTrackAccess";
import { lastRunAtMsByCarId, orderCarsByRecentUse } from "@/lib/cars/orderCarsByRecentUse";
import {
  MAX_CARS,
  MAX_CONSUMABLES,
  MAX_TRACKS,
  MAX_UPCOMING,
  daysBetweenYmd,
  type PaddockCar,
  type PaddockConsumable,
  type PaddockMeeting,
  type PaddockModel,
  type PaddockTrack,
} from "@/lib/paddock/paddockModel";

/**
 * Everything the Paddock tab shows, in one read.
 *
 * The page is a composition of three lists that each already have a full page, so this
 * deliberately does NOT call those pages' loaders: `/cars` fetches upload gates, baseline
 * counts and the sheet-model catalog, none of which a summary needs. It does reuse
 * `loadEventsSeasonModel`, because `nextUp` is not a lookup — it carries the venue best,
 * the visit count and the setup you finished the last visit on, and re-deriving those
 * here would be a second implementation of logic that is already right.
 *
 * NO `Date` LEAVES THIS FUNCTION. It is wrapped in `unstable_cache` by
 * `getCachedPaddockModel`, which round-trips through JSON — a `Date` would come back a
 * `Date` on a miss and a string on a hit, with the type still claiming `Date`. Dates are
 * formatted to display strings here, before the value is ever stored.
 */
export async function loadPaddockModel(input: {
  viewer: TrackCatalogViewer & { id: string };
  timeZone: string;
}): Promise<PaddockModel> {
  const userId = input.viewer.id;
  const { timeZone } = input;

  const [
    season,
    carRows,
    lastRunByCar,
    favouriteTrackIds,
    runsByTrack,
    trackCatalogCount,
    latestRun,
    runsByTire,
    runsByAdditive,
    tireCatalogCount,
    additiveCatalogCount,
  ] = await Promise.all([
    // `year: null` is all-time, not "the newest year with events" — a meeting booked for
    // next January must still be the next one up while it is still December.
    loadEventsSeasonModel({ userId, year: null, todayYmd: todayYmdInTimeZone(timeZone) }),
    prisma.car.findMany({
      where: { userId },
      // Only the tie-break; re-sorted below by most recent USE, which this query can't see.
      orderBy: { createdAt: "desc" },
      // A name and an id, plus the tie-break date. The chassis and its catalog model came off
      // with the second line on the row (plain lists, 2026-08-19) — the Garage still shows both.
      select: { id: true, name: true, createdAt: true },
    }),
    /*
     * When each car last ran — the ORDER of the band, and nothing else now that the date has
     * come off the row. This is the query the plain-lists pass could not delete: strip the
     * figures and the list still has to be most-recently-used-first, and a `Car` row does not
     * know when it was last driven.
     */
    prisma.run.groupBy({
      by: ["carId"],
      where: { userId, carId: { not: null } },
      _max: { createdAt: true },
    }),
    getFavouriteTrackIdsForUser(userId),
    /*
     * How many of your runs are at each track. Sort-only since the plain-lists pass: it picks
     * which non-favourite tracks make the band, and then ranks them. The `_max: sortAt` beside
     * it drew the expanded track's "last out" chip and went with the chip.
     */
    prisma.run.groupBy({
      by: ["trackId"],
      where: { userId, trackId: { not: null } },
      _count: { _all: true },
    }),
    prisma.track.count({ where: trackCatalogScopeWhere(input.viewer) }),
    prisma.run.findFirst({
      where: { userId },
      orderBy: { sortAt: "desc" },
      select: { sortAt: true, track: { select: { name: true } } },
    }),
    /*
     * The two consumables bands: when each product was last out, and how many runs are on it.
     * BOTH are sort keys now and neither is drawn — the date orders the band (most recently used
     * first, so the compound you are on leads) and the count breaks ties. This is the pair that
     * makes the plain-lists pass free of savings: take the queries away and the band loses its
     * order, not its decoration.
     *
     * `sortAt` and not `createdAt`, matching tracks: a re-imported day must not reshuffle.
     */
    prisma.run.groupBy({
      by: ["tireTypeId"],
      where: { userId, tireTypeId: { not: null } },
      _count: { _all: true },
      _max: { sortAt: true },
    }),
    prisma.run.groupBy({
      by: ["additiveTypeId"],
      where: { userId, additiveTypeId: { not: null } },
      _count: { _all: true },
      _max: { sortAt: true },
    }),
    // Both catalogs are global — no viewer scope, unlike tracks. Only the door's count.
    prisma.tireType.count(),
    prisma.additiveType.count(),
  ]);

  const orderedCars = orderCarsByRecentUse(carRows, lastRunAtMsByCarId(lastRunByCar), (car) =>
    car.createdAt.getTime()
  );

  /*
   * A name and an id per car, and the order is the only other thing this band says.
   *
   * The saved setups that used to be nested under the first car are GONE (founder call,
   * 2026-08-19) — with them went the whole `setupSnapshot` query, and the four signals the card
   * needed to keep a setup row from reading as another car: lighter weight, an indent behind a
   * hairline, a smaller chevron, and "a car is stamped with a date, a setup with a run count".
   * Two of those four were the date and the count, so once those came off the card either the
   * rest got rebuilt or the setups left. They live on the car page, in full, one tap away.
   */
  const cars: PaddockCar[] = orderedCars.slice(0, MAX_CARS).map((car) => ({
    id: car.id,
    name: car.name,
  }));

  /*
   * Tracks: your favourites, then the ones you actually run, then nothing.
   *
   * The catalog is a search surface with hundreds of rows; this band is the opposite — a
   * short list of places you have a relationship with. Anything not in one of those two
   * groups is behind the "N more" line, which is what keeps this from becoming /tracks
   * rendered twice.
   */
  const runCountByTrack = new Map<string, number>();
  for (const row of runsByTrack) {
    if (!row.trackId) continue;
    runCountByTrack.set(row.trackId, row._count._all);
  }
  const favouriteSet = new Set(favouriteTrackIds);
  const candidateIds = new Set<string>(favouriteTrackIds);
  for (const [trackId] of [...runCountByTrack.entries()].sort((a, b) => b[1] - a[1])) {
    if (candidateIds.size >= MAX_TRACKS + favouriteSet.size) break;
    candidateIds.add(trackId);
  }
  /*
   * Tyres and additives: what you actually run, most recently used first.
   *
   * The band is deliberately NOT the catalog — that is the shared list of every product anyone
   * has ever added, it lives under Settings, and it is what the doors at the foot of these two
   * bands open. This is the handful you have a relationship with, exactly as the tracks band is
   * to `/tracks`. See `PaddockConsumable` for why recency beats favourites here.
   */
  const tireUse = topRecentUse(
    runsByTire.map((row) => ({
      id: row.tireTypeId,
      runCount: row._count._all,
      lastOut: row._max.sortAt,
    }))
  );
  const additiveUse = topRecentUse(
    runsByAdditive.map((row) => ({
      id: row.additiveTypeId,
      runCount: row._count._all,
      lastOut: row._max.sortAt,
    }))
  );

  /*
   * All three name lookups in one trip. None of them could join the first batch — each needs
   * ids worked out from a grouped scan in it — but they have no dependency on each other, and
   * this is the most-hit tab in the app, so they travel together rather than in single file.
   */
  const [trackRows, tireRows, additiveRows] = await Promise.all([
    candidateIds.size
      ? prisma.track.findMany({
          where: { id: { in: [...candidateIds] } },
          // The venue and its grip tags drew the expanded track's second line and came off with
          // it; `/tracks` is where a track is more than a name.
          select: { id: true, name: true },
        })
      : [],
    tireUse.length
      ? prisma.tireType.findMany({
          where: { id: { in: tireUse.map((use) => use.id) } },
          select: { id: true, displayName: true },
        })
      : [],
    additiveUse.length
      ? prisma.additiveType.findMany({
          where: { id: { in: additiveUse.map((use) => use.id) } },
          select: { id: true, displayName: true },
        })
      : [],
  ]);

  /*
   * Favourites first, then most-run, then alphabetical — unchanged, and now invisible: the run
   * count that ranks the tail is no longer drawn beside it. The star is the only part of the
   * order the row still admits to, which is the reason it stayed.
   */
  const tracks: PaddockTrack[] = trackRows
    .map((track) => ({
      id: track.id,
      name: track.name,
      isFavourite: favouriteSet.has(track.id),
      runCount: runCountByTrack.get(track.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
      if (a.runCount !== b.runCount) return b.runCount - a.runCount;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_TRACKS)
    // `runCount` sorted the list and stops here — the band's shape is a name, an id and a star.
    .map(({ id, name, isFavourite }) => ({ id, name, isFavourite }));

  /*
   * Mapped back through `tireUse` / `additiveUse` rather than over the fetched rows: `findMany`
   * returns whatever order the database felt like, and the order IS the content here — the band
   * says "what you are on now, then what you were on before".
   *
   * `flatMap` and not `map`, so a catalog row deleted out from under a run drops out silently
   * instead of rendering a nameless row.
   */
  const tireById = new Map(tireRows.map((row) => [row.id, row]));
  const tires: PaddockConsumable[] = tireUse.flatMap((use) => {
    const row = tireById.get(use.id);
    if (!row) return [];
    return [{ id: row.id, name: row.displayName }];
  });

  const additiveById = new Map(additiveRows.map((row) => [row.id, row]));
  const additives: PaddockConsumable[] = additiveUse.flatMap((use) => {
    const row = additiveById.get(use.id);
    if (!row) return [];
    return [{ id: row.id, name: row.displayName }];
  });

  /*
   * Booked meetings after the hero's. `season.booked` is newest-first like every other list
   * on the events page; here the soonest one matters most, so it is re-sorted rather than
   * reversed — a three-day meeting and a one-day meeting starting the same week do not sort
   * the same in both directions.
   */
  const upcoming: PaddockMeeting[] = season.booked
    .filter((event) => event.id !== season.nextUp?.event.id)
    .sort((a, b) => a.startYmd.localeCompare(b.startYmd))
    .slice(0, MAX_UPCOMING)
    .map((event) => ({
      id: event.id,
      name: event.name,
      trackName: event.trackName,
      startYmd: event.startYmd,
      daysUntil: daysBetweenYmd(season.todayYmd, event.startYmd),
    }));

  return {
    nextUp: season.nextUp,
    upcoming,
    cars,
    // The whole garage, not `cars.length` — that one is capped at three by the slice above.
    carTotal: orderedCars.length,
    tracks,
    trackCatalogCount,
    // Every booked meeting INCLUDING the hero's: the door opens the events page, which lists it.
    meetingTotal: season.booked.length,
    lastOuting: latestRun
      ? {
          trackName: latestRun.track?.name ?? null,
          label: formatRunDateOnly(latestRun.sortAt, timeZone),
        }
      : null,
    tires,
    tireCatalogCount,
    additives,
    additiveCatalogCount,
  };
}

/**
 * The `MAX_CONSUMABLES` most recently used rows out of a grouped scan, newest first.
 *
 * A null max means every run on that product predates `sortAt` being stamped, which is a real
 * state on the oldest rows. Those sort to the bottom rather than being dropped — the run count
 * is still true, and a compound with forty runs on it belongs on the band whether or not the app
 * can say when it was last out.
 */
function topRecentUse(
  rows: Array<{ id: string | null; runCount: number; lastOut: Date | null }>
): Array<{ id: string; runCount: number; lastOut: Date | null }> {
  return rows
    .flatMap((row) => (row.id ? [{ ...row, id: row.id }] : []))
    .sort((a, b) => {
      const aMs = a.lastOut?.getTime() ?? -Infinity;
      const bMs = b.lastOut?.getTime() ?? -Infinity;
      if (aMs !== bMs) return bMs - aMs;
      return b.runCount - a.runCount;
    })
    .slice(0, MAX_CONSUMABLES);
}
