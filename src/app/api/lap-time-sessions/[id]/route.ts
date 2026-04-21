import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id, userId: user.id },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    session: {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sessionCompletedAt: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
      sourceUrl: row.sourceUrl,
      parserId: row.parserId,
      sourceType: row.sourceType,
      parsedPayload: row.parsedPayload,
      linkedRunId: row.linkedRunId,
      linkedEventId: row.linkedEventId,
    },
  });
}
