import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { getAuthenticatedApiUser, requireCurrentUser } from "@/lib/currentUser";
import { isFeatureEntitled, type Feature } from "@/lib/entitlementLogic";
import { getEntitlement, type Entitlement } from "@/lib/entitlement";
import { TIER_LABELS } from "@/lib/brand/brandNames";

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

/**
 * Segment layouts / server pages — is this Pro feature LOCKED for the current viewer?
 * `requireCurrentUser` inside already bounces unauthenticated → /login and unpaid → /billing, so
 * "locked" here means exactly one thing: a paying Standard subscriber one tier short — the
 * visible-but-locked upsell state (`ProLockedPanel`), never a redirect.
 */
export async function isFeatureLockedForCurrentUser(feature: Feature): Promise<boolean> {
  const user = await requireCurrentUser();
  const entitlement = await getEntitlement(user);
  return !isFeatureEntitled(entitlement.tier, feature);
}

/**
 * Route Handlers — one-line feature guard for the expensive Pro APIs. Returns the user, or a
 * ready-to-return 401/402 response. 402 (not 403) so clients can distinguish "pay for this"
 * from "not yours".
 */
export async function requireApiFeature(
  feature: Feature,
): Promise<{ user: User; response: null } | { user: null; response: Response }> {
  const result = await getEntitledApiUser();
  if (!result) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!isFeatureEntitled(result.entitlement.tier, feature)) {
    return {
      user: null,
      response: NextResponse.json(
        {
          error: `This feature is part of ${TIER_LABELS.pro}. Upgrade on the Subscription page.`,
        },
        { status: 402 },
      ),
    };
  }
  return { user: result.user, response: null };
}
