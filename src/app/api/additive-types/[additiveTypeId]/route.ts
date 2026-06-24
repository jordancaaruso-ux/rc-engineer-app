import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";

const ADDITIVE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

function requireAdmin(user: { email: string | null }) {
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
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
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  const { additiveTypeId } = await context.params;
  const existing = await prisma.additiveType.findUnique({
    where: { id: additiveTypeId },
    select: ADDITIVE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Additive type not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    displayName?: string;
    modelCode?: string;
  } | null;

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
    data: { displayName, modelCode },
    select: ADDITIVE_TYPE_SELECT,
  });

  return NextResponse.json({ additiveType });
}

export async function DELETE() {
  return NextResponse.json({ error: "Deletion is not allowed for additive catalog entries." }, { status: 403 });
}
