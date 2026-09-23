import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { runsTag } from "@/lib/cacheTags";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { computeImportedSessionFieldStatsFromPayload } from "@/lib/lapImport/computeImportedSessionFieldStats";
import {
  sessionCompletedAtIsoFromImportedPayload,
  sessionUtcOffsetMinutesFromImportedPayload,
} from "@/lib/lapImport/fromPayload";
import { SESSION_CUSTOM_NAME_MAX } from "@/lib/lapImport/sessionNaming";

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
      sessionUtcOffsetMinutes: sessionUtcOffsetMinutesFromImportedPayload(row.parsedPayload),
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
 * Rename or delete one imported session.
 *
 * `customName`: the driver's own name for it; blank puts the automatic name back.
 * `hidden`: true deletes it — hidden, not erased, so nothing automatic re-imports it (see the
 * schema note on `hiddenAt`); false is the Undo. A session on a run can't be deleted here: its
 * laps are that run's laps, and the run is what gets deleted.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as {
    customName?: unknown;
    hidden?: unknown;
  } | null;
  const data: { customName?: string | null; hiddenAt?: Date | null } = {};
  if (body && "customName" in body) {
    if (body.customName !== null && typeof body.customName !== "string") {
      return NextResponse.json({ error: "customName must be text or null" }, { status: 400 });
    }
    const name = typeof body.customName === "string" ? body.customName.trim().replace(/\s+/g, " ") : "";
    data.customName = name ? name.slice(0, SESSION_CUSTOM_NAME_MAX) : null;
  }
  if (body && "hidden" in body) {
    if (typeof body.hidden !== "boolean") {
      return NextResponse.json({ error: "hidden must be true or false" }, { status: 400 });
    }
    data.hiddenAt = body.hidden ? new Date() : null;
  }
  if (!("customName" in data) && !("hiddenAt" in data)) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const row = await prisma.importedLapTimeSession.findFirst({
    where: { id, userId },
    select: { id: true, linkedRunId: true, detectedPrimaryForRun: { select: { id: true } } },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data.hiddenAt && (row.linkedRunId || row.detectedPrimaryForRun)) {
    return NextResponse.json(
      { error: "This session is on a run. Delete the run instead." },
      { status: 409 }
    );
  }

  const updated = await prisma.importedLapTimeSession.update({
    where: { id: row.id },
    data,
    select: { id: true, customName: true, hiddenAt: true },
  });

  // The Tools band is cached (`getCachedToolsModel`) and lists exactly these rows.
  revalidatePath("/tools");
  revalidatePath("/laps/analysis");
  revalidateTag(runsTag(userId), { expire: 0 });

  return NextResponse.json({
    session: { id: updated.id, customName: updated.customName, hidden: updated.hiddenAt != null },
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
