import { NextResponse } from "next/server";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildLapSessionV1 } from "@/lib/lapSession/buildSession";
import type { LapSourceKind } from "@/lib/lapSession/types";
import { computePersistedRunLapSummary } from "@/lib/lapAnalysis";
import {
  computeSetupDeltaForAudit,
  resolveSetupSnapshot,
} from "@/lib/setup/resolveSetupSnapshot";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import { tireSelectionFromTireSet } from "@/lib/tires/tireSelectionFromSet";
import { resolveSourcePdfLinksForNewRun } from "@/lib/setup/ensureRunSetupPdf";
import { linkImportedSessionsToRun } from "@/lib/lapImport/service";
import { resolveRunSessionCompletedAtFromUpsertBody } from "@/lib/runSessionCompletedAt";
import { coerceFeelVsLastRunForCompleteRun, parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";
import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";
import { communityTrackByIdWhere } from "@/lib/tracks/communityTrackAccess";

type RunUpsertBody = {
  runId?: string;
  carId?: string;
  sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  trackId?: string | null;
  tireSetId?: string | null;
  tireRunNumber?: number;
  batteryId?: string | null;
  batteryRunNumber?: number;
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
    laps?: number[] | Array<{ lapNumber: number; lapTimeSeconds: number; isIncluded?: boolean }>;
  }>;
  /** Optional: link persisted ImportedLapTimeSession rows from URL import(s) to this run. */
  importedLapTimeSessionIds?: string[];
  /**
   * `draft` = save progress without marking logging complete.
   * Omitted or `completed` = treat as logging complete (backward compatible).
   * On PUT, if the run was already `loggingComplete`, `draft` is ignored: logging stays complete
   * and stored tire/battery run numbers are not overwritten from the body.
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
   * When false, mutual team members will not see this run in team Sessions / team-only Engineer paths.
   * TeammateLink peers are unaffected. Default true when omitted.
   */
  shareWithTeam?: boolean;
};

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

async function userHasPriorCompletedRunOnCar(params: {
  userId: string;
  carId: string;
  excludeRunId?: string;
}): Promise<boolean> {
  const count = await prisma.run.count({
    where: {
      userId: params.userId,
      carId: params.carId,
      loggingComplete: true,
      ...(params.excludeRunId ? { id: { not: params.excludeRunId } } : {}),
    },
  });
  return count > 0;
}

