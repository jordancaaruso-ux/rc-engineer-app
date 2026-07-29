import { PrismaClient } from "@prisma/client";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import { perfExtension } from "@/lib/perf/prismaPerfExtension";

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
 * The perf extension only wraps `query` — it adds no delegates, methods, or fields — so
 * casting the extended client back to `PrismaClient` is sound and keeps the exported type
 * identical for every importer. When PERF_INSTRUMENTATION is off we skip `$extends`
 * entirely, so there is not even a proxy between callers and the driver.
 */
export const prisma: PrismaClient = PERF_ENABLED
  ? (basePrisma.$extends(perfExtension) as unknown as PrismaClient)
  : basePrisma;

assertActionItemDelegate(prisma);

if (process.env.NODE_ENV !== "production") {
  // Cache the base client, never the extended proxy — otherwise each HMR pass would
  // wrap the previous proxy and stack a new timing layer on every query.
  globalForPrisma.prisma = basePrisma;
}
