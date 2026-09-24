import { PrismaClient } from "@prisma/client";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import { perfExtension } from "@/lib/perf/prismaPerfExtension";
import { runWindowExtension } from "@/lib/runs/runWindowExtension";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function assertActionItemDelegate(client: PrismaClient): void {
  const delegate = (
    client as unknown as { actionItem?: { findFirst?: unknown } }
  ).actionItem;
  if (delegate == null || typeof delegate.findFirst !== "function") {
    throw new Error(
      "Prisma client is missing prisma.actionItem (ActionItem model). " +
        "Stop the dev server, run `npx prisma generate`, apply migrations (`npx prisma migrate deploy` in prod / `migrate dev` locally), and restart. " +
        "On Windows, if generate shows EPERM, close anything using node_modules/.prisma (IDE, dev server, antivirus scan)."
    );
  }
}

/**
 * Pool settings for serverless (2026-09-24 launch audit). Prisma's default pool is
 * `num_cpus * 2 + 1` — 5 on a Vercel function — with a 10 s wait, and under Fluid compute one
 * instance serves many requests at once through that one pool. A dashboard or Paddock cache
 * rebuild alone fans 13–25 queries into it, and production logged P2024 "Timed out fetching a new
 * connection from the connection pool" four times in one week with ~7 active drivers.
 *
 * DATABASE_URL points at Neon's PgBouncer (`-pooler`), which accepts thousands of client
 * connections and multiplexes them onto ~400 server ones, so 15 per instance is headroom, not
 * load. Not much higher: 50 heavy scans at once on a small compute just moves the queue into
 * Postgres. Anything already set on the URL wins, so an operator can still tune it there.
 * String-appended on purpose — a URL round-trip could re-encode the password.
 */
const POOL_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ["connection_limit", "15"],
  ["pool_timeout", "20"],
  ["connect_timeout", "15"],
];

export function withPoolParams(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url = raw;
  for (const [key, value] of POOL_PARAMS) {
    if (new RegExp(`[?&]${key}=`).test(url)) continue;
    url += `${url.includes("?") ? "&" : "?"}${key}=${value}`;
  }
  return url;
}

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    datasourceUrl: withPoolParams(process.env.DATABASE_URL),
    // Interactive transactions wait at most 2 s for a connection by default — shorter than the
    // pool's own wait — so under load a run save failed (P2028) before any page query did.
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });

/**
 * Two query extensions, neither of which adds a delegate, method or field — so casting the
 * extended client back to `PrismaClient` is sound and keeps the exported type identical for every
 * importer.
 *
 * `runWindowExtension` is always on: it is what keeps a Starter member's hidden runs off every
 * screen (docs/STARTER_TIER_PLAN.md), and it must not be skippable by config. The perf extension
 * only wraps `query` for timing; when PERF_INSTRUMENTATION is off there is no second proxy.
 */
const withRunWindow = basePrisma.$extends(runWindowExtension);
export const prisma: PrismaClient = (
  PERF_ENABLED ? withRunWindow.$extends(perfExtension) : withRunWindow
) as unknown as PrismaClient;

/**
 * The `run` delegate WITHOUT the plan window — the base client's own. For the three internals
 * that must see hidden runs: `applyRunWindow` (it is what hides and reveals them), the Sessions
 * page's hidden count (the "N older runs · Upgrade" row), and the community setup aggregation
 * (the shared numbers stay whole; hiding is about what the driver sees). Nothing that shows a run
 * to its owner may import this.
 */
export const runsIncludingHidden = basePrisma.run;

assertActionItemDelegate(prisma);

// Cache the base client, never the extended proxy — otherwise each HMR pass would wrap the
// previous proxy and stack a new timing layer on every query. Cached in production too: if the
// bundler evaluates this module in more than one server chunk, every copy still shares ONE pool
// per process instead of opening a pool each.
globalForPrisma.prisma = basePrisma;
