import { NextResponse } from "next/server";
import { revalidateAfterActionItemMutation } from "@/lib/revalidateUser";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { isArchived?: boolean };
  if (body.isArchived !== true) {
    return NextResponse.json({ error: "isArchived: true required" }, { status: 400 });
  }

  const row = await prisma.actionItem.findFirst({
    where: { id, userId: userId },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.actionItem.updateMany({
    where: { id, userId: userId },
    data: { isArchived: true },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateAfterActionItemMutation(userId);

  return NextResponse.json({ ok: true });
}
