import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { buildRunSliceV1 } from "@/lib/engineerPhase5/runSlice";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const slice = await buildRunSliceV1({
    userId: user.id,
    carId: searchParams.get("carId")?.trim() || null,
    trackId: searchParams.get("trackId")?.trim() || null,
    eventId: searchParams.get("eventId")?.trim() || null,
    dateFrom: searchParams.get("dateFrom")?.trim() || null,
    dateTo: searchParams.get("dateTo")?.trim() || null,
    limit: Number(searchParams.get("limit")) || undefined,
  });

  if (!slice) {
    return NextResponse.json({ error: "Car not found" }, { status: 404 });
  }
  return NextResponse.json({ slice });
}
