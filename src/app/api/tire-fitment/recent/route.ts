import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { recentFitmentValues } from "@/lib/tires/tireFitment";

const RUN_SCAN = 60;
const MAX_RECENT = 8;

/**
 * The driver's own inserts and wheels, most recently used first — the list behind the Insert and
 * Wheel pickers on a front/rear car's Tires step.
 *
 * Their OWN, by ruling (2026-09-19): free text typed once and remembered, not a shared catalog a
 * founder has to review. So this never reaches past the signed-in user's runs, and there is
 * nothing to create — a value exists the moment a run is saved with it.
 *
 * Not scoped to a car or an end. The insert a driver runs in the rear of the buggy is the first
 * one they will reach for in the front, and in the truck.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `DbNull`, not `JsonNull`: an emptied value is written as SQL NULL precisely so this filter
  // skips it, instead of spending the scan on rows with nothing in them.
  const rows = await prisma.run.findMany({
    where: { userId, tireFitment: { not: Prisma.DbNull } },
    orderBy: { sortAt: "desc" },
    take: RUN_SCAN,
    select: { tireFitment: true },
  });

  return NextResponse.json(
    recentFitmentValues(
      rows.map((r) => r.tireFitment),
      MAX_RECENT
    )
  );
}
