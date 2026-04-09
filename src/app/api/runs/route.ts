import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildLapSessionV1 } from "@/lib/lapSession/buildSession";
import type { LapSourceKind } from "@/lib/lapSession/types";
import { syncActionItemsFromRun } from "@/lib/actionItems";
import {
  computeSetupDeltaForAudit,
  resolveSetupSnapshot,
} from "@/lib/setup/resolveSetupSnapshot";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import { resolveSourcePdfLinksForNewRun } from "@/lib/setup/ensureRunSetupPdf";
import { linkImportedSessionsToRun } from "@/lib/lapImport/service";

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
  sessionLabel?: string | null;
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
};

async function createOrUpdateRun(params: { userId: string; body: RunUpsertBody; mode: "create" | "update" }) {
  const body = params.body;
  const carId = body.carId;
  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const tireRunNumber =
    typeof body.tireRunNumber === "number" && Number.isFinite(body.tireRunNumber)
      ? Math.max(1, Math.floor(body.tireRunNumber))
      : 1;

  const batteryRunNumber =
    typeof body.batteryRunNumber === "number" && Number.isFinite(body.batteryRunNumber)
      ? Math.max(1, Math.floor(body.batteryRunNumber))
      : 1;

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
        where: { id: body.trackId, userId: params.userId },
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

  const tireSet = body.tireSetId
    ? await prisma.tireSet.findFirst({
        where: { id: body.tireSetId, userId: params.userId },
        select: { id: true },
      })
    : null;
  if (body.tireSetId && !tireSet) {
    return NextResponse.json({ error: "Tire set not found" }, { status: 400 });
  }

  const battery = body.batteryId
    ? await prisma.battery.findFirst({
        where: { id: body.batteryId, userId: params.userId },
        select: { id: true },
      })
    : null;
  if (body.batteryId && !battery) {
    return NextResponse.json({ error: "Battery not found" }, { status: 400 });
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
        lapSession: lapSession as unknown as Prisma.InputJsonValue,
        notes: body.notes?.trim() || null,
        driverNotes: null,
        handlingProblems: null,
        suggestedChanges: body.suggestedChanges?.trim() || null,
        sessionLabel: body.sessionLabel?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });
  } else {
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }
    const existing = await prisma.run.findFirst({
      where: { id: runId, userId: params.userId },
      select: { id: true, createdAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    run = await prisma.run.update({
      where: { id: existing.id },
      data: {
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
        lapSession: lapSession as unknown as Prisma.InputJsonValue,
        notes: body.notes?.trim() || null,
        suggestedChanges: body.suggestedChanges?.trim() || null,
        sessionLabel: body.sessionLabel?.trim() || null,
      },
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

  await syncActionItemsFromRun({
    userId: params.userId,
    runId: run.id,
    suggestedChanges: body.suggestedChanges?.trim() || null,
  });

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

  revalidatePath("/runs/history");
  revalidatePath("/");
  revalidatePath("/engineer");
  revalidatePath("/laps/import");

  return NextResponse.json({ run }, { status: params.mode === "create" ? 201 : 200 });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const user = await getOrCreateLocalUser();
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
    const user = await getOrCreateLocalUser();
    const body = (await request.json()) as RunUpsertBody;
    return await createOrUpdateRun({ userId: user.id, body, mode: "update" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

