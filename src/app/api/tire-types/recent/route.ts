import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

type RecentTireType = { id: string; displayName: string; modelCode: string };

const RUN_SCAN = 40;
const MAX_RECENT = 8;

/**
 * Distinct tire types from the user's recent runs (most recently used first).
 *
 * With `?carId=`, compounds run on cars of the same discipline lead the list —
 * what's on the other touring car is a much better guess for a new touring car
 * than the last thing bolted onto a buggy. Ranking only: everything the driver
 * has recently used still appears, just below.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const carId = new URL(request.url).searchParams.get("carId");
  const car = carId
    ? await prisma.car.findFirst({
        where: { id: carId, userId: userId },
        select: { carClass: true },
      })
    : null;
  const carClass = car?.carClass ?? null;

  const baseWhere = { userId: userId, tireTypeId: { not: null } } as const;
  const query = (where: object) =>
    prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: RUN_SCAN,
      select: { tireType: { select: TIRE_TYPE_SELECT } },
    });

  // Two scans rather than one filtered afterwards: a driver whose last 40 runs
  // were all off-road would otherwise see nothing for their touring car.
  const [sameClassRuns, anyRuns] = await Promise.all([
    carClass ? query({ ...baseWhere, car: { carClass: carClass } }) : Promise.resolve([]),
    query(baseWhere),
  ]);

  const seen = new Set<string>();
  const tireTypes: RecentTireType[] = [];
  for (const run of [...sameClassRuns, ...anyRuns]) {
    const tt = run.tireType;
    if (!tt || seen.has(tt.id)) continue;
    seen.add(tt.id);
    tireTypes.push(tt);
    if (tireTypes.length >= MAX_RECENT) break;
  }

  return NextResponse.json({ tireTypes });
}
