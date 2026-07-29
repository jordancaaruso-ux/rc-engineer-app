import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import { templateKeyFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";
import { revalidateAfterCarMutation } from "@/lib/revalidateUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(
  _request: Request,
  context: { params: Promise<{ carId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await context.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: userId },
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, createdAt: true },
  });

  if (!car) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { userId: userId, carId },
  });

  return NextResponse.json({ car, runCount });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ carId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await context.params;

  const deleted = await prisma.car.deleteMany({
    where: { id: carId, userId: userId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }

  revalidateAfterCarMutation(userId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ carId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { carId } = await context.params;

  const existing = await prisma.car.findFirst({
    where: { id: carId, userId: userId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    chassis?: string | null;
    notes?: string | null;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  };

  const data: {
    name?: string;
    chassis?: string | null;
    notes?: string | null;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  } = {};
  if (body.name !== undefined) {
    const v = body.name?.trim();
    if (v) data.name = v;
  }
  if (body.chassis !== undefined) data.chassis = body.chassis?.trim() || null;
  // `carClass` is no longer settable — the picker was dropped 2026-07-22 and the car-swap rule
  // now infers the platform from the chassis. The column stays in the DB, dormant.
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.setupSheetTemplate !== undefined) {
    data.setupSheetTemplate = canonicalSetupSheetTemplateId(body.setupSheetTemplate);
  }
  if (body.setupSheetModelId !== undefined) {
    const modelId = body.setupSheetModelId?.trim() || null;
    if (!modelId) {
      data.setupSheetModelId = null;
    } else {
      const model = await prisma.setupSheetModel.findUnique({
        where: { id: modelId },
        select: { id: true, slug: true },
      });
      if (!model) {
        return NextResponse.json({ error: "Invalid setup sheet model" }, { status: 400 });
      }
      data.setupSheetModelId = model.id;
      // Keep the template key in sync with the model — community aggregations bucket by it.
      data.setupSheetTemplate = templateKeyFromModelSlug(model.slug);
    }
  }
  if (Object.keys(data).length === 0) {
    const car = await prisma.car.findFirst({
      where: { id: carId, userId: userId },
      select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, setupSheetModelId: true, createdAt: true },
    });
    return NextResponse.json({ car });
  }

  const car = await prisma.car.update({
    where: { id: carId },
    data,
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, setupSheetModelId: true, createdAt: true },
  });
  revalidateAfterCarMutation(userId);
  return NextResponse.json({ car });
}

