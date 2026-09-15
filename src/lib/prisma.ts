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

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
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

if (process.env.NODE_ENV !== "production") {
  // Cache the base client, never the extended proxy — otherwise each HMR pass would
  // wrap the previous proxy and stack a new timing layer on every query.
  globalForPrisma.prisma = basePrisma;
}
