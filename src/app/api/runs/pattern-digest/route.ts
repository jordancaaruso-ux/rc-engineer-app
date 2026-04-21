import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildPatternDigestV1 } from "@/lib/engineerPhase5/patternDigest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || "";
  if (!carId) {
    return NextResponse.json({ error: "carId is required" }, { status: 400 });
  }

  const digest = await buildPatternDigestV1({
    userId: user.id,
    carId,
    eventId: searchParams.get("eventId")?.trim() || null,
    trackId: searchParams.get("trackId")?.trim() || null,
    dateFrom: searchParams.get("dateFrom")?.trim() || null,
    dateTo: searchParams.get("dateTo")?.trim() || null,
    limit: Number(searchParams.get("limit")) || undefined,
  });

  if (!digest) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }
  return NextResponse.json({ digest });
}
