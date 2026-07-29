import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireDatabaseUrl } from "@/lib/env";
import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import { attachPerfRoute, beginApiPerf } from "@/lib/perf/beginPerf";
import type { User } from "@prisma/client";

/**
 * Authenticated user for Route Handlers — returns null with no redirect (use 401 JSON).
 *
 * Nearly every route handler awaits this, which makes it the one place worth opening a
 * perf scope from: a single line here instruments the whole API surface. It is a plain
 * boolean check when PERF_INSTRUMENTATION is off.
 */
export async function getAuthenticatedApiUser(): Promise<User | null> {
  // MUST stay the first statement, and MUST NOT be awaited. AsyncLocalStorage's
  // `enterWith` only covers continuations created during the current synchronous
  // execution — which, before this function's first `await`, still includes the calling
  // route handler. Move it below an `await` and every route reports zero queries.
  const perfStore = PERF_ENABLED ? beginApiPerf() : null;

  requireDatabaseUrl();
  if (perfStore) await attachPerfRoute(perfStore);
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Server Components / server actions — redirect to login if missing session.
 *
 * Wrapped in React `cache()` so the `auth()` + user lookup is memoized per
 * request: pages that call it more than once (directly and via
 * `requireCurrentUserId`) no longer issue duplicate PK queries. In non-render
 * contexts (route handlers, actions) `cache()` is a no-op — still correct.
 */
export const requireCurrentUser = cache(async function requireCurrentUser(): Promise<User> {
  requireDatabaseUrl();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    redirect("/login");
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    redirect("/login");
  }
  return user;
});

/** Convenience when only the id is needed (RSC). */
export async function requireCurrentUserId(): Promise<string> {
  return (await requireCurrentUser()).id;
}
