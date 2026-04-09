import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { checkWatchedLapSources } from "@/lib/lapWatch/detect";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as { forceImport?: unknown } | null;
  const forceImport = body?.forceImport === true;
  const results = await checkWatchedLapSources({ userId: user.id, forceImport });
  return NextResponse.json({ results });
}

