import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { importedSessionFieldStatsPreviewFromJson } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.importedLapTimeSession.findMany({
    where: { userId: userId },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      parserId: true,
      sourceType: true,
      linkedRunId: true,
      linkedEventId: true,
      parsedPayload: true,
      fieldStatsJson: true,
      // An import has no track of its own; the only claim it can make is via the run
      // it was linked to. The lap sheet's "same track" scope needs this, and an
      // unlinked import stays honestly trackless rather than being guessed at.
      linkedRun: {
        select: { trackNameSnapshot: true, track: { select: { name: true } } },
      },
    },
  });

  const sessions = rows
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      sessionCompletedAt: r.sessionCompletedAt ? r.sessionCompletedAt.toISOString() : null,
      sourceUrl: r.sourceUrl,
      parserId: r.parserId,
      sourceType: r.sourceType,
      linkedRunId: r.linkedRunId,
      linkedEventId: r.linkedEventId,
      trackName: r.linkedRun?.track?.name ?? r.linkedRun?.trackNameSnapshot ?? null,
      parsedPayload: r.parsedPayload,
      fieldStatsPreview: importedSessionFieldStatsPreviewFromJson(r.fieldStatsJson),
    }))
    .sort((a, b) => {
      const ta = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: a.sessionCompletedAt,
        parsedPayload: a.parsedPayload,
        createdAt: a.createdAt,
      });
      const tb = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: b.sessionCompletedAt,
        parsedPayload: b.parsedPayload,
        createdAt: b.createdAt,
      });
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

  return NextResponse.json({ sessions });
}
