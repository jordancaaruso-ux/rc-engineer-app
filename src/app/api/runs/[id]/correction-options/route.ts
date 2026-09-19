import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { tireProfileForDiscipline } from "@/lib/cars/tireProfile";
import { TIRE_CATALOG_MAX, tireCatalogScopeWhere } from "@/lib/tires/tireCatalogScope";

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
 *    the answer is nearly always a compound already on the bench this weekend. The catalog
 *    half is cut to what the run's car races, the same slice the log-run picker shows.
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
    select: {
      id: true,
      tireTypeId: true,
      car: {
        select: {
          carClass: true,
          setupSheetTemplate: true,
          setupSheetModel: { select: { slug: true, discipline: true } },
        },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const catalogWhere = await tireCatalogScopeWhere(
    tireProfileForDiscipline(disciplineForCar(run.car)).bucket,
    userId
  );

  const [cars, recentTireTypeRows, catalogTireTypes] = await Promise.all([
    prisma.car.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // The compounds this driver has actually run, most recent first. `distinct` on the
    // tire type keeps one row per compound rather than one per run.
    prisma.run.findMany({
      where: { userId, tireTypeId: { not: null } },
      select: { tireTypeId: true, tireType: { select: { id: true, displayName: true } } },
      distinct: ["tireTypeId"],
      orderBy: { sortAt: "desc" },
      take: 12,
    }),
    // Was `take: 200` over the WHOLE catalog, written when it held ~30 rows. At 739 that made
    // everything past the letter J unpickable here — and, because the recent rows were looked up
    // in the same 200, dropped a driver's own recent tire whenever its name sorted late.
    prisma.tireType.findMany({
      where: catalogWhere,
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: TIRE_CATALOG_MAX,
    }),
  ]);

  // A recent tire is offered whether or not the catalog slice holds it: it is what this driver
  // actually runs, and the run being corrected may itself sit outside the car's slice.
  const tireTypes = [...catalogTireTypes];
  const known = new Set(tireTypes.map((t) => t.id));
  for (const row of recentTireTypeRows) {
    if (row.tireType && !known.has(row.tireType.id)) {
      known.add(row.tireType.id);
      tireTypes.push(row.tireType);
    }
  }

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
  /*
   * The break between the two is NAMED, not just ordered. The picker is a searchable
   * sheet now: an unlabelled list that runs a dozen compounds and then starts again
   * at "A" reads as a sorting bug. A driver with no history gets no first group.
   */
  const orderedTires = [
    ...recentIds.map((tid) => ({ ...byId.get(tid)!, group: "Recently used" })),
    ...tireTypes.filter((t) => !seen.has(t.id)).map((t) => ({ ...t, group: "All tire types" })),
  ];

  return NextResponse.json({
    cars: cars.map((c) => ({ id: c.id, label: c.name })),
    tireTypes: orderedTires.map((t) => ({ id: t.id, label: t.displayName, group: t.group })),
  });
}
