import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getLastRunForCar } from "@/lib/runs/getLastRunForCar";

/**
 * The current user's most recent run on a given car — the Log-run entry screen
 * calls this when the driver switches car, to decide whether to continue.
 * GET /api/runs/last-for-car?carId=<id> → { candidate: EntryCandidate | null }
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const carId = new URL(request.url).searchParams.get("carId")?.trim();
  if (!carId) return NextResponse.json({ error: "carId required" }, { status: 400 });

  const candidate = await getLastRunForCar(user.id, carId);
  return NextResponse.json({ candidate });
}
