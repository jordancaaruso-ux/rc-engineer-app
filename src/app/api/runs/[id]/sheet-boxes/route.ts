import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { chassisFillsAsSheet, parseStoredBoxes } from "@/lib/setupSheetModels/sheetPlan";
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import { changedBoxCrops } from "@/lib/setupCompare/changedBoxRegion";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Enough for any real setup change; a longer list is a mistake, not a run. */
const MAX_KEYS = 120;

/**
 * Where on this run's sheet a given set of boxes sits, cropped ready to draw.
 *
 * Asked for by key, because the caller already knows which boxes changed — it is showing the diff.
 * Sending the keys back rather than recomputing the diff here keeps one definition of "changed" in
 * the app instead of two that can drift apart.
 *
 * Only the boxes asked for come back, so this is a few hundred bytes rather than the tens of
 * kilobytes the full box list weighs. That is what lets it sit on a run detail.
 *
 * ============================== WHY THE RUN AND NOT THE CAR ==============================
 *
 * This was `/api/cars/[carId]/sheet-boxes`, which found the car with `where: { id, userId }` —
 * cars are owner-only by ruling (`ASSET_ACCESS_NORTH_STAR`). On a TEAMMATE's run that 404s, and the
 * caller reads a 404 as "this chassis has no sheet", so the opener next to every changed row simply
 * never appeared. Not a locked door: a door that was never drawn.
 *
 * Nothing behind it was ever theirs. The rectangles come from the chassis's blank, which is global
 * catalog and shared by everyone racing that model; the page picture (`/sheet-page`) is served to
 * any signed-in driver; and the only value drawn on the crop is the one the caller is already
 * printing in the row the crop opened from. The car check was guarding the NAME, not the thing —
 * `carId` was merely how the caller happened to point at a chassis.
 *
 * So the question moves to the run, which is the object the viewer's access was actually decided
 * on. Exactly the move `buildSheetContext` in `setup-snapshot/route.ts` already made when the same
 * owner-only lookup made a teammate's sheet open as the legacy field list.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const run = await prisma.run.findFirst({
    where: { id },
    select: {
      userId: true,
      shareWithTeam: true,
      car: { select: { setupSheetModelId: true } },
      // Not returned — read only to choose which of the chassis's sheets these boxes are on.
      setupSnapshot: { select: { data: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await viewerMayAccessRun(userId, run))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYS);

  /*
   * Which of the chassis's sheets prints these boxes, decided by the SNAPSHOT's keys rather than by
   * the changed ones. A setup imported through a rebuilt EDITION is written on that edition's paper,
   * and the whole setup says which far more reliably than the handful of fields that moved since
   * last run. It also means the crop and the run's own sheet can never disagree about the paper —
   * `buildSheetContext` picks the blank the same way. See `sheetBlankResolve`.
   */
  const snapshotData = run.setupSnapshot?.data;
  const blank = run.car?.setupSheetModelId
    ? await pickSheetBlankForData(
        run.car.setupSheetModelId,
        snapshotData && typeof snapshotData === "object" && !Array.isArray(snapshotData)
          ? (snapshotData as Record<string, unknown>)
          : null
      )
    : null;

  // Not a mistake and not an error: most chassis fill as an ordinary form and have no sheet to
  // draw. The caller shows its list instead.
  if (!chassisFillsAsSheet(blank) || !run.car?.setupSheetModelId) {
    return NextResponse.json({ sheetMode: false, setupSheetModelId: null, crops: [] });
  }

  return NextResponse.json({
    sheetMode: true,
    setupSheetModelId: run.car.setupSheetModelId,
    // The crop images come from the same sheet the boxes do. Null = the primary blank.
    editionBlankId: blank?.isEdition ? blank.id : null,
    crops: changedBoxCrops(parseStoredBoxes(blank?.boxesJson), keys),
  });
}
