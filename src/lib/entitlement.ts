import "server-only";
import { cache } from "react";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
 * Is this account exempt from billing entirely? ADMINS ONLY.
 *
 * RETIRED 2026-08-01 (MONETISATION_NORTH_STAR.md, Phase 5): allowlist rows and
 * `AUTH_ALLOWED_EMAILS` no longer grandfather anyone. The founder decision is comps-via-codes —
 * testers subscribe through the same checkout as everyone else with a 100%-off promo code, so
 * their access can later expire or convert without touching code. The allowlist remains purely a
 * SIGN-IN gate (who may authenticate), never an entitlement grant. Launch-day consequence: send
 * the comp codes BEFORE flipping `BILLING_ENFORCED`, or testers land on /billing.
 *
 * Still deliberately independent of `isEmailAuthAllowed` — open signup must never grant access.
 */
export async function isGrandfatheredEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return isAuthAdminEmail(normalized);
}

/**
 * Per-request memoized DB read.
 *
 * Keyed on PRIMITIVES (an id), never on the `User` object — React `cache()` memoizes by argument
 * identity, and `getAuthenticatedApiUser` returns a fresh object per call, so an object-keyed
 * cache would miss on exactly the paths that call this most.
 *
 * In non-render contexts (route handlers, actions, unit tests) `cache()` is a passthrough — same
 * behaviour as `requireCurrentUser`, just without the dedupe.
 */
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
