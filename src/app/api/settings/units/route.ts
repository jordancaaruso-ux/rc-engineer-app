import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { parseUnitSystem } from "@/lib/units/unitSystem";
import { saveUnitSystem } from "@/lib/units/unitSystemServer";

/** The Settings units switch: `{ unitSystem: "metric" | "imperial" }`. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { unitSystem?: unknown } | null;
  const unitSystem = parseUnitSystem(body?.unitSystem);
  if (!unitSystem) {
    return NextResponse.json({ error: "Pick metric or imperial" }, { status: 400 });
  }
  await saveUnitSystem(userId, unitSystem);
  return NextResponse.json({ unitSystem });
}
