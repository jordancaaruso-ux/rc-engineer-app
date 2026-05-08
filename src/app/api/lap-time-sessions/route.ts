import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { importedSessionFieldStatsPreviewFromJson } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.importedLapTimeSession.findMany({
    where: { userId: user.id },
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
