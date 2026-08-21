import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildLapSessionV1 } from "@/lib/lapSession/buildSession";
import type { LapSourceKind } from "@/lib/lapSession/types";
import { computePersistedRunLapSummary } from "@/lib/lapAnalysis";
import {
  computeSetupDeltaForAudit,
  resolveSetupSnapshot,
} from "@/lib/setup/resolveSetupSnapshot";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import {
  applyRunContextToSetupSnapshot,
  parseWarmerTimingMinutes,
} from "@/lib/runs/applyRunContextToSetupSnapshot";
import { normalizeTirePrep, derivedWarmerTimingMinutes } from "@/lib/runs/tirePrep";
import { applyTireRunNumberCascade } from "@/lib/tires/applyTireRunNumberCascade";
import { getSetupSheetFieldKeysForCarRow } from "@/lib/runs/setupSheetFieldKeysForCar";
import { resolveSourcePdfLinksForNewRun } from "@/lib/setup/ensureRunSetupPdf";
import { linkImportedSessionsToRun } from "@/lib/lapImport/service";
import { resolveRunSessionCompletedAtFromUpsertBody } from "@/lib/runSessionCompletedAt";
import { getTimeZoneFromCookies } from "@/lib/requestTimeZone";
import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";
import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";
import { ensureEventParticipation, userMayJoinEvent } from "@/lib/events/eventParticipation";
import {
  normalizeRunConditionsInput,
  NULL_RUN_CONDITIONS_COLUMNS,
  type RunConditionsRecord,
} from "@/lib/weather/runConditionsRecord";
import { fetchRunConditionsFromOpenMeteo } from "@/lib/weather/openMeteo";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";

type RunUpsertBody = {
  runId?: string;
  carId?: string;
  sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  trackId?: string | null;
  trackLayoutId?: string | null;
  trackDirection?: "CW" | "CCW" | null;
  tireTypeId?: string | null;
  /**
   * Null means different rubber went on — the server mints a fresh stint. On an
   * update that keeps the same compound the stored stint is kept instead: there,
   * a changed count is a correction, not a tire change.
   */
  tireStintId?: string | null;
  /** False when the driver said "not sure how many runs" (e.g. a set they were given). */
  tireAgeKnown?: boolean;
  tireRunNumber?: number;
  additiveTypeId?: string | null;
  warmerTimingMinutes?: number | null;
  /** Ordered tire-prep applications (see src/lib/runs/tirePrep.ts). */
  tirePrep?: unknown;
  setupData?: unknown;
  /** When set, server merges setupData onto this snapshot (full or sparse) and stores audit delta. */
  setupBaselineSnapshotId?: string | null;
  /** If true, only setupDelta keys are merged onto baseline (sparse “changed fields” mode). */
  setupDeltaOnly?: boolean;
  setupDelta?: Record<string, unknown> | null;
  /** Setup document id when setup was loaded from a downloaded PDF (PDF render lineage). */
  sourceSetupDocumentId?: string | null;
  lapTimes?: number[];
  /** Optional; server builds canonical lapSession from lapTimes + this meta. */
  lapIngestMeta?: {
    sourceKind?: string;
    sourceDetail?: string | null;
    parserId?: string | null;
    perLap?: Array<{
      isOutlierWarning?: boolean;
      warningReason?: string | null;
      isFlagged?: boolean;
      flagReason?: string | null;
      isIncluded?: boolean;
    } | null> | null;
  };
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  /** Pre–next-run reminders; same bullet format as `suggestedChanges`. */
  suggestedPreRun?: string | null;
  sessionLabel?: string | null;
  /** Race class for this session (e.g. \"17.5 Stock\"); complements event.raceClass when set. */
  raceClass?: string | null;
  /** Optional LiveRC practice day URL captured while logging the run. */
  practiceDayUrl?: string | null;
  importedLapSets?: Array<{
    sourceUrl?: string | null;
    driverId?: string | null;
    driverName?: string;
    normalizedName?: string;
    isPrimaryUser?: boolean;
    /** UTC ISO instant from timing page when known. */
    sessionCompletedAt?: string | null;
    /** True when `sessionCompletedAt` is on-track wall clock (LiveRC/MyRCM store as-if-UTC) vs import-time fallback. */
    sessionCompletedAtIsWallClock?: boolean;
    laps?: number[] | Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
  }>;
  /** Optional: link persisted ImportedLapTimeSession rows from URL import(s) to this run. */
  importedLapTimeSessionIds?: string[];
  /**
   * `draft` = save progress without marking logging complete.
   * Omitted or `completed` = treat as logging complete (backward compatible).
   * On PUT, if the run was already `loggingComplete`, `draft` is ignored: logging stays complete.
   */
  loggingIntent?: "draft" | "completed";
  /** True when opening Log your run from dashboard detected-session prefill (metadata only; does not affect completion). */
  fromEventDetection?: boolean;
  /** Optional structured handling assessment (versioned JSON). */
  handlingAssessmentJson?: unknown;
  /**
   * Overall car rating 1-10 captured at "Run complete". Required when `loggingIntent`
   * is `completed` (or when editing an already-completed run); drafts may omit it.
   * Anchors the Engineer's runQuality signal and known-good / known-bad memory.
   */
  carRating?: number | null;
  /**
   * When false, team members will not see this run in team Sessions or any Engineer peer path.
   * There is no peer type that bypasses this. Default true when omitted.
   */
  shareWithTeam?: boolean;
  /**
   * Weather / conditions captured for this session (metric `RunConditions` shape).
   * Present-but-empty (or null) clears the stored reading on update; absent leaves it unchanged.
   */
  conditions?: unknown;
};

