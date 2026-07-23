import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canManageCatalogRow } from "@/lib/assets/catalogAccessLogic";
import { tireTypeUsedByOthers } from "@/lib/assets/catalogUsage";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
  verifiedAt: true,
  createdByUserId: true,
} as const;

type ManageableTireType = {
  id: string;
  verifiedAt: Date | null;
  createdByUserId: string | null;
};

/**
 * Unified catalog rule: admin always; otherwise the creator only while unverified AND
 * unused by others. The usedByOthers query runs only when it could matter.
 */
async function canManageTireType(
  user: { id: string; email: string | null },
  row: ManageableTireType
): Promise<boolean> {
  if (isAuthAdminEmail(user.email)) return true;
  const verified = row.verifiedAt != null;
  const isCreator = row.createdByUserId != null && row.createdByUserId === user.id;
  if (verified || !isCreator) return false;
  const usedByOthers = await tireTypeUsedByOthers(row.id, user.id);
  return canManageCatalogRow(user, {
    creatorUserId: row.createdByUserId,
    verified,
    usedByOthers,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tireTypeId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tireTypeId } = await context.params;
  const existing = await prisma.tireType.findUnique({
    where: { id: tireTypeId },
    select: TIRE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire type not found" }, { status: 404 });
  }
  if (!(await canManageTireType(user, existing))) {
    return NextResponse.json(
      { error: "Only the creator (while unverified) or an admin can edit this tire type." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    displayName?: string;
    modelCode?: string;
    verified?: boolean;
  } | null;

  // Verification is admin-only (founder ground truth). Non-admins editing an unverified
  // row cannot flip it; the manage check above already let them in for name/code edits.
  const verifiedData: { verifiedAt?: Date | null } = {};
  if (body && typeof body.verified === "boolean" && isAuthAdminEmail(user.email)) {
    verifiedData.verifiedAt = body.verified ? new Date() : null;
  }

  const displayName = body?.displayName?.trim();
  if (!displayName) {
    // Verify-only PATCH (admin approving from the review queue) — no name/code change.
    if ("verifiedAt" in verifiedData) {
      const tireType = await prisma.tireType.update({
        where: { id: tireTypeId },
        data: verifiedData,
        select: { id: true, displayName: true, modelCode: true, verifiedAt: true },
      });
      return NextResponse.json({ tireType });
    }
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const modelCodeRaw =
    body?.modelCode?.trim() || suggestModelCodeFromDisplayName(displayName);
  const modelCode = modelCodeRaw.toUpperCase().replace(/\s+/g, "-");

  if (modelCode !== existing.modelCode) {
    const conflict = await prisma.tireType.findUnique({
      where: { modelCode },
      select: { id: true },
    });
    if (conflict && conflict.id !== tireTypeId) {
      return NextResponse.json(
        { error: "A tire type with this model code already exists." },
        { status: 409 }
      );
    }
  }

  const tireType = await prisma.tireType.update({
    where: { id: tireTypeId },
    data: { displayName, modelCode, ...verifiedData },
    select: { id: true, displayName: true, modelCode: true, verifiedAt: true },
  });

  return NextResponse.json({ tireType });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tireTypeId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tireTypeId } = await context.params;
  const existing = await prisma.tireType.findUnique({
    where: { id: tireTypeId },
    select: TIRE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire type not found" }, { status: 404 });
  }
  if (!(await canManageTireType(user, existing))) {
    return NextResponse.json(
      { error: "Only the creator (while unverified and unused) or an admin can delete this tire type." },
      { status: 403 }
    );
  }

  await prisma.tireType.delete({ where: { id: tireTypeId } });
  return NextResponse.json({ ok: true });
}
