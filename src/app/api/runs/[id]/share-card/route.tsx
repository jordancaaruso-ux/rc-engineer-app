import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import {
  buildShareRunCard,
  parseCardStyle,
  parseSectionsParam,
} from "@/lib/share/shareCardModel";
import { renderReportPng } from "@/lib/share/renderReportCard";
import { renderStoryLook } from "@/lib/share/storyLooks";
import { buildStoryData, parseStoryFrame, parseStoryLook } from "@/lib/share/storyModel";
import { raceFieldSummaryForRun } from "@/lib/share/paceVsField";
import { formatShareDateStamp } from "@/lib/share/shareDate";
import { parseUnitSystem } from "@/lib/units/unitSystem";
import { unitSystemForRequest } from "@/lib/units/unitSystemServer";

/**
 * The run picture. `?style=story` is a story look as a JPEG (`look=A|B|C|D`, `frame=story|post`);
 * `hero` / `report` are the long paper info card, as a PNG.
 *
 * POST draws the same story with the driver's own photo in it (multipart field `photo`). The
 * photo is used for this one picture and never stored: the share sheet keeps it and sends it with
 * every redraw. Demo accounts cannot POST (see below), so the demo shares the designed backdrops.
 *
 * GET, not POST, for everything else on purpose. Demo accounts are blocked from every mutating route by the
 * read-only chokepoint in `middleware.ts`, and a demo user sharing a branded card is free
 * advertising — so the whole path has to be readable. It also means the client can point an
 * `<img>` straight at this URL for the share sheet's live preview.
 *
 * OWNER-ONLY, which is stricter than `/runs/[id]` itself. A teammate can already *read* your run,
 * but publishing it outward under the app's branding is a decision only the driver who logged it
 * gets to make — so this is scoped by `userId` rather than by `viewerMayAccessRun`. Same reasoning
 * as the setup image route.
 */

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** A phone photo, downscaled by the sheet to ~1600px; anything past this is not a photo we asked for. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const shareRunSelect = {
  id: true,
  userId: true,
  shareWithTeam: true,
  carId: true,
  createdAt: true,
  sortAt: true,
  importedLapTimeSessionId: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  lapTimes: true,
  lapSession: true,
  notes: true,
  driverNotes: true,
  handlingAssessmentJson: true,
  carRating: true,
  tireRunNumber: true,
  tireAgeKnown: true,
  warmerTimingMinutes: true,
  tirePrep: true,
  conditionsAirTempC: true,
  conditionsTrackTempC: true,
  conditionsCloudCoverPct: true,
  conditionsWeatherCode: true,
  conditionsHumidityPct: true,
  conditionsWindKph: true,
  setupSnapshotId: true,
  car: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
  tireType: { select: { displayName: true } },
  additiveType: { select: { displayName: true } },
  event: { select: { name: true } },
  user: { select: { name: true } },
  setupSnapshot: { select: { id: true, data: true } },
  // The name the timing sheet printed, for a story whose driver never saved a name.
  importedLapSets: { where: { isPrimaryUser: true }, select: { driverName: true }, take: 1 },
} as const;

export async function GET(request: Request, { params }: Params) {
  return draw(request, params, null);
}

export async function POST(request: Request, { params }: Params) {
  let photo: Buffer | null = null;
  try {
    const form = await request.formData();
    const file = form.get("photo");
    if (file instanceof Blob && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: "That photo is too big. Try a smaller one." }, { status: 413 });
      }
      photo = Buffer.from(await file.arrayBuffer());
    }
  } catch {
    return NextResponse.json({ error: "Couldn't read that photo" }, { status: 400 });
  }
  return draw(request, params, photo);
}

async function draw(request: Request, params: Params["params"], photo: Buffer | null) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const style = parseCardStyle(searchParams.get("style"));
  const story = style === "story";

  const run = await prisma.run.findFirst({ where: { id, userId }, select: shareRunSelect });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const instant = resolveRunDisplayInstant(run);
  const dateStamp = formatShareDateStamp(instant, timeZone);

  if (story) {
    const field = await raceFieldSummaryForRun(userId, run.id, run);
    const data = buildStoryData({
      run,
      dateStamp,
      accountName: run.user?.name ?? null,
      field,
      timingName: run.importedLapSets[0]?.driverName ?? null,
    });
    let jpeg: Buffer;
    try {
      jpeg = await renderStoryLook(data, {
        look: parseStoryLook(searchParams.get("look")),
        frame: parseStoryFrame(searchParams.get("frame")),
        photo,
      });
    } catch (e) {
      // A file that says image/* but isn't one: sharp throws on decode. Say so rather than 500.
      if (photo) return NextResponse.json({ error: "Couldn't use that photo. Try another." }, { status: 400 });
      throw e;
    }
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpeg.length),
        // A photo story is drawn per request and must not sit in a cache under a shared address.
        "Cache-Control": photo ? "no-store" : "private, max-age=300",
      },
    });
  }

  const sections = parseSectionsParam(searchParams.get("sections"));
  // The share sheet sends the unit it is showing; a bare URL gets the driver's own.
  const units = parseUnitSystem(searchParams.get("units")) ?? (await unitSystemForRequest(userId));

  /*
   * "Changed since last run" is the diff against the previous run on the SAME car, which is what
   * the session view shows. `sortAt` is the stable ordering axis (see the three-timestamps note in
   * CLAUDE.md) — ordering by `createdAt` would reshuffle a day after a re-import and silently
   * change which run the driver is being compared against.
   */
  let previousSetupData: unknown = undefined;
  if (sections.setup && run.carId) {
    const previous = await prisma.run.findFirst({
      // `setupSnapshotId` is required on Run — every run has one — so there is nothing to filter for.
      where: {
        carId: run.carId,
        userId: run.userId,
        sortAt: { lt: run.sortAt ?? run.createdAt },
      },
      orderBy: { sortAt: "desc" },
      select: { setupSnapshot: { select: { data: true } } },
    });
    previousSetupData = previous?.setupSnapshot?.data ?? undefined;
  }

  const card = buildShareRunCard({
    run,
    style,
    sections,
    dateTimeLabel: formatRunDateTime(instant, timeZone),
    dateStamp,
    driverName: run.user?.name ?? null,
    setupData: run.setupSnapshot?.data,
    previousSetupData,
    units,
  });

  const png = await renderReportPng(card);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      // The picture is a snapshot of a saved run; it only changes when the run does. Also what lets
      // the sheet's blob prefetch reuse the render the preview `<img>` already paid for.
      "Cache-Control": "private, max-age=300",
    },
  });
}
