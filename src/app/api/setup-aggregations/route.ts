import { NextResponse } from "next/server";
import { SetupAggregationScopeType } from "@prisma/client";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

/**
 * Lists materialized setup aggregations for the current user's cars only.
 * Response contains no document identifiers or filenames.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carIdFilter = searchParams.get("carId")?.trim() || null;

  const cars = await prisma.car.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, chassis: true },
  });
  const carIds = cars.map((c) => c.id);
  if (carIds.length === 0) {
    return NextResponse.json({ cars: [], aggregations: [] });
  }

  const allowedCarIds =
    carIdFilter && carIds.includes(carIdFilter) ? [carIdFilter] : carIds;

  const aggregations = await prisma.setupParameterAggregation.findMany({
    where: {
      scopeType: SetupAggregationScopeType.CAR_PARAMETER,
      carId: { in: allowedCarIds },
    },
    orderBy: [{ carId: "asc" }, { parameterKey: "asc" }],
    select: {
      carId: true,
      parameterKey: true,
      valueType: true,
      sampleCount: true,
      numericStatsJson: true,
      categoricalStatsJson: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    cars: cars.map((c) => ({ id: c.id, name: c.name, chassis: c.chassis })),
    aggregations,
  });
}
