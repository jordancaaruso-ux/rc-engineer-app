import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!calibration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ calibration });
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    sourceType?: string;
    calibrationDataJson?: unknown;
  };
  const existing = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await prisma.setupSheetCalibration.update({
    where: { id },
    data: {
      name: body.name?.trim() || undefined,
      sourceType: body.sourceType?.trim() || undefined,
      calibrationDataJson: (body.calibrationDataJson ?? {}) as object,
    },
    select: { id: true, updatedAt: true },
  });
  return NextResponse.json({ calibration: updated });
}

