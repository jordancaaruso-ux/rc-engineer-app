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
  type ShareSections,
} from "@/lib/share/shareCardModel";
import { renderReportPng } from "@/lib/share/renderReportCard";
import { renderStoryPng, STORY_TRACE, type StoryVariant } from "@/lib/share/renderStoryCard";
import { formatShareDateStamp } from "@/lib/share/shareDate";
import { parseUnitSystem } from "@/lib/units/unitSystem";
import { unitSystemForRequest } from "@/lib/units/unitSystemServer";

/**
 * The run picture, as a PNG: `?style=story` is the 9:16 story, `hero` / `report` the long one.
 *
 * GET, not POST, on purpose. Demo accounts are blocked from every mutating route by the
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

/** The story layout drivers get. The founder picks from A/B/C (bench, 2026-09-25). */
const STORY_VARIANT: StoryVariant = "poster";

/**
 * The story is a fixed layout: its figures are the tiles, and of the chip-controlled blocks it
 * draws only the trace. Asking for nothing else also skips the previous run's setup lookup.
 */
const STORY_SECTIONS: ShareSections = {
  details: false,
  laps: false,
  graph: true,
  setup: false,
  notes: false,
  feel: false,
};

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
} as const;

export async function GET(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const style = parseCardStyle(searchParams.get("style"));
  const story = style === "story";
  const sections = story ? STORY_SECTIONS : parseSectionsParam(searchParams.get("sections"));
  // The share sheet sends the unit it is showing; a bare URL gets the driver's own.
  const units = parseUnitSystem(searchParams.get("units")) ?? (await unitSystemForRequest(userId));

  const run = await prisma.run.findFirst({ where: { id, userId }, select: shareRunSelect });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const instant = resolveRunDisplayInstant(run);

  const card = buildShareRunCard({
    run,
    style,
    sections,
    dateTimeLabel: formatRunDateTime(instant, timeZone),
    dateStamp: formatShareDateStamp(instant, timeZone),
    driverName: run.user?.name ?? null,
    setupData: run.setupSnapshot?.data,
    previousSetupData,
    units,
    traceBox: story ? STORY_TRACE : undefined,
  });

  const png = story ? await renderStoryPng(card, STORY_VARIANT) : await renderReportPng(card);
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
