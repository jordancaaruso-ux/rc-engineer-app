import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getAuthenticatedApiUser, requireCurrentUser } from "@/lib/currentUser";
import { isFeatureEntitled, type Feature } from "@/lib/entitlementLogic";
import { getEntitlement, type Entitlement } from "@/lib/entitlement";

/**
 * Redirect-based entitlement guards (kept separate from the resolvers in `entitlement.ts` so those
 * stay `next/navigation`-free and unit-testable). Wire these into paid pages/routes when enforcing.
 */

/**
 * Server Components / actions — like `requireCurrentUser`, but also requires a paid (or
 * grandfathered) user. Unauthenticated → /login; authenticated-but-unpaid → /billing. A drop-in
 * replacement for `requireCurrentUser` on any surface that should need a subscription.
 */
export const requireEntitledUser = cache(async function requireEntitledUser(): Promise<User> {
  const user = await requireCurrentUser();
  const entitlement = await getEntitlement(user);
  if (!entitlement.entitled) redirect("/billing");
  return user;
});

/** Require entitlement to a specific feature (e.g. Pro-only `video`). One-tier-short → /billing. */
export async function requireFeature(feature: Feature): Promise<User> {
  const user = await requireCurrentUser();
  const entitlement = await getEntitlement(user);
  if (!isFeatureEntitled(entitlement.tier, feature)) redirect("/billing");
  return user;
}

/**
 * Route Handlers — returns the user + entitlement, or null when unauthenticated (respond 401).
 * Callers check `entitlement.entitled` / `isFeatureEntitled(...)` and respond 402 when short.
 */
export async function getEntitledApiUser(): Promise<{ user: User; entitlement: Entitlement } | null> {
  const user = await getAuthenticatedApiUser();
  if (!user) return null;
  const entitlement = await getEntitlement(user);
  return { user, entitlement };
}
