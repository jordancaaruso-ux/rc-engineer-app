import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

/** Hide a timing import from the dashboard "Detected sessions" banner without deleting it. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const sid = typeof id === "string" ? id.trim() : "";
  if (!sid) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id: sid, userId: user.id },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.importedLapTimeSession.update({
    where: { id: row.id },
    data: { detectionPromptDismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
