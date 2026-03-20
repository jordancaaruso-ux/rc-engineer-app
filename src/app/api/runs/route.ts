import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildLapSessionV1 } from "@/lib/lapSession/buildSession";
import type { LapSourceKind } from "@/lib/lapSession/types";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const user = await getOrCreateLocalUser();
    const body = (await request.json()) as {
      carId?: string;
      sessionType?: "TESTING" | "PRACTICE" | "RACE_MEETING";
      meetingSessionType?: string | null;
      meetingSessionCode?: string | null;
      eventId?: string | null;
      trackId?: string | null;
      tireSetId?: string | null;
      tireRunNumber?: number;
      setupData?: unknown;
      lapTimes?: number[];
      /** Optional; server builds canonical lapSession from lapTimes + this meta. */
      lapIngestMeta?: {
        sourceKind?: string;
        sourceDetail?: string | null;
        parserId?: string | null;
      };
      notes?: string | null;
      driverNotes?: string | null;
      handlingProblems?: string | null;
      suggestedChanges?: string | null;
      sessionLabel?: string | null;
    };

    const carId = body.carId;
    if (!carId) {
      return NextResponse.json({ error: "carId is required" }, { status: 400 });
    }

    const tireRunNumber =
      typeof body.tireRunNumber === "number" && Number.isFinite(body.tireRunNumber)
        ? Math.max(1, Math.floor(body.tireRunNumber))
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
    });

    const setupSnapshot = await prisma.setupSnapshot.create({
      data: {
        userId: user.id,
        carId,
        data: (body.setupData ?? {}) as object,
      },
      select: { id: true },
    });

    const car = await prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: { name: true },
    });

    const track = body.trackId
      ? await prisma.track.findFirst({
          where: { id: body.trackId },
          select: { name: true },
        })
      : null;

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

    const run = await prisma.run.create({
      data: {
        userId: user.id,
        carId,
        carNameSnapshot: car?.name ?? null,
        sessionType,
        meetingSessionType,
        meetingSessionCode,
        eventId: body.eventId ?? null,
        trackId: body.trackId ?? null,
        trackNameSnapshot: track?.name ?? null,
        tireSetId: body.tireSetId ?? null,
        tireRunNumber,
        setupSnapshotId: setupSnapshot.id,
        lapTimes,
        lapSession,
        notes: body.notes?.trim() || null,
        driverNotes: null,
        handlingProblems: null,
        suggestedChanges: body.suggestedChanges?.trim() || null,
        sessionLabel: body.sessionLabel?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

