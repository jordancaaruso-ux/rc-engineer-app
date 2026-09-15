/**
 * One place for the Sentry options every runtime shares (browser, Node, edge).
 *
 * The whole thing is inert until `NEXT_PUBLIC_SENTRY_DSN` is set: no DSN, no init, no network
 * call, no console noise — so a local dev run and a fresh clone behave exactly as before. One
 * variable for all three runtimes on purpose; a DSN is a public write-only address, not a secret.
 *
 * Errors only. Performance tracing is off (`tracesSampleRate: 0`) — the app already has its own
 * perf logging (`src/lib/perf/`), and a solo founder needs "what broke for whom" before "how
 * slow was it". Turn tracing on later by raising the rate here, nowhere else.
 */

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;

/**
 * Browser noise that is never a bug in this app. Each of these has been a top-10 "issue" in
 * every Sentry project that ever had a mobile Safari user.
 */
const IGNORED_ERRORS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  /Loading chunk [\d]+ failed/,
  /Loading CSS chunk [\d]+ failed/,
  "The operation was aborted",
  "AbortError",
  "Network request failed",
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource",
  // The service worker + iOS PWA shell throw these on backgrounding; nothing to fix.
  "The user aborted a request",
  "cancelled",
];

export function sharedSentryOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: Boolean(SENTRY_DSN),
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() ||
      process.env.VERCEL_ENV?.trim() ||
      process.env.NODE_ENV ||
      "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: IGNORED_ERRORS,
  };
}
