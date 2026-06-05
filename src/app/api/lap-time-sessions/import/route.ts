import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { getLiveRcDriverNameSetting } from "@/lib/appSettings";
import {
  getSpeedhiveDriverNameForUser,
  getSpeedhiveTransponderNumbersForUser,
} from "@/lib/speedhive/speedhiveDriverSettings";
import { importOneTimingUrl } from "@/lib/lapImport/service";
import { expandLiveRcEventHubForImport } from "@/lib/lapImport/expandLiveRcEventHub";
import { isLiveRcEventHubUrl } from "@/lib/lapWatch/livercSessionIndexParsers";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";

const MAX_URLS_PER_REQUEST = 20;
const MAX_URLS_ADMIN = 100;

/**
 * Batch import timing URLs: each URL uses parseTimingUrl + persisted ImportedLapTimeSession.
 * LiveRC event hub URLs (`p=view_event`) expand to child `view_race_result` imports (optional `eventId`
 * filters by that event's race class list).
 * Failures are per-URL; successful imports are still saved.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = isAuthAdminEmail(user.email);
  const rl = checkApiRateLimit({
    key: `lap-import:${user.id}`,
    limit: isAdmin ? 200 : 40,
    windowMs: 60 * 60 * 1000,
    userEmail: user.email,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as
    | { urls?: unknown; url?: unknown; eventId?: unknown }
    | null;

  const rawList: string[] = [];
  if (Array.isArray(body?.urls)) {
    for (const u of body.urls) {
      if (typeof u === "string" && u.trim()) rawList.push(u.trim());
    }
  } else if (typeof body?.url === "string" && body.url.trim()) {
    rawList.push(body.url.trim());
  }

  if (rawList.length === 0) {
    return NextResponse.json({ error: "Provide url or urls[]" }, { status: 400 });
  }

  const maxUrls = isAdmin ? MAX_URLS_ADMIN : MAX_URLS_PER_REQUEST;
  if (rawList.length > maxUrls) {
    return NextResponse.json(
      { error: `Too many URLs (max ${maxUrls}${isAdmin ? "" : " — admin can import more"})` },
      { status: 400 }
    );
  }

  const eventId =
    typeof body?.eventId === "string" && body.eventId.trim() ? body.eventId.trim() : undefined;

  const [liveName, speedhiveName, transponderNumbers] = await Promise.all([
    getLiveRcDriverNameSetting(user.id).catch(() => null),
    getSpeedhiveDriverNameForUser(user.id).catch(() => null),
    getSpeedhiveTransponderNumbersForUser(user.id).catch(() => [] as number[]),
  ]);
  const driverName = (speedhiveName ?? liveName)?.trim() ?? "";
  const ctx = {
    ...(driverName ? { driverName } : {}),
    ...(transponderNumbers.length > 0
      ? { speedhiveTransponderNumbers: transponderNumbers }
      : {}),
    allowAnyPublicHost: isAdmin,
  };

  const results = [];
  for (const url of rawList) {
    if (isLiveRcEventHubUrl(url)) {
      const exp = await expandLiveRcEventHubForImport(user.id, url, eventId);
      if (exp.fetchFailed) {
        results.push({
          url,
          success: false as const,
          error: "Could not load this LiveRC event page.",
        });
        continue;
      }
      if (exp.urlsToImport.length === 0) {
        results.push({
          url,
          success: false as const,
          error:
            "No new race sessions to import from this event page (they may already be imported). When using event filter, set Race class on the event to limit classes.",
        });
        continue;
      }
      for (const child of exp.urlsToImport) {
        const r = await importOneTimingUrl(user.id, child, ctx);
        results.push(r);
      }
      continue;
    }
    const r = await importOneTimingUrl(user.id, url, ctx);
    results.push(r);
  }

  revalidatePath("/laps/import");

  return NextResponse.json({ results });
}
