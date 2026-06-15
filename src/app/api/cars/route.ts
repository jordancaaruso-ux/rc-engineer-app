import { NextResponse } from "next/server";
import { revalidateAfterCarMutation } from "@/lib/revalidateUser";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns } from "@/lib/teammateRunAccess";
import { SETUP_SHEET_TEMPLATE_A800RR, canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import { legacyTemplateFromModelSlug } from "@/lib/setupSheetModels/resolveModelForCar";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const forUserId = searchParams.get("forUserId")?.trim() || null;

  const targetUserId = forUserId && forUserId !== user.id ? forUserId : user.id;
  if (targetUserId !== user.id) {
    const ok = await canViewPeerRuns(user.id, targetUserId);
    if (!ok) {
      return NextResponse.json({ error: "Not allowed to list this user’s cars" }, { status: 403 });
    }
  }

  const cars = await prisma.car.findMany({
    where: { userId: targetUserId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ cars });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as {
      name?: string;
      chassis?: string | null;
      notes?: string | null;
      setupSheetTemplate?: string | null;
      setupSheetModelId?: string | null;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const setupSheetTemplateRaw = canonicalSetupSheetTemplateId(body.setupSheetTemplate ?? null);
    let setupSheetTemplate: string | null =
      setupSheetTemplateRaw === SETUP_SHEET_TEMPLATE_A800RR ? SETUP_SHEET_TEMPLATE_A800RR : setupSheetTemplateRaw;
    let setupSheetModelId: string | null = body.setupSheetModelId?.trim() || null;
    if (setupSheetModelId) {
      const model = await prisma.setupSheetModel.findFirst({
        where: { id: setupSheetModelId, userId: user.id },
        select: { id: true, slug: true },
      });
      if (!model) {
        return NextResponse.json({ error: "Invalid setup sheet model" }, { status: 400 });
      }
      const legacy = legacyTemplateFromModelSlug(model.slug);
      if (legacy) setupSheetTemplate = legacy;
    }
    const car = await prisma.car.create({
      data: {
        name,
        chassis: body.chassis?.trim() || null,
        notes: body.notes?.trim() || null,
        setupSheetTemplate,
        setupSheetModelId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        chassis: true,
        notes: true,
        setupSheetTemplate: true,
        setupSheetModelId: true,
        setupSheetModel: { select: { id: true, name: true } },
      },
    });
    revalidateAfterCarMutation(user.id);
    return NextResponse.json({ car }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create car";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
