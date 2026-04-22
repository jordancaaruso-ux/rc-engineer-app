import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import { isCarValidTargetForSetupDocument } from "@/lib/carSetupScope";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { setupData?: SetupSnapshotData; carId?: string | null };

  const doc = await prisma.setupDocument.findFirst({
    where: { id, userId: user.id },
    select: { id: true, createdSetupId: true, carId: true, setupSheetTemplate: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.createdSetupId) {
    return NextResponse.json({ error: "This document already has a created setup." }, { status: 409 });
  }

  const fromBody =
    typeof body.carId === "string" && body.carId.trim() ? body.carId.trim() : null;
  const carId = fromBody ?? doc.carId ?? null;
  if (!carId) {
    return NextResponse.json(
      { error: "carId is required (select a car on the document or in the request)." },
      { status: 400 }
    );
  }
  const car = await prisma.car.findFirst({ where: { id: carId, userId: user.id }, select: { id: true } });
  if (!car) return NextResponse.json({ error: "Car not found" }, { status: 400 });
  const allowed = await isCarValidTargetForSetupDocument(user.id, doc, carId);
  if (!allowed) {
    return NextResponse.json(
      { error: "That car's setup sheet type does not match this document." },
      { status: 400 }
    );
  }

  const setup = await prisma.setupSnapshot.create({
    data: {
      userId: user.id,
      carId: car.id,
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

