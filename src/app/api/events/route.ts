import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

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
        event: { select: { id: true, name: true, trackId: true, startDate: true, endDate: true, notes: true } },
      },
    });

    if (recentRun?.event) {
      return NextResponse.json({ suggestedEvent: recentRun.event });
    }
    return NextResponse.json({ suggestedEvent: null });
  }

  const events = await prisma.event.findMany({
    where: { userId: user.id },
    orderBy: { startDate: "desc" },
    take: 50,
    include: {
      track: { select: { id: true, name: true, location: true } },
    },
  });

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
      where: { id: trackId, userId: user.id },
      select: { id: true },
    });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 400 });
    }

    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const endDate = body.endDate ? new Date(body.endDate) : new Date(startDate);

    function utcYmd(d: Date): string {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    if (utcYmd(endDate) < utcYmd(startDate)) {
      return NextResponse.json(
        { error: "End date must be on or after the start date." },
        { status: 400 }
      );
    }

    const practiceSourceUrl =
      typeof body.practiceSourceUrl === "string" && body.practiceSourceUrl.trim()
        ? body.practiceSourceUrl.trim()
        : null;
    const resultsSourceUrl =
      typeof body.resultsSourceUrl === "string" && body.resultsSourceUrl.trim()
        ? body.resultsSourceUrl.trim()
        : null;
    const controlledTireLabel =
      typeof body.controlledTireLabel === "string" && body.controlledTireLabel.trim()
        ? body.controlledTireLabel.trim()
        : null;

    const event = await prisma.event.create({
      data: {
        userId: user.id,
        name,
        trackId,
        startDate,
        endDate,
        notes: body.notes?.trim() || null,
        practiceSourceUrl,
        resultsSourceUrl,
        controlledTireLabel,
      },
      include: {
        track: { select: { id: true, name: true, location: true } },
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
