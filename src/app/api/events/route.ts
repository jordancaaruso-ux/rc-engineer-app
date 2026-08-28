import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseEventDateYmd, eventDateToYmd } from "@/lib/eventDateParse";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { classifyMyRcmEventLink } from "@/lib/lapUrlParsers/myRcmUrl";
import { isMyRcmHostUrl } from "@/lib/lapUrlParsers/myRcmPdfSource";
import {
  ensureEventParticipation,
  EVENT_LIST_INCLUDE,
  loadUserScopedEvents,
  mapEventForUser,
} from "@/lib/events/eventParticipation";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";
import { eventTrackFieldsForLink } from "@/lib/tracks/legacyTrackSnapshot";
import { revalidateAfterEventMutation } from "@/lib/revalidateUser";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        userId: userId,
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
        suggestedEvent: mapEventForUser(recentRun.event, userId),
      });
    }
    return NextResponse.json({ suggestedEvent: null });
  }

  const events = await loadUserScopedEvents({ userId: userId, take: 120 });

  return NextResponse.json({ events });
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
    const body = (await request.json()) as {
      name?: string;
      trackId?: string | null;
      trackLayoutId?: string | null;
      trackDirection?: "CW" | "CCW" | null;
      startDate?: string;
      endDate?: string;
      notes?: string | null;
      practiceSourceUrl?: string | null;
      resultsSourceUrl?: string | null;
      myRcmUrl?: string | null;
      controlledTireLabel?: string | null;
      controlledTireTypeId?: string | null;
      controlledAdditiveTypeId?: string | null;
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

    const trackLayout = body.trackLayoutId
      ? await prisma.trackLayout.findFirst({
          where: { id: body.trackLayoutId, trackId },
          select: { id: true, name: true },
        })
      : null;
    if (body.trackLayoutId && !trackLayout) {
      return NextResponse.json({ error: "Layout not found for this track" }, { status: 400 });
    }
    const trackDirection =
      body.trackDirection === "CW" || body.trackDirection === "CCW" ? body.trackDirection : null;

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

    // A MyRCM link here would be stored and never used: this field means "an index we scan", and
    // myrcm.ch is on the fetch denylist. Say where it goes instead of swallowing it.
    if (isMyRcmHostUrl(resultsSourceUrlRaw)) {
      return NextResponse.json(
        { error: "That's a MyRCM link — put it in the event's MyRCM page field instead." },
        { status: 400 }
      );
    }
    const resultsSourceUrl = resultsSourceUrlRaw
      ? normalizeLiveRcEventHubUrl(resultsSourceUrlRaw) ?? resultsSourceUrlRaw
      : null;
    // Validated rather than stored as typed: a link that goes nowhere is only discovered at the
    // track, mid-import, which is the worst possible moment to find out.
    let myRcmUrl: string | null = null;
    if (typeof body.myRcmUrl === "string" && body.myRcmUrl.trim()) {
      const classified = classifyMyRcmEventLink(body.myRcmUrl);
      if (!classified.ok) {
        return NextResponse.json({ error: classified.error }, { status: 400 });
      }
      myRcmUrl = classified.url;
    }
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
    const controlledAdditiveTypeId = body.controlledAdditiveTypeId?.trim() || null;
    if (controlledAdditiveTypeId) {
      const at = await prisma.additiveType.findUnique({
        where: { id: controlledAdditiveTypeId },
        select: { id: true },
      });
      if (!at) {
        return NextResponse.json({ error: "Additive type not found" }, { status: 400 });
      }
    }

    if (resultsSourceUrl) {
      const existing = await findEventByTrackAndResultsUrl(trackId, resultsSourceUrl);
      if (existing) {
        await ensureEventParticipation({
          userId: userId,
          eventId: existing.id,
          notes: body.notes,
          controlledTireLabel,
          controlledTireTypeId,
          controlledAdditiveTypeId,
        });
        const event = await prisma.event.findUnique({
          where: { id: existing.id },
          include: EVENT_LIST_INCLUDE,
        });
        // A 409 here still JOINED them to a meeting, so what Paddock shows as next has
        // changed even though the request "failed".
        revalidateAfterEventMutation(userId);
        return NextResponse.json(
          {
            error: "An event with this LiveRC results URL already exists — joined your participation.",
            existingEventId: existing.id,
            event: event ? mapEventForUser(event, userId) : null,
          },
          { status: 409 }
        );
      }
    }

    const event = await prisma.event.create({
      data: {
        userId: userId,
        name,
        trackId,
        trackNameSnapshot: track.name,
        trackLocationSnapshot: track.location,
        trackLayoutId: trackLayout?.id ?? null,
        trackLayoutNameSnapshot: trackLayout?.name ?? null,
        trackDirection,
        startDate,
        endDate,
        practiceSourceUrl,
        resultsSourceUrl,
        myRcmUrl,
      },
      include: EVENT_LIST_INCLUDE,
    });

    await ensureEventParticipation({
      userId: userId,
      eventId: event.id,
      notes: body.notes,
      controlledTireLabel,
      controlledTireTypeId,
      controlledAdditiveTypeId,
    });

    const withParts = await prisma.event.findUnique({
      where: { id: event.id },
      include: EVENT_LIST_INCLUDE,
    });

    // Paddock's hero is the next booked meeting and its model is cached — without this the
    // tab still reads "No meeting planned" for up to 30s after you book one.
    revalidateAfterEventMutation(userId);

    return NextResponse.json(
      { event: withParts ? mapEventForUser(withParts, userId) : mapEventForUser(event, userId) },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
