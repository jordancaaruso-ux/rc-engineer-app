import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { additiveTypeUsedByOthers } from "@/lib/assets/catalogUsage";
import {
  ADDITIVE_IN_USE_REASON,
  ADDITIVE_NOT_YOURS_REASON,
  additiveAccess,
  canChangeAdditive,
} from "@/lib/additives/additiveAccess";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";
import { objectionableTextError } from "@/lib/moderation/wordFilter";

const ADDITIVE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
  verifiedAt: true,
  createdByUserId: true,
} as const;

/**
 * Admin always; else the driver who added it, while no other driver uses it — verified or not,
 * since every additive is trusted on arrival (`additiveAccess`). A refusal says why.
 */
async function refuseUnlessAllowed(
  user: { id: string; email: string | null },
  row: { id: string; createdByUserId: string | null }
): Promise<NextResponse | null> {
  const maker = !isAuthAdminEmail(user.email) && row.createdByUserId === user.id;
  const usedByOthers = maker ? await additiveTypeUsedByOthers(row.id, user.id) : false;
  const access = additiveAccess(user, row, usedByOthers);
  if (canChangeAdditive(access)) return null;
  return NextResponse.json(
    { error: access === "in-use" ? ADDITIVE_IN_USE_REASON : ADDITIVE_NOT_YOURS_REASON },
    { status: 403 }
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ additiveTypeId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { additiveTypeId } = await context.params;
  const existing = await prisma.additiveType.findUnique({
    where: { id: additiveTypeId },
    select: ADDITIVE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Additive type not found" }, { status: 404 });
  }
  const refused = await refuseUnlessAllowed(user, existing);
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as {
    displayName?: string;
    modelCode?: string;
    verified?: boolean;
  } | null;

  // Verification is admin-only (founder ground truth).
  const verifiedData: { verifiedAt?: Date | null } = {};
  if (body && typeof body.verified === "boolean" && isAuthAdminEmail(user.email)) {
    verifiedData.verifiedAt = body.verified ? new Date() : null;
  }

  const displayName = body?.displayName?.trim();
  if (!displayName) {
    // Verify-only PATCH (admin approving from the review queue) — no name/code change.
    if ("verifiedAt" in verifiedData) {
      const additiveType = await prisma.additiveType.update({
        where: { id: additiveTypeId },
        data: verifiedData,
        select: { id: true, displayName: true, modelCode: true, verifiedAt: true },
      });
      return NextResponse.json({ additiveType });
    }
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }
  // A rename lands in every driver's list, same as a new name (the create route checks too).
  const unclean = objectionableTextError(displayName);
  if (unclean) return NextResponse.json({ error: unclean }, { status: 400 });

  const modelCodeRaw =
    body?.modelCode?.trim() || suggestModelCodeFromDisplayName(displayName);
  const modelCode = modelCodeRaw.toUpperCase().replace(/\s+/g, "-");

  if (modelCode !== existing.modelCode) {
    const conflict = await prisma.additiveType.findUnique({
      where: { modelCode },
      select: { id: true },
    });
    if (conflict && conflict.id !== additiveTypeId) {
      // The code is made from the name, so to the driver renaming it this is a name clash.
      return NextResponse.json({ error: "Another additive already has this name." }, { status: 409 });
    }
  }

  const additiveType = await prisma.additiveType.update({
    where: { id: additiveTypeId },
    data: { displayName, modelCode, ...verifiedData },
    select: { id: true, displayName: true, modelCode: true, verifiedAt: true },
  });

  return NextResponse.json({ additiveType });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ additiveTypeId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { additiveTypeId } = await context.params;
  const existing = await prisma.additiveType.findUnique({
    where: { id: additiveTypeId },
    select: ADDITIVE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Additive type not found" }, { status: 404 });
  }
  const refused = await refuseUnlessAllowed(user, existing);
  if (refused) return refused;

  await prisma.additiveType.delete({ where: { id: additiveTypeId } });
  return NextResponse.json({ ok: true });
}
