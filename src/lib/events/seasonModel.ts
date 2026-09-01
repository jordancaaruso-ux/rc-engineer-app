/**
 * The Events page's season model (design handoff "Events — desktop redesign / Season",
 * 2026-08-08).
 *
 * One server read builds everything the desktop page draws: the venue-lane timeline, the
 * six-up stat strip, per-venue records, recent form, and the next-up dossier (or, when
 * nothing is booked, the cadence read that replaces it).
 *
 * WHY THIS IS ONE MODULE, NOT COMPONENT-LEVEL QUERIES
 * Every figure on the page is a different slice of the same two row sets — the user's
 * events and the user's completed runs. Fetching per card would re-read those rows four
 * times and let the cards disagree about the same season (the "vs venue" delta and the
 * timeline's yellow best marker are the same fact drawn twice). So: read once, derive in
 * one pass, hand the components finished numbers.
 *
 * THE LAP-JSON WATCH POINT
 * `laps` and `wheel time` have no materialized column — they need `Run.lapTimes` walked,
 * which is exactly what `bestLapSeconds` was materialized to avoid. We walk it anyway,
 * because `loadDashboardHomeModel` already does the same thing for its 30-day strip and a
 * season is the same order of magnitude (the founder's 2026: 151 completed runs). It is
 * also not optional — 42 of those 151 runs have a null `bestLapSeconds`, so a lean query
 * would silently drop 28% of the evidence out of the venue bests.
 *
 * When this gets slow, the fix is a `lapCount` + `totalLapSeconds` pair written at run
 * save time, not a narrower read here. `RUN_SCAN_CAP` is the guard rail until then.
 */
import { prisma } from "@/lib/prisma";
import { eventDateToYmd } from "@/lib/eventDateParse";
import { getIncludedLaps, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  resolveEventTrackLocation,
  resolveEventTrackName,
} from "@/lib/tracks/legacyTrackSnapshot";
import { eventIdsInScopeForUser } from "@/lib/events/eventParticipation";
import {
  addDays,
  buildCadenceRead,
  daysBetween,
  type CadenceRead,
} from "@/lib/events/seasonCadence";
import type { SeasonEventRow } from "@/lib/events/seasonEventRow";

export * from "@/lib/events/seasonTypes";
import type {
  EventsSeasonModel,
  NextUp,
  SeasonStrip,
  VenueRecord,
} from "@/lib/events/seasonTypes";

/**
 * Ceiling on the completed runs pulled with their lap JSON. Above this the page would be
 * reading megabytes to print six numbers; the strip says so rather than quietly truncating.
 */
const RUN_SCAN_CAP = 4000;

/* Calendar arithmetic (`daysBetween`, `addDays`) lives in `seasonCadence` — event dates
   are stored at UTC noon and every helper there is UTC, so there is one implementation
   rather than two that could disagree about a day boundary. */

function yearOf(ymd: string): number {
  return Number(ymd.slice(0, 4));
}

/* ── the read ─────────────────────────────────────────────────────────────── */

type RunFacts = {
  eventId: string | null;
  trackId: string | null;
  /** Calendar day the run counts as, UTC — the axis every aggregate buckets on. */
  ymd: string;
  bestLapSeconds: number | null;
  lapCount: number;
  wheelSeconds: number;
  carName: string | null;
};

