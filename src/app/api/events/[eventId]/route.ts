import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { eventDateToYmd, parseEventDateYmd } from "@/lib/eventDateParse";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";

const EVENT_TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

const EVENT_INCLUDE = {
  track: { select: { id: true, name: true, location: true } },
  controlledTireType: { select: EVENT_TIRE_TYPE_SELECT },
} as const;

function optString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { eventId } = await context.params;

  const existing = await prisma.event.findFirst({
    where: { id: eventId, userId: user.id },
    select: {
      id: true,
      trackId: true,
      startDate: true,
      endDate: true,
      resultsSourceUrl: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: unknown;
    trackId?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    notes?: unknown;
    practiceSourceUrl?: unknown;
    resultsSourceUrl?: unknown;
    raceClass?: unknown;
    controlledTireLabel?: unknown;
    controlledTireTypeId?: unknown;
  };

  const data: {
    name?: string;
    trackId?: string;
    startDate?: Date;
    endDate?: Date;
    notes?: string | null;
    practiceSourceUrl?: string | null;
    resultsSourceUrl?: string | null;
    raceClass?: string | null;
    controlledTireLabel?: string | null;
    controlledTireTypeId?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = optString(body.name);
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    data.name = name;
  }

  if (body.trackId !== undefined) {
    const trackId = optString(body.trackId);
    if (!trackId) {
      return NextResponse.json({ error: "trackId is required" }, { status: 400 });
    }
    const track = await prisma.track.findFirst({
      where: { id: trackId },
      select: { id: true },
    });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }
    data.trackId = trackId;
  }

  const nextStart =
    body.startDate !== undefined && typeof body.startDate === "string"
      ? parseEventDateYmd(body.startDate)
      : existing.startDate;
  const nextEnd =
    body.endDate !== undefined && typeof body.endDate === "string"
      ? parseEventDateYmd(body.endDate)
      : existing.endDate;
  if (body.startDate !== undefined) data.startDate = nextStart;
  if (body.endDate !== undefined) data.endDate = nextEnd;
  if (body.startDate !== undefined || body.endDate !== undefined) {
    if (eventDateToYmd(nextEnd) < eventDateToYmd(nextStart)) {
      return NextResponse.json(
        { error: "End date must be on or after the start date." },
        { status: 400 }
      );
    }
  }

  if (body.notes !== undefined) data.notes = optString(body.notes) ?? null;

  const practiceSourceUrl = optString(body.practiceSourceUrl);
  const resultsSourceUrlRaw = optString(body.resultsSourceUrl);
  const raceClass = optString(body.raceClass);
  const controlledTireLabel = optString(body.controlledTireLabel);
  const controlledTireTypeId =
    body.controlledTireTypeId === undefined
      ? undefined
      : body.controlledTireTypeId === null
        ? null
        : optString(body.controlledTireTypeId);

  if (practiceSourceUrl !== undefined) data.practiceSourceUrl = practiceSourceUrl;
  if (resultsSourceUrlRaw !== undefined) {
    data.resultsSourceUrl = resultsSourceUrlRaw
      ? normalizeLiveRcEventHubUrl(resultsSourceUrlRaw) ?? resultsSourceUrlRaw
      : null;
  }
  if (raceClass !== undefined) data.raceClass = raceClass;
  if (controlledTireLabel !== undefined) data.controlledTireLabel = controlledTireLabel;
  if (controlledTireTypeId !== undefined) {
    if (controlledTireTypeId) {
      const tt = await prisma.tireType.findUnique({
        where: { id: controlledTireTypeId },
        select: { id: true },
      });
      if (!tt) {
        return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
      }
    }
    data.controlledTireTypeId = controlledTireTypeId;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const targetTrackId = data.trackId ?? existing.trackId;
  const targetResultsUrl =
    data.resultsSourceUrl !== undefined ? data.resultsSourceUrl : existing.resultsSourceUrl;
  if (targetResultsUrl && targetTrackId) {
    const duplicate = await prisma.event.findFirst({
      where: {
        userId: user.id,
        trackId: targetTrackId,
        resultsSourceUrl: targetResultsUrl,
        NOT: { id: eventId },
      },
      select: { id: true, name: true },
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: "An event with this LiveRC results URL already exists.",
          existingEventId: duplicate.id,
        },
        { status: 409 }
      );
    }
  }

  const event = await prisma.event.update({
    where: { id: eventId },
    data,
    include: EVENT_INCLUDE,
  });

  return NextResponse.json({ ok: true, event });
}
