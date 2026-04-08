import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { validateTimingHttpUrl } from "@/lib/lapImport/service";

/** Parse-only preview (no persistence). Prefer POST /api/lap-time-sessions/import when storing. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  await getOrCreateLocalUser();

  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const url = body?.url?.trim() ?? "";
  const v = validateTimingHttpUrl(url);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const parsed = await parseTimingUrl(v.normalized);

  return NextResponse.json({
    parserId: parsed.parserId,
    laps: parsed.laps,
    lapRows: parsed.lapRows ?? null,
    candidates: parsed.candidates ?? [],
    sessionDrivers: parsed.sessionDrivers ?? [],
    sessionHint: parsed.sessionHint ?? null,
    sessionCompletedAtIso: parsed.sessionCompletedAtIso ?? null,
    message: parsed.message ?? null,
    errorCode: parsed.errorCode ?? null,
    url: v.normalized,
  });
}
