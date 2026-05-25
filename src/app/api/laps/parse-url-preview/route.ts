import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import { parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { validateTimingHttpUrlResolved } from "@/lib/lapImport/service";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";

const MAX_URLS_PER_REQUEST = 20;
const MAX_URLS_ADMIN = 100;

/** Parse-only preview (no persistence). Prefer POST /api/lap-time-sessions/import when storing. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const authUser = await getAuthenticatedApiUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkApiRateLimit({
    key: `lap-parse-preview:${authUser.id}`,
    limit: 60,
    windowMs: 60 * 60 * 1000,
    userEmail: authUser.email,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const url = body?.url?.trim() ?? "";
  const v = await validateTimingHttpUrlResolved(url, {
    allowAnyPublicHost: isAuthAdminEmail(authUser.email),
  });
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const liveName = (await getLiveRcDriverNameSetting(authUser.id).catch(() => null))?.trim() ?? "";
  const parsed = await parseTimingUrl(v.normalized, liveName ? { driverName: liveName } : undefined);
  return NextResponse.json({
    parserId: parsed.parserId,
    laps: parsed.laps,
    lapRows: parsed.lapRows ?? null,
    candidates: parsed.candidates ?? [],
    sessionDrivers: parsed.sessionDrivers ?? [],
    sessionHint: parsed.sessionHint ?? null,
    sessionCompletedAtIso: parsed.sessionCompletedAtIso ?? null,
    discoveredRaceUrls: parsed.discoveredRaceUrls ?? null,
    message: parsed.message ?? null,
    errorCode: parsed.errorCode ?? null,
    url: v.normalized,
  });
}
