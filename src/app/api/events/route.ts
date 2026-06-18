import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseEventDateYmd, eventDateToYmd } from "@/lib/eventDateParse";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import {
  ensureEventParticipation,
  EVENT_LIST_INCLUDE,
  mapEventForUser,
} from "@/lib/events/eventParticipation";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";
import { eventIdsInScopeForUser } from "@/lib/events/eventParticipation";
import { eventTrackFieldsForLink } from "@/lib/tracks/legacyTrackSnapshot";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const trackId = searchParams.get("trackId");
  const suggest = searchParams.get("suggest");

  if (suggest === "1" && trackId) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const threeDaysAgo = new Date(startOfToday);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const recentRun = await prisma.run.findFirst({
      where: {
        userId: user.id,
        trackId,
        createdAt: { gte: threeDaysAgo },
        eventId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      include: {
        event: {
          include: EVENT_LIST_INCLUDE,
        },
      },
    });

    if (recentRun?.event) {
      return NextResponse.json({
        suggestedEvent: mapEventForUser(recentRun.event, user.id),
      });
    }
    return NextResponse.json({ suggestedEvent: null });
  }

  const scopedIds = await eventIdsInScopeForUser(user.id);
  if (scopedIds.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const events = await prisma.event.findMany({
    where: { id: { in: scopedIds } },
    orderBy: { startDate: "desc" },
    take: 50,
    include: EVENT_LIST_INCLUDE,
  });

  return NextResponse.json({
    events: events.map((e) => mapEventForUser(e, user.id)),
  });
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
    const body = (await request.json()) as {
      name?: string;
      trackId?: string | null;
      startDate?: string;
      endDate?: string;
      notes?: string | null;
      practiceSourceUrl?: string | null;
      resultsSourceUrl?: string | null;
      controlledTireLabel?: string | null;
      controlledTireTypeId?: string | null;
    };

    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const trackId = body.trackId?.toString().trim();
    if (!trackId) {
      return NextResponse.json({ error: "trackId is required" }, { status: 400 });
    }
    const track = await prisma.track.findFirst({
      where: { id: trackId },
      select: { id: true, name: true, location: true },
    });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }

    const startDate = body.startDate ? parseEventDateYmd(body.startDate) : new Date();
    const endDate = body.endDate ? parseEventDateYmd(body.endDate) : new Date(startDate);

    if (eventDateToYmd(endDate) < eventDateToYmd(startDate)) {
      return NextResponse.json(
        { error: "End date must be on or after the start date." },
        { status: 400 }
      );
    }

    const practiceSourceUrl =
      typeof body.practiceSourceUrl === "string" && body.practiceSourceUrl.trim()
        ? body.practiceSourceUrl.trim()
        : null;
    const resultsSourceUrlRaw =
      typeof body.resultsSourceUrl === "string" && body.resultsSourceUrl.trim()
        ? body.resultsSourceUrl.trim()
        : null;
    const resultsSourceUrl = resultsSourceUrlRaw
      ? normalizeLiveRcEventHubUrl(resultsSourceUrlRaw) ?? resultsSourceUrlRaw
      : null;
    const controlledTireLabel =
      typeof body.controlledTireLabel === "string" && body.controlledTireLabel.trim()
        ? body.controlledTireLabel.trim()
        : null;
    const controlledTireTypeId = body.controlledTireTypeId?.trim() || null;
    if (controlledTireTypeId) {
      const tt = await prisma.tireType.findUnique({
        where: { id: controlledTireTypeId },
        select: { id: true },
      });
      if (!tt) {
        return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
      }
    }

    if (resultsSourceUrl) {
      const existing = await findEventByTrackAndResultsUrl(trackId, resultsSourceUrl);
      if (existing) {
        await ensureEventParticipation({
          userId: user.id,
          eventId: existing.id,
          notes: body.notes,
          controlledTireLabel,
          controlledTireTypeId,
        });
        const event = await prisma.event.findUnique({
          where: { id: existing.id },
          include: EVENT_LIST_INCLUDE,
        });
        return NextResponse.json(
          {
            error: "An event with this LiveRC results URL already exists — joined your participation.",
            existingEventId: existing.id,
            event: event ? mapEventForUser(event, user.id) : null,
          },
          { status: 409 }
        );
      }
    }

    const event = await prisma.event.create({
      data: {
        userId: user.id,
        name,
        trackId,
        trackNameSnapshot: track.name,
        trackLocationSnapshot: track.location,
        startDate,
        endDate,
        practiceSourceUrl,
        resultsSourceUrl,
      },
      include: EVENT_LIST_INCLUDE,
    });

    await ensureEventParticipation({
      userId: user.id,
      eventId: event.id,
      notes: body.notes,
      controlledTireLabel,
      controlledTireTypeId,
    });

    const withParts = await prisma.event.findUnique({
      where: { id: event.id },
      include: EVENT_LIST_INCLUDE,
    });

    return NextResponse.json(
      { event: withParts ? mapEventForUser(withParts, user.id) : mapEventForUser(event, user.id) },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
