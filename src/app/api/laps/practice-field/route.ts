import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { requireApiFeature } from "@/lib/entitlementGuards";
import { prisma } from "@/lib/prisma";
import {
  isPracticeDayYmd,
  loadLiveRcPracticeField,
  loadMylapsPracticeField,
  practiceFieldSourcesForTrack,
} from "@/lib/practiceField/loadPracticeField";
import type { PracticeFieldSource } from "@/lib/practiceField/practiceField";

/**
 * Everyone's practice at a track — the list behind "Someone else's practice" and the lap sheet's
 * Practice tab.
 *
 * GET says which timing sites a track can be read from. It touches our database only, so a
 * screen can decide whether to offer the door at all without anything leaving the building.
 *
 * POST is the look itself: one request to one timing site, on a press, never on a timer
 * (founder call 2026-08-27 — a poller against a timing service on behalf of drivers who never
 * signed up here is a different product). POST rather than GET so nothing can trigger it by
 * prefetching a link.
 */

const LOOKS_PER_HOUR = 60;

async function trackTimingLinks(trackId: string) {
  return prisma.track.findUnique({
    where: { id: trackId },
    select: { name: true, liveRcUrl: true, speedhiveUrl: true },
  });
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  // Same door as the sheet it feeds: lap time analysis is Race Engineer's (founder call
  // 2026-09-24). A 402 here is also what keeps the Practice tab off a run's lap sheet below it.
  const gate = await requireApiFeature("lap-analysis");
  if (gate.response) return gate.response;

  const trackId = new URL(request.url).searchParams.get("trackId")?.trim();
  if (!trackId) return NextResponse.json({ sources: [] });
  const track = await trackTimingLinks(trackId);
  return NextResponse.json({ sources: track ? practiceFieldSourcesForTrack(track) : [] });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const gate = await requireApiFeature("lap-analysis");
  if (gate.response) return gate.response;
  const user = gate.user;

  const rl = checkApiRateLimit({
    key: `practice-field:${user.id}`,
    limit: LOOKS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
    userEmail: user.email,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as {
    trackId?: string;
    source?: string;
    day?: string;
  } | null;

  const trackId = body?.trackId?.trim();
  if (!trackId) return NextResponse.json({ error: "Pick a track to look at." }, { status: 400 });

  const track = await trackTimingLinks(trackId);
  if (!track) return NextResponse.json({ error: "That track isn't here any more." }, { status: 404 });

  const sources = practiceFieldSourcesForTrack(track);
  if (sources.length === 0) {
    return NextResponse.json(
      { error: "That track has no LiveRC or MYLAPS link saved." },
      { status: 400 }
    );
  }
  // An unknown or missing source falls to the track's first; a site the track isn't on never runs.
  const source: PracticeFieldSource = sources.includes(body?.source as PracticeFieldSource)
    ? (body!.source as PracticeFieldSource)
    : sources[0]!;

  if (source === "liverc") {
    if (!isPracticeDayYmd(body?.day)) {
      return NextResponse.json({ error: "Pick a day to look at." }, { status: 400 });
    }
    const result = await loadLiveRcPracticeField({
      userId: user.id,
      trackLiveRcUrl: track.liveRcUrl!,
      dayYmd: body.day,
    });
    return NextResponse.json({ ...result, sources, trackLabel: track.name });
  }

  const result = await loadMylapsPracticeField({
    userId: user.id,
    trackSpeedhiveUrl: track.speedhiveUrl!,
  });
  return NextResponse.json({ ...result, sources, trackLabel: track.name });
}
