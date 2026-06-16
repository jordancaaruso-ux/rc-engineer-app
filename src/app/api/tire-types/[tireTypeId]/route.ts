import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";

const TIRE_TYPE_SELECT = {
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
  context: { params: Promise<{ tireTypeId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  const { tireTypeId } = await context.params;
  const existing = await prisma.tireType.findUnique({
    where: { id: tireTypeId },
    select: TIRE_TYPE_SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire type not found" }, { status: 404 });
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
    data: { displayName, modelCode },
    select: TIRE_TYPE_SELECT,
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
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  const { tireTypeId } = await context.params;
  const existing = await prisma.tireType.findUnique({
    where: { id: tireTypeId },
    select: { id: true, displayName: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire type not found" }, { status: 404 });
  }

  await prisma.tireType.delete({ where: { id: tireTypeId } });
  return NextResponse.json({ ok: true });
}
