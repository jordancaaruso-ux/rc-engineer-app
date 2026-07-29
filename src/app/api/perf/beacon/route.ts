import { after } from "next/server";

import { auth } from "@/auth";
import { parseBeaconPayload } from "@/lib/perf/beaconPayload";
import { PERF_DEPLOY_ID, PERF_ENABLED } from "@/lib/perf/perfConfig";
import { prisma } from "@/lib/prisma";

/** Beacons are small; anything larger is not ours. */
const MAX_BODY_BYTES = 8000;

/**
 * Client RUM sink.
 *
 * Always answers 204, never an error: a failing profiler must be invisible to the user
 * rather than a red line in their console. Notably this uses `auth()` directly instead
 * of `getAuthenticatedApiUser()` — that helper does a User row read, and the thing
 * measuring latency must not add any.
 *
 * Middleware already 401s unauthenticated `/api/*`, and the route is excluded from its
 * own instrumentation by `shouldSkipPerf`.
 *
 * Lives at `/api/perf/*`, not `/api/_perf/*`: App Router treats an underscore-prefixed
 * folder as private and never routes it.
 */
export async function POST(request: Request): Promise<Response> {
  if (!PERF_ENABLED) return new Response(null, { status: 204 });

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return new Response(null, { status: 204 });

    const raw = await request.text();
    if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 204 });
    }

    const rows = parseBeaconPayload(raw, userId, PERF_DEPLOY_ID);
    if (rows.length === 0) return new Response(null, { status: 204 });

    after(async () => {
      try {
        // skipDuplicates + @@unique([metricId, name]) absorbs retried beacons and
        // StrictMode double-reports without a read-before-write.
        await prisma.perfClientMetric.createMany({ data: rows, skipDuplicates: true });
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }

  return new Response(null, { status: 204 });
}