export async function loadEventsSeasonModel(input: {
  userId: string;
  /** Selected year, or null for all time. Defaults to the newest year with events. */
  year?: number | null;
  /** "Today" in the VIEWER's timezone (todayYmdInTimeZone). Required — the server's
     own clock is UTC on Vercel, which held a finished meeting in the Paddock hero until
     10am Melbourne time (2026-08-31). */
  todayYmd: string;
}): Promise<EventsSeasonModel> {
  const todayYmd = input.todayYmd;
  const scopedIds = await eventIdsInScopeForUser(input.userId);

  const [eventRows, runRows, openTestPlanCount] = await Promise.all([
    scopedIds.length
      ? prisma.event.findMany({
          where: { id: { in: scopedIds } },
          orderBy: { startDate: "desc" },
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            trackId: true,
            trackNameSnapshot: true,
            trackLocationSnapshot: true,
            track: { select: { id: true, name: true, location: true } },
          },
        })
      : Promise.resolve([]),
    prisma.run.findMany({
      where: { userId: input.userId, loggingComplete: true },
      orderBy: { sortAt: "desc" },
      take: RUN_SCAN_CAP,
      select: {
        eventId: true,
        trackId: true,
        createdAt: true,
        sessionCompletedAt: true,
        loggingCompletedAt: true,
        sortAt: true,
        lapTimes: true,
        lapSession: true,
        bestLapSeconds: true,
        carNameSnapshot: true,
        car: { select: { name: true } },
        track: { select: { name: true, location: true } },
      },
    }),
    prisma.actionItem.count({
      where: { userId: input.userId, listKind: "THINGS_TO_TRY", isArchived: false, isCompleted: false },
    }),
  ]);

  /* Reduce each run to the handful of facts the page needs. `bestLapSeconds` is
     materialized but nullable, so fall back to the included laps exactly as the
     dashboard does — otherwise a run logged before that column existed counts as
     having no pace at all. */
  const runs: RunFacts[] = runRows.map((r) => {
    const included = getIncludedLaps(primaryLapRowsFromRun(r));
    const stored = typeof r.bestLapSeconds === "number" ? r.bestLapSeconds : null;
    return {
      eventId: r.eventId,
      trackId: r.trackId,
      ymd: resolveRunDisplayInstant({
        createdAt: r.createdAt,
        sessionCompletedAt: r.sessionCompletedAt,
        loggingCompletedAt: r.loggingCompletedAt,
        sortAt: r.sortAt,
      })
        .toISOString()
        .slice(0, 10),
      bestLapSeconds:
        stored ?? (included.length ? Math.min(...included.map((l) => l.lapTimeSeconds)) : null),
      lapCount: included.length,
      wheelSeconds: included.reduce((sum, l) => sum + l.lapTimeSeconds, 0),
      carName: r.car?.name ?? r.carNameSnapshot ?? null,
    };
  });

  const trackNames = new Map<string, { name: string; location: string | null }>();
  for (const r of runRows) {
    if (r.trackId && r.track && !trackNames.has(r.trackId)) {
      trackNames.set(r.trackId, { name: r.track.name, location: r.track.location });
    }
  }
  for (const e of eventRows) {
    if (e.trackId && e.track && !trackNames.has(e.trackId)) {
      trackNames.set(e.trackId, { name: e.track.name, location: e.track.location });
    }
  }

  const runsByEvent = new Map<string, RunFacts[]>();
  for (const r of runs) {
    if (!r.eventId) continue;
    const list = runsByEvent.get(r.eventId);
    if (list) list.push(r);
    else runsByEvent.set(r.eventId, [r]);
  }

  /* Lifetime pace history per venue, oldest first — the running personal best that the
     "vs venue" column measures each event against. It is deliberately a LIFETIME running
     minimum, not a season one: beating your season best when you were quicker two years
     ago is not an improvement, and printing it as one would be a lie. */
  const paceByTrack = new Map<string, Array<{ ymd: string; best: number }>>();
  for (const r of runs) {
    if (!r.trackId || r.bestLapSeconds == null) continue;
    const list = paceByTrack.get(r.trackId);
    const entry = { ymd: r.ymd, best: r.bestLapSeconds };
    if (list) list.push(entry);
    else paceByTrack.set(r.trackId, [entry]);
  }
  for (const list of paceByTrack.values()) list.sort((a, b) => a.ymd.localeCompare(b.ymd));

  /** Best lap at `trackId` recorded strictly before `ymd`; null on a first visit. */
  function venueBestBefore(trackId: string | null, ymd: string): number | null {
    if (!trackId) return null;
    const list = paceByTrack.get(trackId);
    if (!list) return null;
    let best: number | null = null;
    for (const entry of list) {
      if (entry.ymd >= ymd) break;
      if (best == null || entry.best < best) best = entry.best;
    }
    return best;
  }

  const allEvents: SeasonEventRow[] = eventRows.map((e) => {
    const startYmd = eventDateToYmd(e.startDate);
    const endYmd = eventDateToYmd(e.endDate);
    const eventRuns = runsByEvent.get(e.id) ?? [];
    const bests = eventRuns.map((r) => r.bestLapSeconds).filter((n): n is number => n != null);
    const bestLapSeconds = bests.length ? Math.min(...bests) : null;
    const priorBest = venueBestBefore(e.trackId, startYmd);
    return {
      id: e.id,
      name: e.name,
      startYmd,
      endYmd,
      dayCount: Math.max(1, daysBetween(startYmd, endYmd) + 1),
      trackId: e.trackId,
      // Name only — `resolveEventTrackLabel` bakes the location in, which reads badly
      // inside a sentence ("You've raced Boronia (Melbourne, Australia) 4 of the last…")
      // and duplicates the location this row already carries beside it.
      trackName: resolveEventTrackName(e),
      trackLocation: resolveEventTrackLocation(e),
      /* Booked vs logged is the same rule the pickers use — an event is upcoming until
         its END date passes, so a meeting still in progress stays booked. It is NOT the
         old `Planned` badge, which described whether a LiveRC URL was pasted and so read
         `Planned` on a club day raced three months ago. */
      status: endYmd >= todayYmd ? "booked" : "logged",
      runCount: eventRuns.length,
      bestLapSeconds,
      vsVenueSeconds:
        bestLapSeconds != null && priorBest != null ? bestLapSeconds - priorBest : null,
      isVenueBest: false,
    };
  });

  const years = [...new Set(allEvents.map((e) => yearOf(e.startYmd)))].sort((a, b) => b - a);
  const year = input.year === null ? null : (input.year ?? years[0] ?? new Date().getUTCFullYear());

  const inScope = (e: SeasonEventRow) => year == null || yearOf(e.startYmd) === year;
  const events = allEvents.filter(inScope);

  /* The yellow marker: within the scope on screen, the event holding the best lap at each
     venue. Scope-relative on purpose — on "2026" it marks this season's high-water mark at
     each track, which is what a timeline of 2026 is claiming to show. */
  const bestEventByTrack = new Map<string, SeasonEventRow>();
  for (const e of events) {
    if (!e.trackId || e.bestLapSeconds == null) continue;
    const held = bestEventByTrack.get(e.trackId);
    if (!held || (held.bestLapSeconds ?? Infinity) > e.bestLapSeconds) {
      bestEventByTrack.set(e.trackId, e);
    }
  }
  for (const e of bestEventByTrack.values()) e.isVenueBest = true;

  const booked = events
    .filter((e) => e.status === "booked")
    .sort((a, b) => a.startYmd.localeCompare(b.startYmd));
  const logged = events
    .filter((e) => e.status === "logged")
    .sort((a, b) => b.startYmd.localeCompare(a.startYmd));

  /* ── venue records (scope-limited) ──
     Built from every track the driver RAN at in scope, not just the ones with an event
     attached. Three-quarters of this account's runs have no `eventId`, so an
     events-only list left a venue with six sessions off the page while the strip still
     counted it — two numbers on one screen disagreeing about the same season. */
  const scopedRuns = runs.filter((r) => year == null || yearOf(r.ymd) === year);
  const scopedTrackIds = new Set<string>();
  for (const r of scopedRuns) if (r.trackId) scopedTrackIds.add(r.trackId);
  for (const e of events) if (e.trackId) scopedTrackIds.add(e.trackId);

  const venues: VenueRecord[] = [];
  for (const trackId of scopedTrackIds) {
    const meta = trackNames.get(trackId);
    const trackEvents = events.filter((e) => e.trackId === trackId);
    const trackRuns = scopedRuns.filter((r) => r.trackId === trackId);
    const timed = trackRuns.filter((r) => r.bestLapSeconds != null);
    const best = timed.length
      ? timed.reduce((a, b) => (a.bestLapSeconds! < b.bestLapSeconds! ? a : b))
      : null;
    venues.push({
      trackId,
      name: meta?.name ?? trackEvents[0]?.trackName ?? "Unknown track",
      location: meta?.location ?? trackEvents[0]?.trackLocation ?? null,
      // A visit is a day you turned a wheel there, not a meeting you created — an
      // event-based count reads "0 visits · 530 laps" at a venue you tested at all year.
      visits: new Set(trackRuns.map((r) => r.ymd)).size,
      laps: trackRuns.reduce((sum, r) => sum + r.lapCount, 0),
      bestLapSeconds: best?.bestLapSeconds ?? null,
      bestYmd: best?.ymd ?? null,
    });
  }
  venues.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

  /* ── six-up strip, with the same figures for the prior year ── */
  function stripFor(scopeYear: number | null) {
    const evs = allEvents.filter(
      (e) => (scopeYear == null || yearOf(e.startYmd) === scopeYear) && e.status === "logged"
    );
    const rs = runs.filter((r) => scopeYear == null || yearOf(r.ymd) === scopeYear);
    const days = new Set<string>();
    for (const e of evs) {
      for (let i = 0; i < e.dayCount; i++) days.add(addDays(e.startYmd, i));
    }
    // A test session with no event attached is still a day on track.
    for (const r of rs) days.add(r.ymd);
    /* Season best comes from runs WITH a track, so it is always the fastest of the venue
       bests printed directly below it. A trackless run cannot be compared to anything —
       that is the app's own comparability rule, not a convenience — and letting one in
       put an 8.165 in this account's headline while no venue on the page was faster
       than 15.5. */
    const timed = rs
      .filter((r) => r.trackId)
      .map((r) => r.bestLapSeconds)
      .filter((n): n is number => n != null);
    return {
      events: evs.length,
      daysOnTrack: days.size,
      laps: rs.reduce((sum, r) => sum + r.lapCount, 0),
      wheelSeconds: rs.reduce((sum, r) => sum + r.wheelSeconds, 0),
      venues: new Set(rs.map((r) => r.trackId).filter(Boolean)).size,
      bestLapSeconds: timed.length ? Math.min(...timed) : null,
    };
  }

  const current = stripFor(year);
  // "All time" has nothing to compare against; a year compares to the one before it.
  const previous = year == null ? null : stripFor(year - 1);
  const hasPrior = previous != null && previous.events + previous.laps > 0;

  const strip: SeasonStrip = {
    events: { value: current.events, prior: hasPrior ? previous.events : null },
    daysOnTrack: { value: current.daysOnTrack, prior: hasPrior ? previous.daysOnTrack : null },
    laps: { value: current.laps, prior: hasPrior ? previous.laps : null },
    wheelSeconds: { value: current.wheelSeconds, prior: hasPrior ? previous.wheelSeconds : null },
    venues: { value: current.venues, prior: hasPrior ? previous.venues : null },
    bestLapSeconds: {
      value: current.bestLapSeconds,
      prior: hasPrior ? previous.bestLapSeconds : null,
    },
    truncated: runRows.length >= RUN_SCAN_CAP,
  };

  /* ── next up, or the cadence read that stands in for it ── */
  // Deliberately read off ALL events, not the scoped ones: what is next does not change
  // because you flipped the timeline to last year.
  const nextEvent = allEvents
    .filter((e) => e.status === "booked")
    .sort((a, b) => a.startYmd.localeCompare(b.startYmd))[0];

  let nextUp: NextUp | null = null;
  if (nextEvent) {
    const here = nextEvent.trackId
      ? runs.filter((r) => r.trackId === nextEvent.trackId && r.ymd < nextEvent.startYmd)
      : [];
    const lastHere = here.reduce<RunFacts | null>(
      (latest, r) => (!latest || r.ymd > latest.ymd ? r : latest),
      null
    );
    nextUp = {
      event: nextEvent,
      daysUntil: Math.max(0, daysBetween(todayYmd, nextEvent.startYmd)),
      toBeatSeconds: venueBestBefore(nextEvent.trackId, nextEvent.startYmd),
      // Days you turned a wheel there, lifetime — the same unit the records card counts
      // in, so the two cards cannot print different numbers for the same venue. Lifetime
      // rather than scoped, to pair with `toBeatSeconds`, which is also lifetime.
      visitsHere: new Set(here.map((r) => r.ymd)).size,
      carriedSetup: lastHere ? { carName: lastHere.carName, ymd: lastHere.ymd } : null,
      openTestPlanCount,
    };
  }

  const cadence = nextUp ? null : buildCadenceRead(allEvents, todayYmd);

  return {
    scope: { year },
    years,
    events,
    booked,
    logged,
    venues,
    strip,
    nextUp,
    cadence,
    todayYmd,
  };
}
