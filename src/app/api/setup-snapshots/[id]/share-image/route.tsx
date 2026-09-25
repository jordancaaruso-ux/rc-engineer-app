import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { renderSetupSheetImage, renderSetupSheetStory } from "@/lib/share/renderSetupImage";
import { formatShareDateStamp } from "@/lib/share/shareDate";
import type { SheetStoryHeading } from "@/lib/share/renderSetupStory";

/**
 * A setup, as a picture of its own sheet: the plain page, or with `?format=story&run=<id>` the
 * same page framed as a 9:16 story with the car and the day above it.
 *
 * Owner-only, unlike the run card. `ensureRenderedSetupSnapshotPdf` is already scoped by `userId`
 * internally, so the explicit `userId` here is what stops a peer probing another driver's
 * snapshot ids. Sharing a teammate's setup is their call to make, not yours. The story's run is
 * read under the same owner scope, and must be the run this setup belongs to.
 *
 * 404 when the chassis has no sheet the app can draw. There is deliberately no fallback picture:
 * a setup share must always look like the sheet, so the honest answer is a sentence naming what is
 * missing, which the Share button shows the driver verbatim.
 */

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const story = searchParams.get("format") === "story";

  const snapshot = await prisma.setupSnapshot.findFirst({
    where: { id, userId },
    select: { id: true, car: { select: { name: true } } },
  });
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = story
    ? await renderSetupSheetStory({
        userId,
        setupSnapshotId: snapshot.id,
        heading: await storyHeading(userId, snapshot, searchParams.get("run")),
      })
    : await renderSetupSheetImage({ userId, setupSnapshotId: snapshot.id });
  if (!bytes) {
    return NextResponse.json(
      {
        error:
          "This car has no setup sheet the app can draw yet — link it to a chassis type with a sheet, or import a setup PDF.",
      },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=300",
    },
  });
}

/**
 * What the story page says above the sheet: the car, the day, and where. Read from the run the
 * sheet is being shared with; without one (or with somebody else's) it falls back to the car alone.
 */
async function storyHeading(
  userId: string,
  snapshot: { id: string; car: { name: string } | null },
  runId: string | null
): Promise<SheetStoryHeading> {
  const run = runId
    ? await prisma.run.findFirst({
        where: { id: runId, userId, setupSnapshotId: snapshot.id },
        select: {
          createdAt: true,
          sortAt: true,
          sessionCompletedAt: true,
          loggingCompletedAt: true,
          importedLapTimeSessionId: true,
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
          carNameSnapshot: true,
          trackNameSnapshot: true,
          car: { select: { name: true } },
          track: { select: { name: true } },
          user: { select: { name: true } },
        },
      })
    : null;
  const carName = run?.car?.name ?? run?.carNameSnapshot ?? snapshot.car?.name ?? "Setup";
  if (!run) return { carName, dateCaps: null, details: [] };

  const timeZone = await getExplicitTimeZoneForRunFormatting();
  return {
    carName,
    dateCaps: formatShareDateStamp(resolveRunDisplayInstant(run), timeZone),
    details: [
      run.track?.name ?? run.trackNameSnapshot ?? null,
      formatRunSessionDisplay(run, { fallback: "Testing run" }),
      run.user?.name ?? null,
    ],
  };
}
