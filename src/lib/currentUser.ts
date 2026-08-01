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
 * Authenticated user *id* for Route Handlers — no database read.
 *
 * The id is already in the signed JWT, so the great majority of routes were spending a
 * `User` row lookup to learn something they had been handed. Measured: that read showed
 * up in 381 of 411 sampled requests, ~14ms each, on a median API request of 24ms.
 *
 * Use this whenever the handler only needs `user.id`. Use `getAuthenticatedApiUser` when
 * it genuinely needs `email` / `image` / `stripeCustomerId` — that read also confirms the
 * row still exists, which this deliberately does not. The trade-off: a deleted user still
 * holding a live JWT reaches the handler and fails on a foreign key rather than getting a
 * clean 401. Every read is user-scoped, so it returns nothing rather than another user's
 * data, and sign-in is allowlisted.
 */
export async function getAuthenticatedApiUserId(): Promise<string | null> {
  // Same rule as above: synchronous, first statement, never awaited. See the comment there.
  const perfStore = PERF_ENABLED ? beginApiPerf() : null;

  if (perfStore) await attachPerfRoute(perfStore);
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Server Components / server actions — redirect to login if missing session. NO entitlement
 * check: this is the escape hatch for the few pages an UNPAID user must still reach — today
 * that is exactly `/billing`, the page the paywall sends them to.
 *
 * Wrapped in React `cache()` so the `auth()` + user lookup is memoized per
 * request: pages that call it more than once (directly and via
 * `requireCurrentUserId`) no longer issue duplicate PK queries. In non-render
 * contexts (route handlers, actions) `cache()` is a no-op — still correct.
 */
export const requireCurrentUserAllowUnpaid = cache(
  async function requireCurrentUserAllowUnpaid(): Promise<User> {
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
  },
);

/**
 * Server Components / server actions — the standard page guard: signed in AND entitled.
 *
 * This is the paywall's shell gate (MONETISATION_NORTH_STAR.md Phase 2): every page that calls
 * `requireCurrentUser` — which is essentially every page — bounces an authenticated-but-unpaid
 * user to /billing. While `BILLING_ENFORCED` is unset, `getEntitlement` short-circuits to full
 * access with NO extra DB reads, so today's behaviour is byte-identical.
 *
 * The import is lazy to keep this module's static graph free of `entitlement.ts` (which pulls
 * `server-only`); the dev scripts that import `currentUser` transitively keep working.
 */
export const requireCurrentUser = cache(async function requireCurrentUser(): Promise<User> {
  const user = await requireCurrentUserAllowUnpaid();
  const { getEntitlement } = await import("@/lib/entitlement");
  const entitlement = await getEntitlement(user);
  if (!entitlement.entitled) {
    redirect("/billing");
  }
  return user;
});

/** Convenience when only the id is needed (RSC). */
export async function requireCurrentUserId(): Promise<string> {
  return (await requireCurrentUser()).id;
}
