import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    sourceType?: string;
    calibrationDataJson?: unknown;
    exampleDocumentId?: string | null;
  };
  const existing = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: {
    name?: string;
    sourceType?: string;
    calibrationDataJson?: object;
    exampleDocumentId?: string | null;
  } = {};

  if (body.name !== undefined) {
    const t = body.name?.trim();
    if (t) data.name = t;
  }
  if (body.sourceType !== undefined) {
    const t = body.sourceType?.trim();
    if (t) data.sourceType = t;
  }
  if (body.calibrationDataJson !== undefined) {
    data.calibrationDataJson = (body.calibrationDataJson ?? {}) as object;
  }
  if ("exampleDocumentId" in body) {
    const raw = body.exampleDocumentId;
    if (raw === null || raw === "") {
      data.exampleDocumentId = null;
    } else if (typeof raw === "string" && raw.trim()) {
      const docId = raw.trim();
      const doc = await prisma.setupDocument.findFirst({
        where: { id: docId, userId: user.id },
        select: { id: true },
      });
      if (!doc) {
        return NextResponse.json(
          { error: "Example document not found or not owned by you" },
          { status: 400 }
        );
      }
      data.exampleDocumentId = docId;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.setupSheetCalibration.updateMany({
    where: { id, userId: user.id },
    data,
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const calibration = await prisma.setupSheetCalibration.findFirst({
    where: { id, userId: user.id },
    select: { id: true, updatedAt: true, exampleDocumentId: true },
  });
  return NextResponse.json({ calibration });
}

