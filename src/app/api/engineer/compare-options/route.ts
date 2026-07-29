import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { buildEngineerCompareOptions } from "@/lib/engineerPhase5/engineerCompareOptions";

export const dynamic = "force-dynamic";

/** Run picker options for Engineer compare (mine + mutual team peers). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const timeZone = await getExplicitTimeZoneForRunFormatting();
  const data = await buildEngineerCompareOptions(userId, timeZone);
  return NextResponse.json(data);
}
