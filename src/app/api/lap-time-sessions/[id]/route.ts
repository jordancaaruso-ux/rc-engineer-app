import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { computeImportedSessionFieldStatsFromPayload } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id, userId: userId },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let fieldStatsJson = row.fieldStatsJson;
  if (
    (fieldStatsJson == null || typeof fieldStatsJson !== "object") &&
    row.parsedPayload != null
  ) {
    const computed = computeImportedSessionFieldStatsFromPayload(row.parsedPayload);
    if (computed != null) {
      await prisma.importedLapTimeSession.update({
        where: { id: row.id },
        data: { fieldStatsJson: computed as object },
      });
      fieldStatsJson = computed;
    }
  }

  return NextResponse.json({
    /**
     * The stored parse, shaped exactly like a fresh import result.
     *
     * This is what "use these laps" attaches. It deliberately never touches the timing site: the
     * whole point is reaching laps you already hold, which has to keep working at 9pm when the
     * club's server is asleep, or after a meeting page has been taken down. Re-importing by URL
     * would refresh the parse, and also fail in exactly those cases.
     */
    importRow: {
      url: row.sourceUrl,
      success: true as const,
      importedSessionId: row.id,
      recordedAt: row.createdAt.toISOString(),
      sessionCompletedAtIso:
        sessionCompletedAtIsoFromImportedPayload(row.parsedPayload) ??
        (row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null),
      sessionCompletedAtDbIso: row.sessionCompletedAt ? row.sessionCompletedAt.toISOString() : null,
      parserId: row.parserId,
      ...storedParseFields(row.parsedPayload),
    },
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
      fieldStatsJson,
    },
  });
}

/**
 * Pull the lap-bearing fields out of a stored parse snapshot (see `serializeParsePayload`).
 *
 * Read defensively rather than cast: these rows go back to the first release of URL import, and an
 * old one missing `lapRows` or `sessionDrivers` should still attach its laps instead of throwing.
 */
function storedParseFields(parsed: unknown): {
  laps: number[];
  lapRows: unknown[] | null;
  sessionDrivers: unknown[];
  sessionHint: unknown;
  message: string | null;
} {
  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const laps = Array.isArray(o.laps)
    ? o.laps.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
  return {
    laps,
    lapRows: Array.isArray(o.lapRows) ? o.lapRows : null,
    sessionDrivers: Array.isArray(o.sessionDrivers) ? o.sessionDrivers : [],
    sessionHint: o.sessionHint ?? null,
    message: typeof o.message === "string" ? o.message : null,
  };
}
