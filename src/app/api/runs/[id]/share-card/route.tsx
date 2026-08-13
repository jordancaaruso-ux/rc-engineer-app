import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { buildShareRunCard, parseCardStyle, parseSectionsParam } from "@/lib/share/shareCardModel";
import { renderRunCard } from "@/lib/share/renderRunCard";

/**
 * The run picture, as a PNG.
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

const shareRunSelect = {
  id: true,
  userId: true,
  shareWithTeam: true,
  carId: true,
  createdAt: true,
  sortAt: true,
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
  const sections = parseSectionsParam(searchParams.get("sections"));

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
    // The Hero masthead's stamp: `SAT 8 AUG 2026`. Formatted here, where the zone is known.
    dateStamp: formatShareDateStamp(instant, timeZone),
    driverName: run.user?.name ?? null,
    setupData: run.setupSnapshot?.data,
    previousSetupData,
  });

  return renderRunCard(card);
}

/** `SAT 8 AUG 2026` — the Hero masthead stamp, in the viewer's zone like every other date here. */
function formatShareDateStamp(instant: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  })
    .format(instant)
    .replace(/,/g, "")
    .toUpperCase();
}
