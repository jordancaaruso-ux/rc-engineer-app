import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { id } = await ctx.params;

  const row = await prisma.watchedLapSource.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.watchedLapSource.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}

