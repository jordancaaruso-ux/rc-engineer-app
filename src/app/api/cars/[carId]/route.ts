import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import { isChassisPlatformId } from "@/lib/cars/carClasses";
import { templateKeyFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";
import { revalidateAfterCarMutation } from "@/lib/revalidateUser";
import { carNameTakenMessage, findCarNameClash } from "@/lib/cars/carName";
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
    carClass?: string | null;
    notes?: string | null;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  };

  const data: {
    name?: string;
    chassis?: string | null;
    carClass?: string | null;
    notes?: string | null;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  } = {};
  if (body.name !== undefined) {
    const v = body.name?.trim();
    if (v) {
      // Renaming onto another car's name is the same collision as creating one — same answer.
      const siblings = await prisma.car.findMany({
        where: { userId },
        select: { id: true, name: true },
      });
      const clash = findCarNameClash(siblings, v, carId);
      if (clash) {
        return NextResponse.json({ error: carNameTakenMessage(clash.name) }, { status: 409 });
      }
      data.name = v;
    }
  }
  if (body.chassis !== undefined) data.chassis = body.chassis?.trim() || null;
  /*
   * `carClass` is settable again (founder call 2026-08-03), but only as the *override* half of
   * `disciplineForCar`: the chassis catalog answers first, and this fills the gap for a chassis
   * it can't place. It was unsettable from 2026-07-22, when the always-on picker was dropped as
   * noise on a touring-only app — the column survived that, so there is nothing to migrate.
   *
   * Validated against `CHASSIS_PLATFORMS` rather than stored free-text: `isSamePlatform` compares
   * these by equality to scope teammate run lists and the car-swap tire rule, and two spellings of
   * "buggy" would silently read as two disciplines.
   */
  if (body.carClass !== undefined) {
    const raw = body.carClass?.trim() || null;
    if (raw && !isChassisPlatformId(raw)) {
      return NextResponse.json({ error: "Unknown discipline" }, { status: 400 });
    }
    data.carClass = raw;
  }
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
      select: { id: true, name: true, chassis: true, carClass: true, notes: true, setupSheetTemplate: true, setupSheetModelId: true, createdAt: true },
    });
    return NextResponse.json({ car });
  }

  const car = await prisma.car.update({
    where: { id: carId },
    data,
    select: { id: true, name: true, chassis: true, carClass: true, notes: true, setupSheetTemplate: true, setupSheetModelId: true, createdAt: true },
  });
  revalidateAfterCarMutation(userId);
  return NextResponse.json({ car });
}

