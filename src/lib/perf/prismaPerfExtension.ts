import { Prisma } from "@prisma/client";

import { currentPerfStore, recordQuery } from "@/lib/perf/perfStore";

/**
 * Times every Prisma call and attributes it to the current request's perf store.
 *
 * Top-level `$allOperations` covers every model *and* the raw operations
 * (`$queryRaw` / `$executeRaw`), where `model` is undefined. This is the Prisma 6
 * client-extension API — the old `$use` middleware is deprecated and does not see
 * raw queries at all.
 *
 * Only applied when PERF_INSTRUMENTATION=1 (see `src/lib/prisma.ts`), so when the
 * layer is off there is not even a proxy in the way.
 */
export const perfExtension = Prisma.defineExtension({
  name: "rc-perf",
  query: {
    async $allOperations({ model, operation, args, query }) {
      const store = currentPerfStore();
      if (!store) return query(args);

      const startedAt = performance.now();
      try {
        return await query(args);
      } finally {
        // Instrumentation must never be able to break a query.
        try {
          recordQuery(store, model ?? "$raw", operation, performance.now() - startedAt);
        } catch {
          /* ignore */
        }
      }
    },
  },
});
