import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { buildEngineerCompareOptions } from "@/lib/engineerPhase5/engineerCompareOptions";

export const dynamic = "force-dynamic";

/** Run picker options for Engineer compare (mine + linked teammates). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const data = await buildEngineerCompareOptions(user.id);
  return NextResponse.json(data);
}
