import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
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

  const user = await getOrCreateLocalUser();
  const { carId } = await context.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, createdAt: true },
  });

  if (!car) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { userId: user.id, carId },
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

  const user = await getOrCreateLocalUser();
  const { carId } = await context.params;

  const deleted = await prisma.car.deleteMany({
    where: { id: carId, userId: user.id },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }

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

  const user = await getOrCreateLocalUser();
  const { carId } = await context.params;

  const existing = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
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
  };

  const data: {
    name?: string;
    chassis?: string | null;
    notes?: string | null;
    setupSheetTemplate?: string | null;
  } = {};
  if (body.name !== undefined) {
    const v = body.name?.trim();
    if (v) data.name = v;
  }
  if (body.chassis !== undefined) data.chassis = body.chassis?.trim() || null;
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.setupSheetTemplate !== undefined) {
    data.setupSheetTemplate = body.setupSheetTemplate === "awesomatix_a800rr" ? "awesomatix_a800rr" : null;
  }
  if (Object.keys(data).length === 0) {
    const car = await prisma.car.findFirst({
      where: { id: carId, userId: user.id },
      select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, createdAt: true },
    });
    return NextResponse.json({ car });
  }

  const car = await prisma.car.update({
    where: { id: carId },
    data,
    select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true, createdAt: true },
  });
  return NextResponse.json({ car });
}

