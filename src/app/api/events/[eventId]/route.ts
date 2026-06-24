import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { eventDateToYmd, parseEventDateYmd } from "@/lib/eventDateParse";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import {
  ensureEventParticipation,
  EVENT_LIST_INCLUDE,
  mapEventForUser,
  userCanAccessEvent,
} from "@/lib/events/eventParticipation";
import { canEditSharedEventFields } from "@/lib/events/eventAccess";
import { mergeEventIntoExistingByResultsUrl } from "@/lib/events/mergeEvents";
import { eventTrackFieldsForLink } from "@/lib/tracks/legacyTrackSnapshot";

function optString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

const SHARED_PATCH_KEYS = new Set([
  "name",
  "trackId",
  "startDate",
  "endDate",
  "practiceSourceUrl",
  "resultsSourceUrl",
  "raceClass",
]);

const PERSONAL_PATCH_KEYS = new Set([
  "notes",
  "controlledTireLabel",
  "controlledTireTypeId",
  "controlledAdditiveTypeId",
  "pinned",
]);

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

  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      userId: true,
      trackId: true,
      startDate: true,
      endDate: true,
      resultsSourceUrl: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const body = (await request.json()) as Record<string, unknown>;

  const hasShared = Object.keys(body).some((k) => SHARED_PATCH_KEYS.has(k));
  const hasPersonal = Object.keys(body).some((k) => PERSONAL_PATCH_KEYS.has(k));
  if (!hasShared && !hasPersonal) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  if (hasShared && !canEditSharedEventFields(user, existing)) {
    return NextResponse.json(
      { error: "Only the user who created this event or an admin can edit shared event fields." },
      { status: 403 }
    );
  }

  if (hasPersonal && !(await userCanAccessEvent(user.id, eventId))) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (hasPersonal) {
    await ensureEventParticipation({ userId: user.id, eventId });
  }

  const eventData: Prisma.EventUncheckedUpdateInput = {};

  if (body.name !== undefined) {
    const name = optString(body.name);
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    eventData.name = name;
  }

  if (body.trackId !== undefined) {
    const trackId = optString(body.trackId);
    if (!trackId) {
      return NextResponse.json(
        { error: "trackId is required, or omit to keep the legacy track." },
        { status: 400 }
      );
    }
    const linkFields = await eventTrackFieldsForLink(trackId);
    if (!linkFields) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }
    eventData.trackId = trackId;
    eventData.trackNameSnapshot = linkFields.trackNameSnapshot;
    eventData.trackLocationSnapshot = linkFields.trackLocationSnapshot;
    eventData.legacyTrackJson = Prisma.DbNull;
  }

  const nextStart =
    body.startDate !== undefined && typeof body.startDate === "string"
      ? parseEventDateYmd(body.startDate)
      : existing.startDate;
  const nextEnd =
    body.endDate !== undefined && typeof body.endDate === "string"
      ? parseEventDateYmd(body.endDate)
      : existing.endDate;
  if (body.startDate !== undefined) eventData.startDate = nextStart;
  if (body.endDate !== undefined) eventData.endDate = nextEnd;
  if (body.startDate !== undefined || body.endDate !== undefined) {
    if (eventDateToYmd(nextEnd) < eventDateToYmd(nextStart)) {
      return NextResponse.json(
        { error: "End date must be on or after the start date." },
        { status: 400 }
      );
    }
  }

  const practiceSourceUrl = optString(body.practiceSourceUrl);
  const resultsSourceUrlRaw = optString(body.resultsSourceUrl);
  const raceClass = optString(body.raceClass);

  if (practiceSourceUrl !== undefined) eventData.practiceSourceUrl = practiceSourceUrl;
  if (resultsSourceUrlRaw !== undefined) {
    eventData.resultsSourceUrl = resultsSourceUrlRaw
      ? normalizeLiveRcEventHubUrl(resultsSourceUrlRaw) ?? resultsSourceUrlRaw
      : null;
  }
  if (raceClass !== undefined) eventData.raceClass = raceClass;

  let survivingEventId = eventId;

  if (Object.keys(eventData).length > 0) {
    const resolvedTrackId =
      typeof eventData.trackId === "string" ? eventData.trackId : existing.trackId;
    const resolvedResultsUrl =
      eventData.resultsSourceUrl !== undefined
        ? typeof eventData.resultsSourceUrl === "string"
          ? eventData.resultsSourceUrl
          : null
        : existing.resultsSourceUrl;

    if (resolvedResultsUrl && resolvedTrackId) {
      const merge = await mergeEventIntoExistingByResultsUrl({
        sourceEventId: survivingEventId,
        trackId: resolvedTrackId,
        resultsSourceUrl: resolvedResultsUrl,
      });
      if (merge.merged) {
        survivingEventId = merge.eventId;
        await ensureEventParticipation({ userId: user.id, eventId: survivingEventId });
        await prisma.event.update({
          where: { id: survivingEventId },
          data: eventData,
        });
      } else {
        await prisma.event.update({
          where: { id: survivingEventId },
          data: eventData,
        });
      }
    } else {
      await prisma.event.update({
        where: { id: survivingEventId },
        data: eventData,
      });
    }
  }

  const participationData: {
    notes?: string | null;
    controlledTireLabel?: string | null;
    controlledTireTypeId?: string | null;
    controlledAdditiveTypeId?: string | null;
    pinnedAt?: Date | null;
  } = {};

  if (body.notes !== undefined) participationData.notes = optString(body.notes) ?? null;

  const controlledTireLabel = optString(body.controlledTireLabel);
  const controlledTireTypeId =
    body.controlledTireTypeId === undefined
      ? undefined
      : body.controlledTireTypeId === null
        ? null
        : optString(body.controlledTireTypeId);
  const controlledAdditiveTypeId =
    body.controlledAdditiveTypeId === undefined
      ? undefined
      : body.controlledAdditiveTypeId === null
        ? null
        : optString(body.controlledAdditiveTypeId);

  if (controlledTireLabel !== undefined) participationData.controlledTireLabel = controlledTireLabel;
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
    participationData.controlledTireTypeId = controlledTireTypeId;
  }
  if (controlledAdditiveTypeId !== undefined) {
    if (controlledAdditiveTypeId) {
      const at = await prisma.additiveType.findUnique({
        where: { id: controlledAdditiveTypeId },
        select: { id: true },
      });
      if (!at) {
        return NextResponse.json({ error: "Additive type not found" }, { status: 400 });
      }
    }
    participationData.controlledAdditiveTypeId = controlledAdditiveTypeId;
  }

  if (body.pinned === true) {
    participationData.pinnedAt = new Date();
  } else if (body.pinned === false) {
    participationData.pinnedAt = null;
  }

  if (Object.keys(participationData).length > 0) {
    await prisma.eventParticipation.update({
      where: { userId_eventId: { userId: user.id, eventId: survivingEventId } },
      data: participationData,
    });
  }

  const event = await prisma.event.findUnique({
    where: { id: survivingEventId },
    include: EVENT_LIST_INCLUDE,
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    merged: survivingEventId !== eventId,
    eventId: survivingEventId,
    event: mapEventForUser(event, user.id),
  });
}
