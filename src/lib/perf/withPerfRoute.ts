import "server-only";

import { after } from "next/server";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import { createPerfStore, runWithPerf } from "@/lib/perf/perfStore";
import { flushPerfSample } from "@/lib/perf/recordSample";
import { buildServerTimingHeader } from "@/lib/perf/serverTiming";

type RouteHandler<Context> = (request: Request, context: Context) => Promise<Response>;

/**
 * Wrap a hot route handler so it emits a `Server-Timing` response header — visible in
 * the Chrome DevTools Network panel with no tooling at all — and records an exact
 * pre-stream total instead of the post-stream upper bound `after()` would give.
 *
 * Reserve this for routes worth opening DevTools on. Every other route is already
 * sampled to the database through `getAuthenticatedApiUser`; the wrapper only adds
 * the header and the tighter total.
 *
 * When the layer is off this is the identity function — not even a closure.
 */
export function withPerfRoute<Context>(
  routeKey: string,
  handler: RouteHandler<Context>
): RouteHandler<Context> {
  if (!PERF_ENABLED) return handler;

  return async (request, context) => {
    const store = createPerfStore("api");
    store.seeded = true;
    store.route = routeKey;
    store.method = request.method;
    // Claim the flush up front. The handler will call `getAuthenticatedApiUser`, whose
    // `beginApiPerf` would otherwise schedule a bare flush first and win the race —
    // costing us the status and the exact pre-stream total we are here to capture.
    store.registered = true;

    return runWithPerf(store, async () => {
      const response = await handler(request, context);
      const totalMs = performance.now() - store.startedAt;

      // Re-wrap rather than mutate: headers on a Response are immutable in some
      // runtimes, and this preserves the status and the streaming body.
      let withTiming: Response;
      try {
        withTiming = new Response(response.body, response);
        withTiming.headers.set("Server-Timing", buildServerTimingHeader(store, totalMs));
      } catch {
        withTiming = response;
      }

      after(async () => {
        await flushPerfSample(store, { status: response.status, totalMs });
      });
      return withTiming;
    });
  };
}
