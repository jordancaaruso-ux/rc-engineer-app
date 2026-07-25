import "server-only";
import { cache } from "react";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseEnvAuthAllowlist } from "@/lib/authAllowlist";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { deriveSubscriptionTier, isBillingEnforced, type Tier } from "@/lib/entitlementLogic";

export type { Feature, Tier } from "@/lib/entitlementLogic";
export { isFeatureEntitled } from "@/lib/entitlementLogic";

/**
 * Entitlement RESOLVERS — deliberately free of `next/navigation` and `currentUser` so this module
 * is safe to unit-test (no React-client context in the import graph). The redirect-based guards
 * (`requireEntitledUser`, `requireFeature`, `getEntitledApiUser`) live in `entitlementGuards.ts`.
 */

export type Entitlement = {
  tier: Tier;
  entitled: boolean;
  grandfathered: boolean;
};

/** Enforcement-off and grandfathered users share this: full access, no billing. */
const FULL_ACCESS: Entitlement = { tier: "pro", entitled: true, grandfathered: true };

/**
 * Is this email one of the pre-paywall invited testers (or an admin)? They are grandfathered to
 * full access forever and never billed.
 *
 * IMPORTANT: this deliberately does NOT call `isEmailAuthAllowed` — that returns true for EVERYONE
 * once `AUTH_OPEN_SIGNUP=1`, which would hand every new self-signup free Pro and defeat the paywall.
 * Grandfathering is strictly the real invite list: admin emails, `AUTH_ALLOWED_EMAILS`, and
 * `AuthAllowedEmail` rows.
 */
export async function isGrandfatheredEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  if (isAuthAdminEmail(normalized)) return true;
  if (parseEnvAuthAllowlist().has(normalized)) return true;
  const row = await findAllowedEmailRow(normalized);
  return row != null;
}

/**
 * Per-request memoized DB reads.
 *
 * Keyed on PRIMITIVES (an id / a normalized email), never on the `User` object — React `cache()`
 * memoizes by argument identity, and `getAuthenticatedApiUser` returns a fresh object per call, so
 * an object-keyed cache would miss on exactly the paths that call this most.
 *
 * In non-render contexts (route handlers, actions, unit tests) `cache()` is a passthrough — same
 * behaviour as `requireCurrentUser`, just without the dedupe.
 */
const findAllowedEmailRow = cache(async function findAllowedEmailRow(email: string) {
  return prisma.authAllowedEmail.findUnique({ where: { email } });
});

const findSubscription = cache(async function findSubscription(userId: string) {
  return prisma.subscription.findUnique({ where: { userId } });
});

const resolveEntitlement = cache(async function resolveEntitlement(
  userId: string,
  email: string | null,
): Promise<Entitlement> {
  if (!isBillingEnforced()) return FULL_ACCESS;
  if (await isGrandfatheredEmail(email)) return FULL_ACCESS;
  const sub = await findSubscription(userId);
  const tier = deriveSubscriptionTier(sub, new Date());
  return { tier, entitled: tier !== "none", grandfathered: false };
});

/**
 * Resolve a user's current entitlement. Enforcement-off or grandfathered → full (Pro) access.
 *
 * Memoized per request: conversion surfaces (nav entry, upgrade CTA, settings row, page guard) all
 * ask independently, and without this each answer costs an `AuthAllowedEmail` + a `Subscription`
 * query.
 */
export async function getEntitlement(user: User): Promise<Entitlement> {
  return resolveEntitlement(user.id, user.email ?? null);
}
