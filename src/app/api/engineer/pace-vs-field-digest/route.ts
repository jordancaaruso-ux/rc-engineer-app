import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { buildPaceVsFieldRunDigestForUser } from "@/lib/engineerPhase5/buildPaceVsFieldRunDigestForUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET ?scope=account|car&anchorRunId=…&carId=…
 * - scope=account (default): all runs with linked timing imports.
 * - scope=car: filter to one car via carId query param, or car from anchorRunId when carId omitted.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const scopeRaw = url.searchParams.get("scope")?.trim().toLowerCase() || "account";
  const scope = scopeRaw === "car" ? "car" : "account";
  const anchorRunId = url.searchParams.get("anchorRunId")?.trim() || null;
  let carId = url.searchParams.get("carId")?.trim() || null;

  if (scope === "car") {
    if (!carId && anchorRunId) {
      const anchor = await prisma.run.findFirst({
        where: { id: anchorRunId, userId: user.id },
        select: { carId: true },
      });
      carId = anchor?.carId ?? null;
    }
    if (!carId) {
      return NextResponse.json(
        { error: "scope=car requires carId or a valid anchorRunId with a car." },
        { status: 400 }
      );
    }
  }

  const digest = await buildPaceVsFieldRunDigestForUser({
    userId: user.id,
    scopeCarId: scope === "car" ? carId : null,
    anchorRunId,
  });

  return NextResponse.json({ digest });
}
