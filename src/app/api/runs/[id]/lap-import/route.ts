import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { clearEngineerReadsReferencing } from "@/lib/runs/applySetupCorrection";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Take the timing import off a run.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * Lap times are the one thing on a session the driver may never retype — they are a
 * record of what the transponder saw, not an opinion (founder call, 2026-08-20). But
 * the wrong heat DOES get attached: two classes run back to back, the URL is one digit
 * out, and the run then carries somebody else's laps forever, because until now nothing
 * on the session view even said where its laps came from.
 *
 * So the correction is not "fix a lap", it is "this is not the session I was in".
 *
 * ============================== WHAT COMES OFF WITH IT ==============================
 *
 * Everything the import wrote, or the run is left claiming a best lap it can no longer
 * show you:
 *
 *  - the per-driver sets and their laps (`RunImportedLap` cascades from the set),
 *  - `lapTimes` / `lapSession`, the primary lap material,
 *  - `bestLapSeconds` / `avgTop5LapSeconds`, which are materialised caches of exactly
 *    that material and are read directly by Sessions and the dashboard,
 *  - `sessionCompletedAt` — when the car was actually on track came FROM the timing
 *    page, so without it that is once again unknown. `createdAt` and `sortAt` stay:
 *    the run was still written when it was written, and `sortAt` is the stable
 *    ordering axis that exists precisely so re-imports never reshuffle a day.
 *
 * The `ImportedLapTimeSession` row itself is kept and merely unlinked. It is the
 * driver's own import history — it appears in the lap importer's list, and deleting it
 * would mean re-fetching a page that may since have gone.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.run.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  await prisma.runImportedLap.deleteMany({ where: { lapSet: { runId: run.id } } });
  await prisma.runImportedLapSet.deleteMany({ where: { runId: run.id } });
  await prisma.importedLapTimeSession.updateMany({
    where: { linkedRunId: run.id },
    data: { linkedRunId: null },
  });
  await prisma.run.update({
    where: { id: run.id },
    data: {
      lapTimes: [],
      // `DbNull`, not `undefined` — undefined on a Prisma Json field means "leave it
      // alone", which would have left the whole lap session sitting under a run with
      // no laps. `DbNull` is SQL NULL, which is what every reader treats as absent.
      lapSession: Prisma.DbNull,
      bestLapSeconds: null,
      avgTop5LapSeconds: null,
      sessionCompletedAt: null,
    },
  });

  // The Engineer's read of this run was an answer about laps that are no longer here.
  await clearEngineerReadsReferencing(userId, [run.id]);
  revalidateAfterRunMutation(userId);

  return NextResponse.json({ ok: true });
}
