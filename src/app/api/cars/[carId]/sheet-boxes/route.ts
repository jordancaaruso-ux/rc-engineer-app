import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { chassisFillsAsSheet, parseStoredBoxes } from "@/lib/setupSheetModels/sheetPlan";
import { changedBoxCrops } from "@/lib/setupCompare/changedBoxRegion";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ carId: string }> };

/** Enough for any real setup change; a longer list is a mistake, not a run. */
const MAX_KEYS = 120;

/**
 * Where on this car's sheet a given set of boxes sits, cropped ready to draw.
 *
 * Asked for by key, because the caller already knows which boxes changed — it is showing the diff.
 * Sending the keys back rather than recomputing the diff here keeps one definition of "changed" in
 * the app instead of two that can drift apart.
 *
 * Only the boxes asked for come back, so this is a few hundred bytes rather than the tens of
 * kilobytes the full box list weighs. That is what lets it sit on a run detail.
 */
export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { carId } = await ctx.params;
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetModelId: true },
  });
  if (!car) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYS);

  const blank = car.setupSheetModelId
    ? await prisma.setupSheetBlank.findUnique({
        where: { setupSheetModelId: car.setupSheetModelId },
        select: { boxesJson: true, fillSurface: true },
      })
    : null;

  // Not a mistake and not an error: most chassis fill as an ordinary form and have no sheet to
  // draw. The caller shows its list instead.
  if (!chassisFillsAsSheet(blank) || !car.setupSheetModelId) {
    return NextResponse.json({ sheetMode: false, setupSheetModelId: null, crops: [] });
  }

  return NextResponse.json({
    sheetMode: true,
    setupSheetModelId: car.setupSheetModelId,
    crops: changedBoxCrops(parseStoredBoxes(blank?.boxesJson), keys),
  });
}
