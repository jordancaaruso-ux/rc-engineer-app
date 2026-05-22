import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { loadDriversFromTimingUrl } from "@/lib/manualVideoAnalysis/loadTiming";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    primaryDriverName?: string | null;
  } | null;

  if (!body?.url?.trim()) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const result = await loadDriversFromTimingUrl(body.url.trim(), body.primaryDriverName);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    drivers: result.drivers,
    parserId: result.parserId,
  });
}
