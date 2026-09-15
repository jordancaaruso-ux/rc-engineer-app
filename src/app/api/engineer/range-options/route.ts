import { NextResponse } from "next/server";
import { requireApiFeature } from "@/lib/entitlementGuards";
import { hasDatabaseUrl } from "@/lib/env";
import { countRunsInRange, loadRangeOptions } from "@/lib/engineer/driverHistory";
import { parseRangeScope } from "@/lib/engineer/rangeScope";

/**
 * What the Engineer's range picker offers — the tracks and cars the driver has run, with
 * counts, and the span of their logging — plus, when a scope is on the query string, how
 * many runs that scope holds, so the subject bar can say "43 runs" before the driver asks.
 *
 * Same lock as the chat route: Starter has no Engineer (docs/STARTER_TIER_PLAN.md).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const gate = await requireApiFeature("engineer");
  if (gate.response) return gate.response;
  const userId = gate.user.id;

  const sp = new URL(request.url).searchParams;
  const wantsCount =
    ["eventId", "trackId", "carId", "from", "to"].some((k) => sp.has(k)) || sp.get("count") === "1";
  const scope = wantsCount
    ? parseRangeScope({
        eventId: sp.get("eventId"),
        trackId: sp.get("trackId"),
        carId: sp.get("carId"),
        from: sp.get("from"),
        to: sp.get("to"),
      })
    : null;

  const [options, count] = await Promise.all([
    loadRangeOptions(userId),
    scope ? countRunsInRange(userId, scope) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ...options, count });
}
