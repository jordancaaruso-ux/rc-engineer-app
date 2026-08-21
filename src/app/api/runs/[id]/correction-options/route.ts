import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * What the session view's pickers may offer for THIS run.
 *
 * ============================== WHY THE SERVER DECIDES THE LIST ==============================
 *
 *  - **Cars** are the driver's own. Moving a run between them copies its setup snapshot
 *    onto the new car (see `applyRunCarMove`), so the list must not reach past ownership.
 *  - **Tire types** are the driver's own recent sets first. The full catalog is long and
 *    the answer is nearly always a compound already on the bench this weekend.
 *
 * **Events used to be here** and are not any more (2026-08-21). They were filtered to this
 * run's track, because a run's track derives from its event and offering one somewhere else
 * would have moved the track through the back door. The founder then locked the event itself,
 * so the filter has nothing left to protect — the run's meeting is now fixed at logging, and
 * `PATCH /api/runs/[id]` no longer accepts an `eventId` at all.
 *
 * Loaded on first tap, not with the run: this panel renders inside every expanded
 * Sessions row, and a run nobody is correcting should cost no request.
 */
export async function GET(_req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.run.findFirst({
    where: { id, userId },
    select: { id: true, tireTypeId: true },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const [cars, recentTireTypeRows, tireTypes] = await Promise.all([
    prisma.car.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // The compounds this driver has actually run, most recent first. `distinct` on the
    // tire type keeps one row per compound rather than one per run.
    prisma.run.findMany({
      where: { userId, tireTypeId: { not: null } },
      select: { tireTypeId: true },
      distinct: ["tireTypeId"],
      orderBy: { sortAt: "desc" },
      take: 12,
    }),
    prisma.tireType.findMany({
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 200,
    }),
  ]);

  /*
   * Recent compounds first, then the rest of the catalog — one list, no duplicates.
   * A flat alphabetical catalog puts the tire the driver is standing next to somewhere
   * in the middle of two hundred rows.
   */
  const byId = new Map(tireTypes.map((t) => [t.id, t]));
  const recentIds = recentTireTypeRows
    .map((r) => r.tireTypeId)
    .filter((tid): tid is string => Boolean(tid) && byId.has(tid!));
  const seen = new Set(recentIds);
  const orderedTires = [
    ...recentIds.map((tid) => byId.get(tid)!),
    ...tireTypes.filter((t) => !seen.has(t.id)),
  ];

  return NextResponse.json({
    cars: cars.map((c) => ({ id: c.id, label: c.name })),
    tireTypes: orderedTires.map((t) => ({ id: t.id, label: t.displayName })),
  });
}
