import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import {
  cleanBaselineName,
  cleanBaselineNotes,
  parseBaselineGripLevel,
  parseBaselineKind,
  parseBaselineSurface,
} from "@/lib/baselineSetups/baselineSetupShape";

/**
 * Publish a global baseline setup against a chassis type.
 *
 * Admin-only, and deliberately so: these sheets are quoted to every driver who owns that chassis
 * and are the reference the Engineer measures a setup against. Same gate the kit setup used to
 * carry on `PATCH /api/setup-sheet-models/[id]`.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Only an admin can publish a baseline setup." },
      { status: 403 }
    );
  }

  const { id: setupSheetModelId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const name = cleanBaselineName(body.name);
  if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });

  const kind = parseBaselineKind(body.kind);
  if (!kind) return NextResponse.json({ error: "Pick kit, base or pro" }, { status: 400 });

  // Setup sheet models are global — never scope this read by userId.
  const model = await prisma.setupSheetModel.findUnique({
    where: { id: setupSheetModelId },
    select: { id: true },
  });
  if (!model) return NextResponse.json({ error: "Chassis type not found" }, { status: 404 });

  const data = normalizeSetupSnapshotForStorage(body.data);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "A baseline needs at least one value" }, { status: 400 });
  }

  const created = await prisma.baselineSetup.create({
    data: {
      setupSheetModelId: model.id,
      name,
      kind,
      notes: cleanBaselineNotes(body.notes),
      surface: parseBaselineSurface(body.surface),
      gripLevel: parseBaselineGripLevel(body.gripLevel),
      data: data as Prisma.InputJsonValue,
      createdByUserId: user.id,
    },
    select: { id: true, name: true, kind: true },
  });

  return NextResponse.json({ baseline: created }, { status: 201 });
}
