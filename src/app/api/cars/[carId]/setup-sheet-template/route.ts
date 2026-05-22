import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getSetupSheetTemplateForCar } from "@/lib/setupSheetModels/getTemplateForCar";

type RouteCtx = { params: Promise<{ carId: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await ctx.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const template = await getSetupSheetTemplateForCar(user.id, car);
  return NextResponse.json({ template });
}
