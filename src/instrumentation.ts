import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook: runs once per server instance, before any request.
 *
 * Picks the Sentry init for the runtime this instance is (Node for pages/routes, edge for the
 * middleware). `onRequestError` is what actually catches a 500 in a route handler or a server
 * component render and reports it — without it Sentry only sees browser-side errors. Both are
 * no-ops until `NEXT_PUBLIC_SENTRY_DSN` is set (see `src/lib/observability/sentryInit.ts`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/observability/sentryServer");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./lib/observability/sentryEdge");
  }
}

export const onRequestError = Sentry.captureRequestError;
