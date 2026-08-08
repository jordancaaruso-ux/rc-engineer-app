import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

/**
 * Hide the Sessions-list "no lap times — import them" warning on a run without
 * deleting it (for runs that will never have timing: club practice, no transponder).
 *
 * Writes its own column, NOT `incompleteLoggingPromptDismissedAt` — that one drives
 * the dashboard's "Runs not finished logging" list.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rid = typeof id === "string" ? id.trim() : "";
  if (!rid) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = await prisma.run.findFirst({
    where: { id: rid, userId: userId },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.run.update({
    where: { id: row.id },
    data: { lapImportPromptDismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
