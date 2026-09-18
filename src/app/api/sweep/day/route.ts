import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getEntitlementFor } from "@/lib/entitlement";
import { reportSweepFailure } from "@/lib/observability/reportSweep";
import {
  getMyDay,
  listGetMyDayTracks,
  loadGetMyDayTrack,
  logChosenForDay,
  pendingForDay,
  searchGetMyDayTracks,
} from "@/lib/sweep/getMyDay";
import { GET_MY_DAY_REACH_DAYS, daysFromToday } from "@/lib/sweep/getMyDayDays";
import { loadChipMovedQuestion } from "@/lib/sweep/chipMovedQuestion";

export const dynamic = "force-dynamic";
/** LiveRC's race crawl alone can take 35 s; Speedhive and LiveRC are read side by side. */
export const maxDuration = 120;

/**
 * "Import your last runs" (founder call 2026-09-15; nothing files itself since 2026-09-18).
 * GET lists the tracks the sheet offers, or with `?trackId=&ymd=` the day's pending runs. POST
 * `{ trackId, ymd }` reads the timing sites once for that day and answers the pending list;
 * POST `{ trackId, ymd, keep, decline, carId? }` logs the ticked rows and puts the unticked away.
 */
export async function GET(req: Request): Promise<Response> {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `?trackId=&ymd=` — the sheet arriving from the 8 pm notification or the dashboard row: the
  // day's pending runs, and the cars to offer. Database only, no timing site.
  const url = new URL(req.url);
  const trackId = url.searchParams.get("trackId")?.trim();
  const ymd = url.searchParams.get("ymd")?.trim();
  if (trackId && ymd) {
    const track = await loadGetMyDayTrack(trackId);
    if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
    const day = await pendingForDay({ userId: user.id, track, ymd });
    return NextResponse.json({ ok: true, ...day, trackName: track.name, cars: await carsFor(user.id, day.needsCar) });
  }

  // `?q=` — the sheet's search box: any catalog track with a timing link, not just the driver's.
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    return NextResponse.json({ q, tracks: await searchGetMyDayTracks(user, q) });
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

  let body: { trackId?: unknown; ymd?: unknown; carId?: unknown; keep?: unknown; decline?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const trackId = typeof body.trackId === "string" ? body.trackId.trim() : "";
  const ymd = typeof body.ymd === "string" ? body.ymd.trim() : "";
  const carId = typeof body.carId === "string" && body.carId.trim() ? body.carId.trim() : null;
  const keep = idList(body.keep);
  const decline = idList(body.decline);
  const choosing = keep !== null || decline !== null;
  if (!trackId || !ymd) {
    return NextResponse.json({ error: "trackId and ymd are required" }, { status: 400 });
  }

  const track = await loadGetMyDayTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  if (!track.speedhiveUrl && !track.liveRcUrl) {
    return NextResponse.json({ error: "That track has no timing link" }, { status: 400 });
  }

  const now = new Date();
  // The calendar reaches back a fortnight in the phone's calendar; a day either side of the
  // track's covers a driver whose phone and track sit in different zones. A range is read one
  // day per request (the sheet's loop), so this stays a single-day check. A choice made from the
  // notification is about a day already read, so its reach is not re-checked.
  const offset = daysFromToday(ymd, now, track.timeZone);
  if (!choosing && (offset == null || offset > 1 || offset < -GET_MY_DAY_REACH_DAYS)) {
    return NextResponse.json({ error: "Pick a day from the last fortnight" }, { status: 400 });
  }

  try {
    if (choosing) {
      if (carId) {
        const car = await prisma.car.findFirst({ where: { id: carId, userId: user.id }, select: { id: true } });
        if (!car) return NextResponse.json({ error: "Car not found" }, { status: 400 });
      }
      const result = await logChosenForDay({
        userId: user.id,
        track,
        ymd,
        keep: keep ?? [],
        decline: decline ?? [],
        carId,
      });
      return NextResponse.json({ ok: true, ...result, cars: await carsFor(user.id, result.needsCar) });
    }
    const result = await getMyDay({ userId: user.id, track, ymd, now });
    const [cars, chipMoved] = await Promise.all([
      carsFor(user.id, result.needsCar),
      // A chip seen in a different car than it is paired with — asked once, after the import.
      loadChipMovedQuestion(user.id).catch(() => null),
    ]);
    return NextResponse.json({ ok: true, ...result, cars, chipMoved });
  } catch (err) {
    reportSweepFailure(err, { stage: "day", trackId, userId: user.id });
    return NextResponse.json({ error: "Couldn't get your day" }, { status: 500 });
  }
}

/** The cars to offer when a pending row has none; nothing when every row has one. */
async function carsFor(userId: string, needsCar: number): Promise<Array<{ id: string; name: string }>> {
  if (needsCar <= 0) return [];
  return prisma.car.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}
