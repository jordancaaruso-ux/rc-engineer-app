/**
 * Route-key normalisation for perf samples.
 *
 * Pure and dependency-free on purpose — this module is imported by both the client
 * reporter and the server, so it must not pull in `server-only`, Prisma, or config.
 *
 * Without normalisation every visit to `/runs/<cuid>` is its own bucket and the
 * per-route rollups on /admin/perf say nothing.
 */

/** Longest route key we store; anything beyond this is a bug, not data. */
const MAX_ROUTE_LENGTH = 120;

const CUID = /^c[a-z0-9]{20,}$/i;
const CUID2 = /^[a-z0-9]{24,32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{16,}$/i;

/**
 * Prefixes that must never be sampled — including perf's own surfaces.
 *
 * Note `/api/perf`, not `/api/_perf`: App Router treats a leading underscore as a
 * private folder and never routes it, so the beacon would 404.
 */
const SKIP_PREFIXES = [
  "/api/perf",
  "/admin/perf",
  "/api/health",
  "/api/_debug",
  "/_next",
  "/favicon",
] as const;

const HAS_DIGIT = /\d/;

function isIdSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  // A dynamic segment already written as `[id]` by a caller stays as-is.
  if (segment.startsWith("[")) return false;
  if (NUMERIC.test(segment) || UUID.test(segment)) return true;

  // Every other id shape here is "long string of letters and digits", which a long
  // route word also satisfies — `/analysis/comparisonoverviewpanel` matched the cuid
  // pattern before this guard. Generated ids always carry a timestamp or random digit;
  // route words essentially never do.
  if (!HAS_DIGIT.test(segment)) return false;
  return CUID.test(segment) || CUID2.test(segment) || LONG_HEX.test(segment);
}

/**
 * Collapse id-shaped path segments so samples aggregate per route, not per record.
 * `/runs/clx9abc.../edit` -> `/runs/[id]/edit`. Query and hash are dropped.
 */
export function normalizeRoutePath(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  let path = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (!path.startsWith("/")) path = `/${path}`;
  // Trailing slash is not a distinct route.
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const normalized = path
    .split("/")
    .map((segment) => (isIdSegment(segment) ? "[id]" : segment))
    .join("/");

  const out = normalized.length === 0 ? "/" : normalized;
  return out.length > MAX_ROUTE_LENGTH ? out.slice(0, MAX_ROUTE_LENGTH) : out;
}

/**
 * True for routes the instrumentation must ignore. Self-exclusion matters: without
 * it the beacon endpoint and the admin page would sample themselves and every page
 * view would cost two rows instead of one.
 */
export function shouldSkipPerf(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  const path = normalizeRoutePath(pathname);
  return SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
