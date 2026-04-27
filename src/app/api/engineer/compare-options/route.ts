import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { buildEngineerCompareOptions } from "@/lib/engineerPhase5/engineerCompareOptions";

export const dynamic = "force-dynamic";

/** Run picker options for Engineer compare (mine + linked teammates + mutual team peers). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await buildEngineerCompareOptions(user.id);
  return NextResponse.json(data);
}
