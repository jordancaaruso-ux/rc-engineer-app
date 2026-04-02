import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => ({}))) as { setupData?: SetupSnapshotData; carId?: string | null };

  const carId =
    typeof body.carId === "string" && body.carId.trim()
      ? body.carId.trim()
      : null;
  if (carId) {
    const car = await prisma.car.findFirst({ where: { id: carId, userId: user.id }, select: { id: true } });
    if (!car) return NextResponse.json({ error: "Car not found" }, { status: 400 });
  }

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true, createdSetupId: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.createdSetupId) {
    return NextResponse.json({ error: "This document already has a created setup." }, { status: 409 });
  }

  const setup = await prisma.setupSnapshot.create({
    data: {
      userId: user.id,
      carId,
      data: normalizeSetupSnapshotForStorage(body.setupData ?? {}) as object,
    },
    select: { id: true, createdAt: true },
  });

  const linked = await prisma.setupDocument.updateMany({
    where: { id, userId: user.id, createdSetupId: null },
    data: { createdSetupId: setup.id },
  });
  if (linked.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ setup }, { status: 201 });
}

