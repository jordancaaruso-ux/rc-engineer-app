import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SetupSheetTemplateView } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import { getSetupSheetTemplateAndKeyForCar } from "@/lib/setupSheetModels/getTemplateForCar";

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

  const { template, templateKey } = await getSetupSheetTemplateAndKeyForCar(userId, car, view);
  return NextResponse.json(
    { template, templateKey },
    { headers: { "Cache-Control": "no-store" } }
  );
}
