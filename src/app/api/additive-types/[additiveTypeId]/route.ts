import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canManageCatalogRow } from "@/lib/assets/catalogAccessLogic";
import { additiveTypeUsedByOthers } from "@/lib/assets/catalogUsage";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";

const ADDITIVE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
  verifiedAt: true,
  createdByUserId: true,
} as const;

type ManageableAdditiveType = {
  id: string;
  verifiedAt: Date | null;
  createdByUserId: string | null;
};

/** Unified catalog rule: admin always; else creator only while unverified AND unused. */
async function canManageAdditiveType(
  user: { id: string; email: string | null },
  row: ManageableAdditiveType
): Promise<boolean> {
  if (isAuthAdminEmail(user.email)) return true;
  const verified = row.verifiedAt != null;
  const isCreator = row.createdByUserId != null && row.createdByUserId === user.id;
  if (verified || !isCreator) return false;
  const usedByOthers = await additiveTypeUsedByOthers(row.id, user.id);
  return canManageCatalogRow(user, {
    creatorUserId: row.createdByUserId,
    verified,
    usedByOthers,
  });
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
  if (!(await canManageAdditiveType(user, existing))) {
    return NextResponse.json(
      { error: "Only the creator (while unverified) or an admin can edit this additive type." },
      { status: 403 }
    );
  }

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
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const modelCodeRaw =
    body?.modelCode?.trim() || suggestModelCodeFromDisplayName(displayName);
  const modelCode = modelCodeRaw.toUpperCase().replace(/\s+/g, "-");

  if (modelCode !== existing.modelCode) {
    const conflict = await prisma.additiveType.findUnique({
      where: { modelCode },
      select: { id: true },
    });
    if (conflict && conflict.id !== additiveTypeId) {
      return NextResponse.json(
        { error: "An additive type with this model code already exists." },
        { status: 409 }
      );
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
  if (!(await canManageAdditiveType(user, existing))) {
    return NextResponse.json(
      { error: "Only the creator (while unverified and unused) or an admin can delete this additive type." },
      { status: 403 }
    );
  }

  await prisma.additiveType.delete({ where: { id: additiveTypeId } });
  return NextResponse.json({ ok: true });
}
