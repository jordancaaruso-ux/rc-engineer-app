import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { id } = await context.params;
  const body = (await request.json()) as { isArchived?: boolean };
  if (body.isArchived !== true) {
    return NextResponse.json({ error: "isArchived: true required" }, { status: 400 });
  }

  const row = await prisma.actionItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.actionItem.update({
    where: { id },
    data: { isArchived: true },
  });

  return NextResponse.json({ ok: true });
}
