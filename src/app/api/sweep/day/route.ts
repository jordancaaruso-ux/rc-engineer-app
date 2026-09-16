import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getEntitlementFor } from "@/lib/entitlement";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  fileDayLooseWithCar,
  getMyDay,
  listGetMyDayTracks,
  loadGetMyDayTrack,
  pendingCarQuestion,
} from "@/lib/sweep/getMyDay";
import { GET_MY_DAY_DAYS, daysFromToday } from "@/lib/sweep/getMyDayDays";

export const dynamic = "force-dynamic";
/** LiveRC's race crawl alone can take 35 s; Speedhive and LiveRC are read side by side. */
export const maxDuration = 120;

/**
 * "Get my day" (founder call 2026-09-15). GET lists the tracks the sheet offers; POST reads the
 * timing sites once for the named track and day and files it (`getMyDay.ts`). Body:
 * `{ trackId, ymd }`, or `{ trackId, ymd, carId }` to file the day's loose sessions with that car.
 */
export async function GET(req: Request): Promise<Response> {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `?trackId=&ymd=` — the "Which car?" sheet arriving from the 8 pm notification: how many of
  // that day's sessions are still waiting, and the cars to offer. Database only, no timing site.
  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId")?.trim();
  const ymd = url.searchParams.get("ymd")?.trim();
  if (trackId && ymd) {
    const track = await loadGetMyDayTrack(trackId);
    if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
    const pending = await pendingCarQuestion({ userId: user.id, track, ymd });
    const cars =
      pending.needsCar > 0
        ? await prisma.car.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true },
          })
        : [];
    return NextResponse.json({ ok: true, ...pending, trackName: track.name, cars });
  }

  const tracks = await listGetMyDayTracks(user.id);
  return NextResponse.json({ tracks, defaultTrackId: tracks[0]?.id ?? null });
}

export async function POST(req: Request): Promise<Response> {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const entitlement = await getEntitlementFor(user.id, user.email ?? null);
  if (!entitlement.entitled) return NextResponse.json({ error: "Not on a plan" }, { status: 403 });

  let body: { trackId?: unknown; ymd?: unknown; carId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const trackId = typeof body.trackId === "string" ? body.trackId.trim() : "";
  const ymd = typeof body.ymd === "string" ? body.ymd.trim() : "";
  const carId = typeof body.carId === "string" && body.carId.trim() ? body.carId.trim() : null;
  if (!trackId || !ymd) {
    return NextResponse.json({ error: "trackId and ymd are required" }, { status: 400 });
  }

  const track = await loadGetMyDayTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  if (!track.speedhiveUrl && !track.liveRcUrl) {
    return NextResponse.json({ error: "That track has no timing link" }, { status: 400 });
  }

  const now = new Date();
  // The sheet offers the last few days in the phone's calendar; a day either side of the track's
  // covers a driver whose phone and track sit in different zones.
  const offset = daysFromToday(ymd, now, track.timeZone);
  if (offset == null || offset > 1 || offset < -GET_MY_DAY_DAYS) {
    return NextResponse.json({ error: "Pick a day from the last few" }, { status: 400 });
  }

  try {
    let result;
    if (carId) {
      const car = await prisma.car.findFirst({ where: { id: carId, userId: user.id }, select: { id: true } });
      if (!car) return NextResponse.json({ error: "Car not found" }, { status: 400 });
      result = await fileDayLooseWithCar({ userId: user.id, track, ymd, carId });
    } else {
      result = await getMyDay({ userId: user.id, track, ymd, now });
    }
    const cars =
      result.needsCar > 0
        ? await prisma.car.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true },
          })
        : [];
    return NextResponse.json({ ok: true, ...result, cars });
  } catch (err) {
    reportSweepFailure(err, { stage: "day", trackId, userId: user.id });
    return NextResponse.json({ error: "Couldn't get your day" }, { status: 500 });
  }
}
