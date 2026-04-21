import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
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
  return NextResponse.json({ calibrations });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    sourceType?: string;
    calibrationDataJson?: unknown;
    exampleDocumentId?: string | null;
    clonedFromCalibrationId?: string | null;
  };
  const name = body.name?.trim() || "Setup sheet calibration";
  const sourceType = body.sourceType?.trim() || "awesomatix_pdf";
  let inheritedExampleDocumentId: string | null = null;
  if (body.clonedFromCalibrationId?.trim()) {
    const base = await prisma.setupSheetCalibration.findFirst({
      where: { id: body.clonedFromCalibrationId.trim(), userId: user.id },
      select: { exampleDocumentId: true },
    });
    inheritedExampleDocumentId = base?.exampleDocumentId ?? null;
  }
  const created = await prisma.setupSheetCalibration.create({
    data: {
      userId: user.id,
      name,
      sourceType,
      calibrationDataJson: (body.calibrationDataJson ?? {}) as object,
      exampleDocumentId: body.exampleDocumentId ?? inheritedExampleDocumentId ?? null,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}

