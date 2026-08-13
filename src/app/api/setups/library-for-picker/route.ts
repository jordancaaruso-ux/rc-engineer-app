import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/**
 * Saved (library) setups across every car, for the Geometry Lab picker.
 *
 * Deliberately not part of `/api/setup/options`: that route is car-scoped and its
 * `downloadedSetups` shape feeds the run wizard's baseline wiring. The Lab compares
 * geometry rather than cars, so it wants the whole library — the car name rides along
 * on each row so no two rows are ambiguous.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.setupSnapshot.findMany({
    where: { userId, isLibrary: true },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      name: true,
      createdAt: true,
      data: true,
      car: { select: { name: true } },
    },
  });

  return NextResponse.json({
    setups: rows.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      carName: s.car?.name ?? null,
      setupData: s.data,
    })),
  });
}
