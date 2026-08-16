import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SetupSheetTemplateView } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { getSetupSheetTemplateAndKeyForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";

type RouteCtx = { params: Promise<{ carId: string }> };

function parseTemplateView(raw: string | null): SetupSheetTemplateView {
  if (raw === "logRun") return "logRun";
  if (raw === "analysis") return "analysis";
  return "setup";
}

export async function GET(request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await ctx.params;
  const view = parseTemplateView(new URL(request.url).searchParams.get("view"));

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: userId },
    select: { setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /*
   * Does this car fill in on a picture of its own sheet?
   *
   * Asked here because the run form already makes this request every time the car changes, and the
   * only other way to ask is to fetch the box list — the same answer, tens of kilobytes heavier,
   * and pointless until the driver actually opens the sheet.
   *
   * A derived chassis is always attached to a car by id, so there is nothing to resolve: no
   * `setupSheetModelId` means no sheet.
   */
  const blank = car.setupSheetModelId
    ? await prisma.setupSheetBlank.findFirst({
        // The PRIMARY blank answers "does this car fill as a sheet"; which EDITION a given setup
        // draws on is a per-setup question the surfaces ask through `sheet-blank-pick`.
        where: { setupSheetModelId: car.setupSheetModelId, isEdition: false },
        orderBy: { createdAt: "asc" },
        select: { fillSurface: true, boxesJson: true },
      })
    : null;

  const { template, templateKey } = await getSetupSheetTemplateAndKeyForCar(userId, car, view);
  return NextResponse.json(
    {
      template,
      templateKey,
      setupSheetModelId: car.setupSheetModelId,
      sheetMode: chassisFillsAsSheet(blank),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
