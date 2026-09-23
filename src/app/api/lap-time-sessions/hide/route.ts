import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { runsTag } from "@/lib/cacheTags";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

/** One press of "Delete" in the library's Select mode can't reach further than this. */
const MAX_IDS = 500;

/**
 * Delete (hide) or restore many imported sessions at once — the library's Select mode, and the
 * Undo after it.
 *
 * Sessions on a run are skipped rather than refused: Select mode never offers them, and one
 * stale id shouldn't sink the rest of the batch. The ids actually changed come back, so the
 * Undo restores exactly those.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { ids?: unknown; hidden?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0))]
    : [];
  if (ids.length === 0 || typeof body?.hidden !== "boolean") {
    return NextResponse.json({ error: "Provide ids[] and hidden" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `At most ${MAX_IDS} at a time` }, { status: 400 });
  }
  const hidden = body.hidden;

  const eligible = await prisma.importedLapTimeSession.findMany({
    where: {
      userId,
      id: { in: ids },
      ...(hidden ? { linkedRunId: null, detectedPrimaryForRun: { is: null } } : {}),
    },
    select: { id: true },
  });
  const changedIds = eligible.map((r) => r.id);
  if (changedIds.length > 0) {
    await prisma.importedLapTimeSession.updateMany({
      where: { userId, id: { in: changedIds } },
      data: { hiddenAt: hidden ? new Date() : null },
    });
  }

  revalidatePath("/tools");
  revalidatePath("/laps/analysis");
  revalidateTag(runsTag(userId), { expire: 0 });

  return NextResponse.json({ ids: changedIds, hidden });
}
