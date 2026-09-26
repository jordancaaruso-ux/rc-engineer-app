import "server-only";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, SessionType, TrackDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getLiveRcDriverIdSetting, getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { isDateOnlyTrackTime } from "@/lib/lapImport/trackClock";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { withTireRunNumberInSnapshot } from "@/lib/tires/cascadeTireRunNumber";
import { importedSessionInstantToReal } from "@/lib/runSessionCompletedAt";
import { runLocalDayKey } from "@/lib/runs/buildRunHistoryGroups";
import { planBackfilledRuns, type BackfillPlanRun } from "@/lib/runs/planBackfilledRuns";
import {
  planBackfillOutings,
  type BackfillHostRun,
  type BackfillOutingSession,
} from "@/lib/runs/backfillOutingFold";
import {
  trackClockOutingFromImportedRow,
  trackClockSpanForExistingRun,
} from "@/lib/runs/outingsFromImportedSessions";
import { isValidIanaTimeZone, timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";
import { buildRunLapMaterial } from "@/lib/runs/importedSessionLapMaterial";
import { writeRunImportedLapSets } from "@/lib/runs/writeRunImportedLapSets";
import { backfillRunConditionsFromTrack } from "@/lib/weather/backfillRunConditionsFromTrack";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";

/** Matches the import endpoint's cap; nobody logs more heats than this in a day. */
const MAX_BACKFILL_SESSIONS = 20;

export type BackfillSkipReason =
  | "not_found"
  | "already_linked"
  | "no_time"
  | "no_laps"
  /** Same time on track as a run that exists (or one made here): linked to it, not a run of its own. */
  | "same_outing";

export type CreateBackfilledRunsResult = {
  created: Array<{ runId: string; importedLapTimeSessionId: string }>;
  skipped: Array<{ importedLapTimeSessionId: string; reason: BackfillSkipReason }>;
};

const EMPTY: CreateBackfilledRunsResult = { created: [], skipped: [] };

/**
 * Where a backfilled run's context comes from.
 *
 * `parent` — the lap step's "Add N other runs from today": car, track, event and session type
 *   come from the run the driver just saved.
 * `track` — the timing sweep: nobody saved anything; the car was resolved by `resolveSweepCar`
 *   (a fact, never a guess) and the track is where the timing site saw the chip. Setup and tyres
 *   still come from the nearest earlier logged run that day when there is one, and from nothing
 *   otherwise — never from another day ("people change cars between weeks").
 */
export type BackfillContext =
  | { kind: "parent"; parentRunId: string }
  | {
      kind: "track";
      trackId: string;
      carId: string;
      /** The track's zone — the sweep has no device. */
      zone: string | null;
      eventId?: string | null;
      sessionType?: SessionType;
      meetingSessionType?: string | null;
    };

type ContextRecord = {
  /** Null for a track context: there is no run to anchor the day on. */
  parentRunId: string | null;
  carId: string;
  carNameSnapshot: string | null;
  sessionType: SessionType;
  meetingSessionType: string | null;
  eventId: string | null;
  trackId: string | null;
  trackNameSnapshot: string | null;
  trackLayoutId: string | null;
  trackLayoutNameSnapshot: string | null;
  trackDirection: TrackDirection | null;
  raceClass: string | null;
  practiceDayUrl: string | null;
  shareWithTeam: boolean;
  localTimeZone: string | null;
  createdAt: Date | null;
  sortAt: Date | null;
  sessionCompletedAt: Date | null;
  track: { latitude: number | null; longitude: number | null; timeZone: string | null } | null;
};

async function resolveContext(userId: string, context: BackfillContext): Promise<ContextRecord | null> {
  if (context.kind === "parent") {
    const parent = await prisma.run.findFirst({
      where: { id: context.parentRunId, userId },
      select: {
        id: true,
        carId: true,
        carNameSnapshot: true,
        sessionType: true,
        meetingSessionType: true,
        eventId: true,
        trackId: true,
        trackNameSnapshot: true,
        trackLayoutId: true,
        trackLayoutNameSnapshot: true,
        trackDirection: true,
        raceClass: true,
        practiceDayUrl: true,
        shareWithTeam: true,
        localTimeZone: true,
        createdAt: true,
        sortAt: true,
        sessionCompletedAt: true,
        track: { select: { latitude: true, longitude: true, timeZone: true } },
      },
    });
    if (!parent || !parent.carId) return null;
    return { ...parent, carId: parent.carId, parentRunId: parent.id };
  }

  const [track, car] = await Promise.all([
    prisma.track.findUnique({
      where: { id: context.trackId },
      select: { id: true, name: true, latitude: true, longitude: true, timeZone: true },
    }),
    prisma.car.findFirst({ where: { id: context.carId, userId }, select: { id: true, name: true } }),
  ]);
  if (!track || !car) return null;
  return {
    parentRunId: null,
    carId: car.id,
    carNameSnapshot: car.name,
    sessionType: context.sessionType ?? "TESTING",
    meetingSessionType: context.meetingSessionType ?? null,
    eventId: context.eventId ?? null,
    trackId: track.id,
    trackNameSnapshot: track.name,
    trackLayoutId: null,
    trackLayoutNameSnapshot: null,
    trackDirection: null,
    raceClass: null,
    practiceDayUrl: null,
    shareWithTeam: true,
    localTimeZone: context.zone,
    createdAt: null,
    sortAt: null,
    sessionCompletedAt: null,
    track: { latitude: track.latitude, longitude: track.longitude, timeZone: track.timeZone },
  };
}

/** The planner's stand-in when no logged run anchors the day: no rubber, sits before everything. */
const SYNTHETIC_SOURCE_ID = "__no_logged_run__";

/**
 * Turn timing sessions into runs the driver did not log.
 *
 * The lap step's "Add N other runs from today" (founder ruling 2026-09-14) and the runs the driver
 * ticks in the "runs you didn't log" sheet (2026-09-18; the sweep filed them unasked before) share this. Each session becomes a real run with its laps, filed at
 * its own on-track instant so the day reads in order, and stamped `unconfirmedAt` so every list,
 * the Engineer and the setup stats know the driver did not log it. Setup and tyres come from the
 * nearest earlier logged run that day (see `planBackfilledRuns`), else from the parent, else — a
 * ticked run on a day with nothing logged — from nothing at all. Idempotent: a session
 * already on a run is skipped, and the claim on the session row is made inside the same
 * transaction as the run, so two callers racing for one session produce one run.
 */
export async function createBackfilledRuns(params: {
  userId: string;
  context: BackfillContext;
  importedLapTimeSessionIds: readonly string[];
  /** The saving device's zone — only a fallback when the context carries none. */
  deviceTimeZone: string | null;
  /** Stamp `filedBySweepAt`: the timing sweep, not the lap step, made these. */
  filedBySweep?: boolean;
}): Promise<CreateBackfilledRunsResult> {
  const ids = [
    ...new Set(
      params.importedLapTimeSessionIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ),
  ].slice(0, MAX_BACKFILL_SESSIONS);
  if (ids.length === 0) return EMPTY;

  const ctx = await resolveContext(params.userId, params.context);
  if (!ctx) return EMPTY;

  const zone = ctx.localTimeZone ?? params.deviceTimeZone ?? null;

  const sessions = await prisma.importedLapTimeSession.findMany({
    where: { id: { in: ids }, userId: params.userId },
    select: {
      id: true,
      sourceUrl: true,
      parserId: true,
      parsedPayload: true,
      sessionCompletedAt: true,
      linkedRunId: true,
      createdAt: true,
    },
  });
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const result: CreateBackfilledRunsResult = { created: [], skipped: [] };
  const plannable: Array<{
    id: string;
    instant: Date;
    session: (typeof sessions)[number];
    /** The site gave only the day (`isDateOnlyTrackTime`): no time on track to share with anything. */
    dateOnly: boolean;
  }> = [];
  for (const id of ids) {
    const session = sessionById.get(id);
    if (!session) {
      result.skipped.push({ importedLapTimeSessionId: id, reason: "not_found" });
      continue;
    }
    // The parent's own session lands here too: `linkImportedSessionsToRun` ran before us.
    if (session.linkedRunId) {
      result.skipped.push({ importedLapTimeSessionId: id, reason: "already_linked" });
      continue;
    }
    const rawIso =
      session.sessionCompletedAt?.toISOString() ??
      sessionCompletedAtIsoFromImportedPayload(session.parsedPayload);
    if (!rawIso) {
      result.skipped.push({ importedLapTimeSessionId: id, reason: "no_time" });
      continue;
    }
    // LiveRC/MyRCM store the track's wall clock as-if-UTC; Speedhive is a real instant already.
    const instant = importedSessionInstantToReal(new Date(rawIso), session.sourceUrl, zone);
    const dateOnly = isDateOnlyTrackTime({
      iso: rawIso,
      parserId: session.parserId,
      sourceUrl: session.sourceUrl,
    });
    plannable.push({ id, instant, session, dateOnly });
  }
  if (plannable.length === 0) return result;

  // The day is anchored on the parent when there is one, else on the earliest session filed.
  const earliestSession = plannable.reduce((a, b) => (a.instant < b.instant ? a : b));
  const centreInstant = ctx.sessionCompletedAt ?? ctx.sortAt ?? earliestSession.instant;
  const dayKey = runLocalDayKey(
    {
      createdAt: ctx.createdAt ?? centreInstant,
      sortAt: centreInstant,
      localTimeZone: zone,
      userId: params.userId,
    },
    { viewerTimeZone: zone }
  );

  // The day's logged runs on this car — setup sources. Confirmed only: a run the app backfilled
  // earlier would be a guess feeding a guess.
  const windowMs = 36 * 60 * 60 * 1000;
  const dayRunsRaw = await prisma.run.findMany({
    where: {
      userId: params.userId,
      carId: ctx.carId,
      unconfirmedAt: null,
      sortAt: {
        gte: new Date(centreInstant.getTime() - windowMs),
        lte: new Date(centreInstant.getTime() + windowMs),
      },
    },
    select: {
      id: true,
      createdAt: true,
      sortAt: true,
      sessionCompletedAt: true,
      localTimeZone: true,
      tireTypeId: true,
      tireStintId: true,
      tireRunNumber: true,
      tireAgeKnown: true,
      // A front/rear car's other end, and what both ends are glued to — copied like the rest.
      frontTireTypeId: true,
      frontTireStintId: true,
      frontTireRunNumber: true,
      frontTireAgeKnown: true,
      tireFitment: true,
      additiveTypeId: true,
      warmerTimingMinutes: true,
      tirePrep: true,
      sourceSetupDocumentId: true,
      sourceSetupCalibrationId: true,
      setupSnapshotId: true,
      setupSnapshot: { select: { data: true, sheetBlankId: true } },
    },
  });
  const dayRuns = dayRunsRaw.filter(
    (r) =>
      runLocalDayKey(
        { createdAt: r.createdAt, sortAt: r.sortAt, localTimeZone: r.localTimeZone ?? zone, userId: params.userId },
        { viewerTimeZone: zone }
      ) === dayKey
  );
  const sourceById = new Map(dayRuns.map((r) => [r.id, r]));
  const parentSource = ctx.parentRunId ? sourceById.get(ctx.parentRunId) : undefined;
  if (ctx.parentRunId && !parentSource) {
    // The parent is always a legitimate source. Missing here only if the window missed it
    // (it can't — it is the window's centre) or it was itself unconfirmed, which a save clears.
    return result;
  }

  // One run per time on track (founder ruling 2026-09-15). The same heat from two timing sites,
  // or a practice run the feed split at a pit stop, is ONE outing: windows that overlap group,
  // the official record leads, the rest ride along as linked sources (`groupOutings`).
  //
  // Judged on the track's own clock, which every timing site posts (`lapImport/trackClock.ts`):
  // the driver saving this may be home from the meeting, and their phone's zone is not the track's.
  // Only a practice import saved without the track's offset needs a zone, and the track's beats
  // the one the day was logged in.
  const trackZone = ctx.track?.timeZone;
  const fallbackZone =
    (isValidIanaTimeZone(trackZone) ? trackZone.trim() : null) ??
    timeZoneForCoordinates(ctx.track?.latitude, ctx.track?.longitude) ??
    zone;
  const plannableById = new Map(plannable.map((p) => [p.id, p]));
  // A session with only a date is an outing of its own, never grouped (`backfillOutingFold.ts`).
  const outingSessions: BackfillOutingSession[] = plannable.map((p) => ({
    session: trackClockOutingFromImportedRow(p.session, fallbackZone) ?? {
      id: p.id,
      kind: "practice" as const,
      start: p.instant,
      end: p.instant,
      driverCount: 0,
      lapCount: 0,
    },
    dateOnly: p.dateOnly,
  }));

  // An outing that overlaps a run the driver already has today at this track — the parent being
  // saved included — joins that run instead of opening a second one. Only when both have a time
  // on track: a session or a run known only by its date joins nothing and hosts nothing.
  const hostRuns: BackfillHostRun[] = [];
  if (ctx.trackId) {
    const existing = await prisma.run.findMany({
      where: {
        userId: params.userId,
        trackId: ctx.trackId,
        // By when it was on track as well as where it sorts: a race logged days later from a
        // results file sorts on the day it was logged, and must still host its own copies.
        OR: [
          {
            sortAt: {
              gte: new Date(centreInstant.getTime() - windowMs),
              lte: new Date(centreInstant.getTime() + windowMs),
            },
          },
          {
            sessionCompletedAt: {
              gte: new Date(centreInstant.getTime() - windowMs),
              lte: new Date(centreInstant.getTime() + windowMs),
            },
          },
        ],
      },
      select: {
        id: true,
        sortAt: true,
        sessionCompletedAt: true,
        lapTimes: true,
        localTimeZone: true,
        detectedImportedLapSession: {
          select: { id: true, sourceUrl: true, parserId: true, parsedPayload: true, sessionCompletedAt: true },
        },
      },
    });
    for (const r of existing) {
      const span = trackClockSpanForExistingRun(r, fallbackZone);
      if (!span) continue;
      const s = r.detectedImportedLapSession;
      hostRuns.push({
        id: r.id,
        span,
        dateOnly: s
          ? isDateOnlyTrackTime({
              iso: s.sessionCompletedAt?.toISOString() ?? sessionCompletedAtIsoFromImportedPayload(s.parsedPayload),
              parserId: s.parserId,
              sourceUrl: s.sourceUrl,
            })
          : false,
      });
    }
  }
  const { standalone, joined } = planBackfillOutings(outingSessions, hostRuns);
  for (const { runId, outing } of joined) {
    await prisma.importedLapTimeSession.updateMany({
      where: { id: { in: outing.sessionIds }, userId: params.userId, linkedRunId: null },
      data: { linkedRunId: runId },
    });
    for (const id of outing.sessionIds) {
      result.skipped.push({ importedLapTimeSessionId: id, reason: "same_outing" });
    }
  }
  if (standalone.length === 0) return result;
  const secondariesByPrimary = new Map(
    standalone.map((o) => [o.primaryId, o.sessionIds.filter((id) => id !== o.primaryId)])
  );

  const toPlanRun = (r: (typeof dayRuns)[number]): BackfillPlanRun => ({
    id: r.id,
    instant: r.sessionCompletedAt ?? r.sortAt,
    tireStintId: r.tireStintId,
    tireRunNumber: r.tireRunNumber,
    frontTireStintId: r.frontTireStintId,
    frontTireRunNumber: r.frontTireRunNumber,
  });
  const planParent: BackfillPlanRun = parentSource
    ? toPlanRun(parentSource)
    : {
        id: SYNTHETIC_SOURCE_ID,
        instant: new Date(earliestSession.instant.getTime() - 1),
        tireStintId: null,
        tireRunNumber: 1,
      };
  const plan = planBackfilledRuns({
    parent: planParent,
    confirmedDayRuns: dayRuns.map(toPlanRun),
    sessions: standalone.map((o) => ({ id: o.primaryId, instant: plannableById.get(o.primaryId)!.instant })),
  });

  const [liveRcDriverName, liveRcDriverId] = await Promise.all([
    getLiveRcDriverNameSetting(params.userId),
    getLiveRcDriverIdSetting(params.userId),
  ]);

  // Weather for every run in one wave — best effort, and never the reason a save fails.
  const canFetchWeather = ctx.track ? trackHasMarkedLocation(ctx.track) : false;
  const conditionsByPlanIndex = await Promise.all(
    plan.map((entry) =>
      // A run known only by its date has no hour to ask the weather about; midnight's is not it.
      canFetchWeather && !plannableById.get(entry.sessionId)?.dateOnly
        ? backfillRunConditionsFromTrack({
            latitude: ctx.track!.latitude!,
            longitude: ctx.track!.longitude!,
            atIso: entry.instant.toISOString(),
          })
        : Promise.resolve(null)
    )
  );

  const now = new Date();
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i]!;
    const planned = plannable.find((p) => p.id === entry.sessionId)!;
    const session = planned.session;
    // Null only for a ticked run on a day with nothing logged: no setup, no rubber.
    const source = sourceById.get(entry.setupSourceRunId) ?? parentSource ?? null;

    const material = buildRunLapMaterial(session, {
      liveRcDriverId,
      liveRcDriverName,
      eventId: ctx.eventId,
    });
    if (!material) {
      result.skipped.push({ importedLapTimeSessionId: session.id, reason: "no_laps" });
      continue;
    }
    const { lapTimes, lapSession, lapSummary, lapSets } = material;

    const baseData = normalizeSetupSnapshotForStorage(source?.setupSnapshot.data ?? {});
    const setupData = withTireRunNumberInSnapshot(baseData, entry.tireRunNumber) ?? baseData;
    const conditions = conditionsByPlanIndex[i] ?? null;

    try {
      const runId = await prisma.$transaction(async (tx) => {
        const snapshot = await tx.setupSnapshot.create({
          data: {
            userId: params.userId,
            carId: ctx.carId,
            data: setupData as object,
            baseSetupSnapshotId: source?.setupSnapshotId ?? null,
            sheetBlankId: source?.setupSnapshot.sheetBlankId ?? null,
          },
          select: { id: true },
        });
        const run = await tx.run.create({
          data: {
            userId: params.userId,
            carId: ctx.carId,
            carNameSnapshot: ctx.carNameSnapshot,
            localTimeZone: zone,
            // Session type is a day fact; the meeting code ("Q2") and label name ONE session and
            // would be wrong on every other, so they stay null and the run is named by position.
            sessionType: ctx.sessionType,
            meetingSessionType: ctx.meetingSessionType,
            meetingSessionCode: null,
            eventId: ctx.eventId,
            trackId: ctx.trackId,
            trackNameSnapshot: ctx.trackNameSnapshot,
            trackLayoutId: ctx.trackLayoutId,
            trackLayoutNameSnapshot: ctx.trackLayoutNameSnapshot,
            trackDirection: ctx.trackDirection,
            tireTypeId: source?.tireTypeId ?? null,
            tireStintId: source?.tireStintId ?? null,
            tireAgeKnown: source?.tireAgeKnown ?? true,
            tireRunNumber: entry.tireRunNumber,
            frontTireTypeId: source?.frontTireTypeId ?? null,
            frontTireStintId: source?.frontTireTypeId ? (source.frontTireStintId ?? null) : null,
            frontTireAgeKnown: source?.frontTireTypeId ? (source.frontTireAgeKnown ?? true) : null,
            frontTireRunNumber: source?.frontTireTypeId ? (entry.frontTireRunNumber ?? 1) : null,
            ...(source?.tireFitment != null
              ? { tireFitment: source.tireFitment as PrismaTypes.InputJsonValue }
              : {}),
            additiveTypeId: source?.additiveTypeId ?? null,
            warmerTimingMinutes: source?.warmerTimingMinutes ?? null,
            tirePrep: (source?.tirePrep ?? []) as PrismaTypes.InputJsonValue,
            setupSnapshotId: snapshot.id,
            sourceSetupDocumentId: source?.sourceSetupDocumentId ?? null,
            sourceSetupCalibrationId: source?.sourceSetupCalibrationId ?? null,
            lapTimes,
            lapSession: lapSession as unknown as PrismaTypes.InputJsonValue,
            bestLapSeconds: lapSummary.bestLapSeconds,
            avgTop5LapSeconds: lapSummary.avgTop5LapSeconds,
            notes: null,
            driverNotes: null,
            handlingProblems: null,
            handlingAssessmentJson: Prisma.JsonNull,
            carRating: null,
            sessionLabel: null,
            raceClass: ctx.raceClass,
            practiceDayUrl: ctx.practiceDayUrl,
            // Filed at its own on-track instant so the day reads in order and the row prints the
            // heat's time. `createdAt` stays honest: this row was written now.
            sortAt: entry.instant,
            sessionCompletedAt: entry.instant,
            loggingComplete: true,
            loggingCompletedAt: now,
            unconfirmedAt: now,
            filedBySweepAt: params.filedBySweep ? now : null,
            shareWithTeam: ctx.shareWithTeam,
            importedLapTimeSessionId: session.id,
            ...(conditions ?? {}),
          } as PrismaTypes.RunUncheckedCreateInput,
          select: { id: true },
        });
        // Claim the session inside the same transaction: two callers racing for it get one run.
        const claimed = await tx.importedLapTimeSession.updateMany({
          where: { id: session.id, userId: params.userId, linkedRunId: null },
          data: { linkedRunId: run.id },
        });
        if (claimed.count !== 1) {
          throw new SessionAlreadyClaimed();
        }
        await writeRunImportedLapSets(tx, run.id, lapSets);
        // The outing's other sources ride along; the run's laps stay the primary's.
        const secondaries = secondariesByPrimary.get(session.id) ?? [];
        if (secondaries.length > 0) {
          await tx.importedLapTimeSession.updateMany({
            where: { id: { in: secondaries }, userId: params.userId, linkedRunId: null },
            data: { linkedRunId: run.id },
          });
        }
        return run.id;
      });
      result.created.push({ runId, importedLapTimeSessionId: session.id });
      for (const id of secondariesByPrimary.get(session.id) ?? []) {
        result.skipped.push({ importedLapTimeSessionId: id, reason: "same_outing" });
      }
    } catch (err) {
      const unique =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (err instanceof SessionAlreadyClaimed || unique) {
        result.skipped.push({ importedLapTimeSessionId: session.id, reason: "already_linked" });
        continue;
      }
      throw err;
    }
  }

  return result;
}

class SessionAlreadyClaimed extends Error {
  constructor() {
    super("imported lap session already linked to a run");
  }
}