async function createOrUpdateRun(params: { userId: string; body: RunUpsertBody; mode: "create" | "update" }) {
  const body = params.body;
  const carId = body.carId;
  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const sessionCompletedAtResolved = await resolveRunSessionCompletedAtFromUpsertBody(params.userId, body);

  let existingUpdate: {
    id: string;
    createdAt: Date;
    loggingComplete: boolean;
    loggingCompletedAt: Date | null;
    tireRunNumber: number;
    batteryRunNumber: number;
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
        batteryRunNumber: true,
      },
    });
    if (!ex) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    existingUpdate = ex;
  }

  /** Editing a run already marked complete: never revert to draft or rewrite tire/battery run # from the client. */
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

  const excludeRunId =
    params.mode === "update" && typeof body.runId === "string" ? body.runId.trim() : undefined;
  const hasPriorRunOnCar =
    loggingComplete &&
    (await userHasPriorCompletedRunOnCar({
      userId: params.userId,
      carId,
      excludeRunId: excludeRunId || undefined,
    }));

  let handlingAssessmentForSave: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
  if (loggingComplete) {
    const resolved = coerceFeelVsLastRunForCompleteRun(
      body.handlingAssessmentJson ?? null,
      hasPriorRunOnCar
    );
    if (resolved.error) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    handlingAssessmentForSave =
      resolved.parsed === null ? Prisma.JsonNull : (resolved.parsed as Prisma.InputJsonValue);
  } else if ("handlingAssessmentJson" in body) {
    handlingAssessmentForSave = prismaJsonFromHandlingBody(body.handlingAssessmentJson ?? null);
  }

  const shareWithTeam = body.shareWithTeam === false ? false : true;

  const tireRunNumberFromBody =
    typeof body.tireRunNumber === "number" && Number.isFinite(body.tireRunNumber)
      ? Math.max(1, Math.floor(body.tireRunNumber))
      : 1;
  const batteryRunNumberFromBody =
    typeof body.batteryRunNumber === "number" && Number.isFinite(body.batteryRunNumber)
      ? Math.max(1, Math.floor(body.batteryRunNumber))
      : 1;

  const tireRunNumber =
    loggingWasAlreadyComplete && existingUpdate
      ? Math.max(1, Math.floor(Number(existingUpdate.tireRunNumber) || 1))
      : tireRunNumberFromBody;
  const batteryRunNumber =
    loggingWasAlreadyComplete && existingUpdate
      ? Math.max(1, Math.floor(Number(existingUpdate.batteryRunNumber) || 1))
      : batteryRunNumberFromBody;

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

  let resolvedData: SetupSnapshotData;
  let setupDeltaJson: object | null = null;

  if (baselineId) {
    const baselineRow = await prisma.setupSnapshot.findFirst({
      where: { id: baselineId, userId: params.userId },
      select: { data: true },
    });
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

  const pdfLinks = await resolveSourcePdfLinksForNewRun(
    params.userId,
    baselineId,
    typeof body.sourceSetupDocumentId === "string" && body.sourceSetupDocumentId.trim()
      ? body.sourceSetupDocumentId.trim()
      : null
  );

  // Run-context tire/battery MUST be applied before persisting the snapshot; otherwise loaded
  // baseline / client setupData leaks stale tires+battery into DB (overwrite ran after create).
  const tireSet = body.tireSetId
    ? await prisma.tireSet.findFirst({
        where: { id: body.tireSetId, userId: params.userId },
        select: {
          id: true,
          label: true,
          setNumber: true,
          insertLabel: true,
          wheelLabel: true,
          tireTypeId: true,
          tireType: { select: { id: true, displayName: true, modelCode: true } },
        },
      })
    : null;
  if (body.tireSetId && !tireSet) {
    return NextResponse.json({ error: "Tire set not found" }, { status: 400 });
  }

  const battery = body.batteryId
    ? await prisma.battery.findFirst({
        where: { id: body.batteryId, userId: params.userId },
        select: { id: true, label: true, packNumber: true },
      })
    : null;
  if (body.batteryId && !battery) {
    return NextResponse.json({ error: "Battery not found" }, { status: 400 });
  }

  const tireValue = tireSet ? tireSelectionFromTireSet(tireSet) : undefined;
  const batteryLabel = battery ? `${battery.label}${battery.packNumber != null ? ` #${battery.packNumber}` : ""}` : "";
  resolvedData = normalizeSetupSnapshotForStorage({
    ...resolvedData,
    tires: tireValue || undefined,
    battery: batteryLabel || undefined,
  });

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

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: params.userId },
    select: { name: true },
  });
  if (!car) {
    return NextResponse.json({ error: "Car not found" }, { status: 400 });
  }

  const track = body.trackId
    ? await prisma.track.findFirst({
        where: communityTrackByIdWhere(body.trackId),
        select: { name: true },
      })
    : null;
  if (body.trackId && !track) {
    return NextResponse.json({ error: "Track not found" }, { status: 400 });
  }

  const event = body.eventId
    ? await prisma.event.findFirst({
        where: { id: body.eventId, userId: params.userId },
        select: { id: true },
      })
    : null;
  if (body.eventId && !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 400 });
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
  if (params.mode === "create") {
    run = await prisma.run.create({
      data: {
        userId: params.userId,
        carId,
        carNameSnapshot: car.name,
        sessionType,
        meetingSessionType,
        meetingSessionCode,
        eventId: body.eventId ?? null,
        trackId: body.trackId ?? null,
        trackNameSnapshot: track?.name ?? null,
        tireSetId: body.tireSetId ?? null,
        tireRunNumber,
        batteryId: body.batteryId ?? null,
        batteryRunNumber,
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
      tireSetId: body.tireSetId ?? null,
      tireRunNumber,
      batteryId: body.batteryId ?? null,
      batteryRunNumber,
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

  const lapImportIds = Array.isArray(body.importedLapTimeSessionIds)
    ? body.importedLapTimeSessionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (lapImportIds.length > 0) {
    await linkImportedSessionsToRun({
      userId: params.userId,
      importedLapTimeSessionIds: lapImportIds,
      runId: run.id,
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
    { run, promptMarkTrackLocation },
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
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as RunUpsertBody;
    return await createOrUpdateRun({ userId: user.id, body, mode: "create" });
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
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as RunUpsertBody;
    return await createOrUpdateRun({ userId: user.id, body, mode: "update" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