/**
 * Effortless-capture backfill: fetch run conditions server-side for a pinned
 * track when the client attached none (fast save, a transient weather-fetch
 * failure, or the client fetch simply not landing before submit). Reuses the
 * client's normalize/clamp path so stored columns match a client-side capture,
 * and preserves the Open-Meteo source stamp. Best-effort — any failure
 * (network, no reading for that time/place) resolves to null and the run saves
 * without conditions, exactly as before.
 */
async function backfillRunConditionsFromTrack(params: {
  latitude: number;
  longitude: number;
  atIso: string | null;
}): Promise<RunConditionsRecord | null> {
  try {
    const conditions = await fetchRunConditionsFromOpenMeteo({
      latitude: params.latitude,
      longitude: params.longitude,
      atIso: params.atIso,
    });
    return normalizeRunConditionsInput(conditions);
  } catch {
    return null;
  }
}

function normalizeCarRating(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1 || rounded > 10) return null;
  return rounded;
}

function prismaJsonFromHandlingBody(raw: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const parsed = parseHandlingAssessmentJson(raw);
  return parsed === null ? Prisma.JsonNull : (parsed as Prisma.InputJsonValue);
}

async function createOrUpdateRun(params: { userId: string; body: RunUpsertBody; mode: "create" | "update" }) {
  const body = params.body;
  const carId = body.carId;
  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  // The logging device's zone, used twice: to resolve the session's wall time, and —
  // stamped onto the run — to decide which calendar day the run belongs to for anyone
  // who later reads it. See `Run.localTimeZone`.
  const deviceTimeZone = await getTimeZoneFromCookies();

  const sessionCompletedAtResolved = await resolveRunSessionCompletedAtFromUpsertBody(params.userId, body, {
    userTimeZone: deviceTimeZone,
  });

  let existingUpdate: {
    id: string;
    createdAt: Date;
    loggingComplete: boolean;
    loggingCompletedAt: Date | null;
    tireRunNumber: number;
    tireTypeId: string | null;
    tireStintId: string | null;
    sortAt: Date;
  } | null = null;
  if (params.mode === "update") {
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    const ex = await prisma.run.findFirst({
      where: { id: runId, userId: params.userId },
      select: {
        id: true,
        createdAt: true,
        loggingComplete: true,
        loggingCompletedAt: true,
        tireRunNumber: true,
        // The stored tire identity: what the correction below is measured against,
        // and what keeps an edit on the stint it already belongs to.
        tireTypeId: true,
        tireStintId: true,
        sortAt: true,
      },
    });
    if (!ex) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    existingUpdate = ex;
  }

  /** Editing a run already marked complete never reverts it to draft. */
  const loggingWasAlreadyComplete = existingUpdate?.loggingComplete === true;
  const loggingComplete = loggingWasAlreadyComplete ? true : body.loggingIntent !== "draft";

  const carRatingNormalized = normalizeCarRating(body.carRating);
  // Required when the run is logged complete (new or edit). Drafts stay loose.
  if (loggingComplete && carRatingNormalized == null) {
    return NextResponse.json(
      { error: "carRating (1-10) is required to mark a run complete" },
      { status: 400 }
    );
  }

  // Store exactly what the driver answered. Completion used to seed a neutral
  // "feel vs last run" on a car's first outing — a leftover from when that pick was
  // required and had nothing to compare against. The pick is retired, so the seed only
  // manufactured an answer: it reached the Engineer as "Feel vs last run: same" for a
  // run with no previous outing, and lit up a phantom option in "which mattered most".
  // Absent now stays absent, which every reader already handles as unknown.
  let handlingAssessmentForSave: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  if (loggingComplete || "handlingAssessmentJson" in body) {
    handlingAssessmentForSave = prismaJsonFromHandlingBody(body.handlingAssessmentJson ?? null);
  }

  const shareWithTeam = body.shareWithTeam === false ? false : true;

  // Weather conditions: normalize + clamp untrusted input. `null` when the key
  // is absent (leave unchanged on update); an all-null record when sent empty
  // (clears the stored reading on update). `normalizedConditions` is non-null
  // only when the client actually attached a reading — the signal for whether
  // server-side backfill should kick in (below, after the track is resolved).
  const normalizedConditions =
    "conditions" in body ? normalizeRunConditionsInput(body.conditions) : null;
  let conditionsColumns: RunConditionsRecord | null =
    "conditions" in body ? (normalizedConditions ?? NULL_RUN_CONDITIONS_COLUMNS) : null;

  /**
   * How many runs are on the rubber.
   *
   * A completed run used to have this frozen at whatever the database already
   * held (`a227467`), so a driver correcting the count from the edit wizard
   * watched the save succeed and change nothing. The count is a fact about the
   * session like any other and is editable for the life of the run.
   *
   * What that guard was actually worth keeping is the case below: a body that
   * says nothing about tires must not reset the run to 1. Absent now means
   * "leave it", which is what every other optional field on an update does.
   */
  const tireRunNumberFromBody =
    typeof body.tireRunNumber === "number" && Number.isFinite(body.tireRunNumber)
      ? Math.max(1, Math.floor(body.tireRunNumber))
      : null;

  const tireRunNumber =
    tireRunNumberFromBody ??
    (existingUpdate ? Math.max(1, Math.floor(Number(existingUpdate.tireRunNumber) || 1)) : 1);

  const lapTimes = Array.isArray(body.lapTimes)
    ? body.lapTimes.filter((n) => typeof n === "number" && Number.isFinite(n))
    : [];

  const rawKind = body.lapIngestMeta?.sourceKind;
  const sourceKind: LapSourceKind =
    rawKind === "screenshot" || rawKind === "url" || rawKind === "csv" || rawKind === "manual"
      ? rawKind
      : "manual";

  const lapSession = buildLapSessionV1({
    laps: lapTimes,
    sourceKind,
    sourceDetail: body.lapIngestMeta?.sourceDetail ?? null,
    parserId: body.lapIngestMeta?.parserId ?? null,
    context: {
      eventId: body.eventId ?? null,
      sessionLabel: body.sessionLabel?.trim() || null,
    },
    perLap: body.lapIngestMeta?.perLap ?? null,
  });

  // Materialize lap summary metrics so list views (Sessions / dashboard) can
  // read `bestLapSeconds` / `avgTop5LapSeconds` directly instead of
  // recomputing from the JSON lap arrays for every row.
  const lapSummary = computePersistedRunLapSummary({ lapTimes, lapSession });

  const baselineId =
    typeof body.setupBaselineSnapshotId === "string" && body.setupBaselineSnapshotId.trim()
      ? body.setupBaselineSnapshotId.trim()
      : null;

  // Hoisted above the lookup wave below — pure string parsing off the body, no I/O.
  const tireTypeId =
    typeof body.tireTypeId === "string" && body.tireTypeId.trim() ? body.tireTypeId.trim() : null;
  const additiveTypeId =
    typeof body.additiveTypeId === "string" && body.additiveTypeId.trim()
      ? body.additiveTypeId.trim()
      : null;
  const needsParticipationCheck =
    loggingComplete && Boolean(body.eventId) && body.sessionType === "RACE_MEETING";

  /*
   * One wave instead of eight sequential round trips.
   *
   * Every lookup here is derived from `body` alone — baseline snapshot, PDF links, tire
   * type, additive type, event participation, car, track — so none of them had a reason
   * to queue behind the others. At ~16ms per round trip that was roughly 130ms of a run
   * save spent purely waiting on the network.
   *
   * Validation still happens below in the original order, so which error a bad request
   * gets back is unchanged; it just does its lookups concurrently before returning.
   *
   * The car row is read ONCE. It used to be fetched twice from the same table by the
   * same key — once for the setup-sheet keys, once for the name.
   */
  const [baselineRow, pdfLinks, tireType, additiveType, participation, carRow, track] =
    await Promise.all([
      baselineId
        ? prisma.setupSnapshot.findFirst({
            where: { id: baselineId, userId: params.userId },
            select: { data: true },
          })
        : null,
      resolveSourcePdfLinksForNewRun(
        params.userId,
        baselineId,
        typeof body.sourceSetupDocumentId === "string" && body.sourceSetupDocumentId.trim()
          ? body.sourceSetupDocumentId.trim()
          : null
      ),
      tireTypeId
        ? prisma.tireType.findUnique({
            where: { id: tireTypeId },
            select: { id: true, displayName: true },
          })
        : null,
      additiveTypeId
        ? prisma.additiveType.findUnique({
            where: { id: additiveTypeId },
            select: { id: true, displayName: true },
          })
        : null,
      needsParticipationCheck && body.eventId
        ? prisma.eventParticipation.findUnique({
            where: { userId_eventId: { userId: params.userId, eventId: body.eventId } },
            select: { controlledAdditiveTypeId: true },
          })
        : null,
      prisma.car.findFirst({
        where: { id: carId, userId: params.userId },
        select: { name: true, setupSheetModelId: true, setupSheetTemplate: true },
      }),
      body.trackId
        ? prisma.track.findFirst({
            where: communityTrackByIdWhere(body.trackId),
            select: { name: true, latitude: true, longitude: true },
          })
        : null,
    ]);

  let resolvedData: SetupSnapshotData;
  let setupDeltaJson: object | null = null;

  if (baselineId) {
    if (!baselineRow) {
      return NextResponse.json({ error: "Baseline setup snapshot not found" }, { status: 400 });
    }
    const baseNorm = normalizeSetupSnapshotForStorage(baselineRow.data);
    const useDeltaOnly = Boolean(body.setupDeltaOnly);
    const deltaPayload = useDeltaOnly
      ? (body.setupDelta && typeof body.setupDelta === "object" && !Array.isArray(body.setupDelta)
          ? body.setupDelta
          : {})
      : ((body.setupData ?? {}) as Record<string, unknown>);
    resolvedData = resolveSetupSnapshot(baseNorm, deltaPayload);
    const audit = computeSetupDeltaForAudit(baseNorm, resolvedData);
    setupDeltaJson = Object.keys(audit).length > 0 ? audit : null;
  } else {
    resolvedData = normalizeSetupSnapshotForStorage(body.setupData ?? {});
  }

  // Tires are the compound plus how many runs are on them. `tireStintId` groups
  // runs sharing one life of rubber; a null one from the client means different
  // rubber went on, so mint a fresh stint here. Carrying one forward is what makes
  // "same tires as last run" cost the driver nothing.
  if (tireTypeId && !tireType) {
    return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
  }
  const tireAgeKnown = body.tireAgeKnown !== false;
  /**
   * On a NEW run a count that differs from the carried-forward one means
   * different rubber went on, so the panel sends a null stint and a fresh one is
   * minted here. On an EDIT the same gesture means the opposite: the driver is
   * correcting the record of rubber that is already on the car, and forking the
   * stint would cut the run out of the very set it belongs to — taking the
   * Engineer's wear chain with it, and leaving nothing to carry a correction
   * along. So an edit that keeps the compound keeps the stint.
   *
   * The cost of that choice: "same compound, different set" is not expressible
   * from the edit form. It needs its own affordance rather than being inferred
   * from a number changing.
   */
  const keepsStoredCompound =
    existingUpdate != null && tireTypeId != null && existingUpdate.tireTypeId === tireTypeId;
  const tireStintId = tireTypeId
    ? typeof body.tireStintId === "string" && body.tireStintId.trim()
      ? body.tireStintId.trim()
      : (keepsStoredCompound ? existingUpdate!.tireStintId : null) ?? randomUUID()
    : null;

  // Run-context tires MUST be applied before persisting the snapshot; otherwise loaded
  // baseline / client setupData leaks stale tires into DB (overwrite ran after create).

  if (additiveTypeId && !additiveType) {
    return NextResponse.json({ error: "Additive type not found" }, { status: 400 });
  }

  if (needsParticipationCheck && participation?.controlledAdditiveTypeId && !additiveTypeId) {
    return NextResponse.json(
      { error: "This event requires an additive selection to complete the run." },
      { status: 400 }
    );
  }

  // Tire-prep sequence is the source of truth; keep the legacy Int in sync as a
  // derived total (sum of warmer-step minutes) so older reads + aggregations work.
  const tirePrep = normalizeTirePrep(body.tirePrep);
  const warmerTimingMinutes =
    tirePrep.length > 0
      ? derivedWarmerTimingMinutes(tirePrep)
      : parseWarmerTimingMinutes(body.warmerTimingMinutes);

  const sheetKeys = carRow
    ? await getSetupSheetFieldKeysForCarRow(params.userId, carRow)
    : new Set<string>();

  resolvedData = normalizeSetupSnapshotForStorage(
    applyRunContextToSetupSnapshot({
      resolvedData,
      sheetKeys,
      tire: tireType
        ? {
            tireTypeId: tireType.id,
            displayName: tireType.displayName,
            tireRunNumber,
            tireAgeKnown,
          }
        : null,
      additiveDisplayName: additiveType?.displayName ?? null,
      warmerTimingMinutes,
    })
  );

  const setupSnapshot = await prisma.setupSnapshot.create({
    data: {
      userId: params.userId,
      carId,
      data: resolvedData as object,
      baseSetupSnapshotId: baselineId,
      setupDeltaJson:
        setupDeltaJson === null || Object.keys(setupDeltaJson).length === 0
          ? undefined
          : (setupDeltaJson as object),
    },
    select: { id: true },
  });

  const car = carRow;
  if (!car) {
    return NextResponse.json({ error: "Car not found" }, { status: 400 });
  }

  if (body.trackId && !track) {
    return NextResponse.json({ error: "Track not found" }, { status: 400 });
  }

  // Effortless capture: when the client attached no reading (fast save, a
  // transient weather-fetch failure, or the async client fetch not landing
  // before submit) but the run's track has a saved pin, fetch conditions
  // server-side so auto-capture is reliable every time. Create-only: never
  // override an explicit clear on edit; the session instant drives the reading.
  if (
    params.mode === "create" &&
    normalizedConditions == null &&
    track &&
    trackHasMarkedLocation(track)
  ) {
    const backfilled = await backfillRunConditionsFromTrack({
      latitude: track.latitude!,
      longitude: track.longitude!,
      atIso: sessionCompletedAtResolved ? sessionCompletedAtResolved.toISOString() : null,
    });
    if (backfilled) conditionsColumns = backfilled;
  }

  // Layout must belong to the run's track. Snapshot the name so it survives layout deletion.
  const trackLayout =
    body.trackLayoutId && body.trackId
      ? await prisma.trackLayout.findFirst({
          where: { id: body.trackLayoutId, trackId: body.trackId },
          select: { id: true, name: true },
        })
      : null;
  if (body.trackLayoutId && !trackLayout) {
    return NextResponse.json({ error: "Layout not found for this track" }, { status: 400 });
  }
  const trackDirection =
    body.trackDirection === "CW" || body.trackDirection === "CCW" ? body.trackDirection : null;

  const event = body.eventId
    ? await prisma.event.findFirst({
        where: { id: body.eventId },
        select: { id: true },
      })
    : null;
  if (body.eventId && !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 400 });
  }
  if (event) {
    // Saving a run is a join, so it has to pass the same gate as `/api/events/[eventId]/join`.
    // This lookup used to be by id alone: any authenticated caller holding an event id could add
    // themselves as a participant to it.
    if (!(await userMayJoinEvent(params.userId, event.id))) {
      return NextResponse.json(
        { error: "This event belongs to someone outside your team." },
        { status: 403 }
      );
    }
    await ensureEventParticipation({ userId: params.userId, eventId: event.id });
  }

  const sessionType =
    body.sessionType === "PRACTICE" || body.sessionType === "RACE_MEETING"
      ? body.sessionType
      : "TESTING";

  const meetingSessionType =
    body.sessionType === "RACE_MEETING" && body.meetingSessionType &&
    ["PRACTICE", "SEEDING", "QUALIFYING", "RACE", "OTHER"].includes(body.meetingSessionType)
      ? body.meetingSessionType
      : null;

  const meetingSessionCode =
    body.sessionType === "RACE_MEETING" && typeof body.meetingSessionCode === "string" && body.meetingSessionCode.trim()
      ? body.meetingSessionCode.trim()
      : null;

  let run: { id: string; createdAt: Date };
  /** Non-null only when correcting this run's count also moved later runs on the same set. */
  let tireRunNumberCascade: { updatedRuns: number; delta: number } | null = null;
  if (params.mode === "create") {
    run = await prisma.run.create({
      data: {
        userId: params.userId,
        carId,
        carNameSnapshot: car.name,
        localTimeZone: deviceTimeZone,
        sessionType,
        meetingSessionType,
        meetingSessionCode,
        eventId: body.eventId ?? null,
        trackId: body.trackId ?? null,
        trackNameSnapshot: track?.name ?? null,
        trackLayoutId: trackLayout?.id ?? null,
        trackLayoutNameSnapshot: trackLayout?.name ?? null,
        trackDirection,
        tireTypeId,
        tireStintId,
        tireAgeKnown,
        tireRunNumber,
        additiveTypeId,
        warmerTimingMinutes,
        tirePrep: tirePrep as unknown as PrismaTypes.InputJsonValue,
        setupSnapshotId: setupSnapshot.id,
        sourceSetupDocumentId: pdfLinks.sourceSetupDocumentId,
        sourceSetupCalibrationId: pdfLinks.sourceSetupCalibrationId,
        lapTimes,
        lapSession: lapSession as unknown as PrismaTypes.InputJsonValue,
        bestLapSeconds: lapSummary.bestLapSeconds,
        avgTop5LapSeconds: lapSummary.avgTop5LapSeconds,
        notes: body.notes?.trim() || null,
        driverNotes: null,
        handlingProblems: null,
        handlingAssessmentJson: handlingAssessmentForSave,
        carRating: carRatingNormalized,
        suggestedChanges: body.suggestedChanges?.trim() || null,
        suggestedPreRun: body.suggestedPreRun?.trim() || null,
        sessionLabel: body.sessionLabel?.trim() || null,
        raceClass: body.raceClass?.trim() || null,
        practiceDayUrl: body.practiceDayUrl?.trim() || null,
        sessionCompletedAt: sessionCompletedAtResolved,
        loggingComplete,
        loggingCompletedAt: loggingComplete ? new Date() : null,
        shareWithTeam,
        ...(conditionsColumns ?? {}),
      } as PrismaTypes.RunUncheckedCreateInput,
      select: { id: true, createdAt: true },
    });
  } else {
    const existing = existingUpdate!;
    await prisma.engineerBetweenRunHint.deleteMany({
      where: { primaryRunId: existing.id },
    });
    const updateData: PrismaTypes.RunUncheckedUpdateInput = {
      carId,
      carNameSnapshot: car.name,
      sessionType,
      meetingSessionType,
      meetingSessionCode,
      eventId: body.eventId ?? null,
      trackId: body.trackId ?? null,
      trackNameSnapshot: track?.name ?? null,
      trackLayoutId: trackLayout?.id ?? null,
      trackLayoutNameSnapshot: trackLayout?.name ?? null,
      trackDirection,
      tireTypeId,
      tireStintId,
      tireAgeKnown,
      tireRunNumber,
      additiveTypeId,
      warmerTimingMinutes,
      tirePrep: tirePrep as unknown as PrismaTypes.InputJsonValue,
      setupSnapshotId: setupSnapshot.id,
      sourceSetupDocumentId: pdfLinks.sourceSetupDocumentId,
      sourceSetupCalibrationId: pdfLinks.sourceSetupCalibrationId,
      lapTimes,
      lapSession: lapSession as unknown as PrismaTypes.InputJsonValue,
      bestLapSeconds: lapSummary.bestLapSeconds,
      avgTop5LapSeconds: lapSummary.avgTop5LapSeconds,
      notes: body.notes?.trim() || null,
      suggestedChanges: body.suggestedChanges?.trim() || null,
      suggestedPreRun: body.suggestedPreRun?.trim() || null,
      sessionLabel: body.sessionLabel?.trim() || null,
      raceClass: body.raceClass?.trim() || null,
      practiceDayUrl: body.practiceDayUrl?.trim() || null,
      engineerSummaryJson: Prisma.JsonNull,
      engineerSummaryRefRunId: null,
      engineerSummaryComputedAt: null,
      sessionCompletedAt: sessionCompletedAtResolved,
      loggingComplete,
      ...(conditionsColumns ?? {}),
    };
    if (loggingComplete && existing.loggingComplete === false && existing.loggingCompletedAt == null) {
      updateData.loggingCompletedAt = new Date();
    }
    if ("handlingAssessmentJson" in body) {
      updateData.handlingAssessmentJson = loggingComplete
        ? handlingAssessmentForSave
        : prismaJsonFromHandlingBody(body.handlingAssessmentJson ?? null);
    }
    if ("carRating" in body) {
      updateData.carRating = carRatingNormalized;
    }
    if (typeof body.shareWithTeam === "boolean") {
      updateData.shareWithTeam = body.shareWithTeam;
    }
    run = await prisma.run.update({
      where: { id: existing.id },
      data: updateData,
      select: { id: true, createdAt: true },
    });

    await prisma.runImportedLap.deleteMany({
      where: { lapSet: { runId: run.id } },
    });
    await prisma.runImportedLapSet.deleteMany({
      where: { runId: run.id },
    });

    /*
     * Carry the correction down the rest of the set. The rule — a shift rather than a
     * renumber, stopping at the stint boundary — lives in `lib/tires/cascadeTireRunNumber`;
     * applying it lives in `applyTireRunNumberCascade`, which the run page's sparse
     * correction calls too, so the two paths can never drift apart.
     */
    tireRunNumberCascade = await applyTireRunNumberCascade({
      userId: params.userId,
      runId: existing.id,
      tireStintId,
      previousTireStintId: existing.tireStintId,
      previousTireRunNumber: existing.tireRunNumber,
      nextTireRunNumber: tireRunNumber,
      sortAt: existing.sortAt,
    });
  }

  const importedLapSets = Array.isArray(body.importedLapSets) ? body.importedLapSets : [];
  for (const set of importedLapSets) {
    const driverName = typeof set.driverName === "string" ? set.driverName.trim() : "";
    if (!driverName) continue;
    const rawLaps = Array.isArray(set.laps) ? set.laps : [];
    const lapsForSet: Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded: boolean }> = [];
    if (rawLaps.length > 0 && typeof rawLaps[0] === "number") {
      const nums = rawLaps.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      for (let i = 0; i < nums.length; i++) {
        lapsForSet.push({ lapNumber: i + 1, lapTimeSeconds: nums[i], isIncluded: true });
      }
    } else {
      for (const row of rawLaps) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const lapNumber = typeof r.lapNumber === "number" && Number.isFinite(r.lapNumber) ? Math.floor(r.lapNumber) : 0;
        const lapTimeSeconds =
          typeof r.lapTimeSeconds === "number" && Number.isFinite(r.lapTimeSeconds) ? r.lapTimeSeconds : NaN;
        if (!Number.isFinite(lapTimeSeconds)) continue;
        lapsForSet.push({
          lapNumber,
          lapTimeSeconds,
          isIncluded: r.isIncluded !== false,
        });
      }
    }
    if (lapsForSet.length === 0) continue;
    const normalizedName = typeof set.normalizedName === "string" && set.normalizedName.trim()
      ? set.normalizedName.trim().toLowerCase()
      : driverName.toLowerCase();
    let sessionCompletedAt: Date | null = null;
    if (typeof set.sessionCompletedAt === "string" && set.sessionCompletedAt.trim()) {
      const d = new Date(set.sessionCompletedAt.trim());
      if (!Number.isNaN(d.getTime())) sessionCompletedAt = d;
    }
    const createdSet = await prisma.runImportedLapSet.create({
      data: {
        runId: run.id,
        sourceUrl: typeof set.sourceUrl === "string" && set.sourceUrl.trim() ? set.sourceUrl.trim() : null,
        driverId: typeof set.driverId === "string" && set.driverId.trim() ? set.driverId.trim() : null,
        driverName,
        normalizedName,
        isPrimaryUser: Boolean(set.isPrimaryUser),
        sessionCompletedAt,
      },
      select: { id: true },
    });
    await prisma.runImportedLap.createMany({
      data: lapsForSet.map((row) => ({
        lapSetId: createdSet.id,
        lapNumber: row.lapNumber,
        lapTimeSeconds: row.lapTimeSeconds,
        isIncluded: row.isIncluded,
      })),
    });
  }

  // Presence of the key is the instruction, not its length: the run form always
  // sends the full list, so `[]` means "detach what was there". A caller that
  // omits the field entirely is saying nothing about timing links, and leaves
  // them alone.
  if (Array.isArray(body.importedLapTimeSessionIds)) {
    const lapImportIds = body.importedLapTimeSessionIds.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0
    );
    await linkImportedSessionsToRun({
      userId: params.userId,
      importedLapTimeSessionIds: lapImportIds,
      runId: run.id,
    });
  }

  // Keep the account-level zone current so runs logged before `Run.localTimeZone`
  // existed still resolve to a sensible day for their driver. `updateMany` with the
  // inequality means this only writes when the zone actually changed, so the common
  // case costs one cheap no-op query rather than a write per run.
  if (deviceTimeZone) {
    await prisma.user.updateMany({
      where: { id: params.userId, OR: [{ timeZone: null }, { timeZone: { not: deviceTimeZone } }] },
      data: { timeZone: deviceTimeZone },
    });
  }

  revalidateAfterRunMutation(params.userId);

  const newlyCompleted =
    loggingComplete &&
    (params.mode === "create" || existingUpdate?.loggingComplete === false);

  const promptMarkTrackLocation = await buildPromptMarkTrackLocation({
    userId: params.userId,
    trackId: body.trackId,
    loggingComplete,
    newlyCompleted,
    hasDismissedRunLocationPrompt: async (userId, trackId) => {
      const row = await prisma.trackLocationRunPromptDismissal.findUnique({
        where: { userId_trackId: { userId, trackId } },
      });
      return row != null;
    },
    findTrack: (trackId) =>
      prisma.track.findFirst({
        where: communityTrackByIdWhere(trackId),
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
        },
      }),
  });

  return NextResponse.json(
    { run, tireStintId, promptMarkTrackLocation, tireRunNumberCascade },
    { status: params.mode === "create" ? 201 : 200 }
  );
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as RunUpsertBody;
    return await createOrUpdateRun({ userId: userId, body, mode: "create" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as RunUpsertBody;
    return await createOrUpdateRun({ userId: userId, body, mode: "update" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

