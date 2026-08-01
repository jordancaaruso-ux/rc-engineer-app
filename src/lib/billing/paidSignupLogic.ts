/**
 * Pure paid-signup logic — NO database, NO `server-only`, NO Next/Stripe runtime imports (the
 * Stripe shapes are described structurally). Safe to unit-test (`npm run test:paid-signup`).
 * The DB-backed provisioning lives in `paidSignup.ts`, mirroring the `entitlementLogic.ts` /
 * `entitlement.ts` split.
 *
 * Model: the paid door (MONETISATION_NORTH_STAR.md, Phase 1). A stranger pays first via public
 * Stripe Checkout; the webhook then provisions their account from the session. These helpers
 * decide (a) whether a checkout session came through the public door and (b) what email to
 * provision from — never trusting shapes beyond what Stripe guarantees.
 */

/** Stamped into `metadata.source` by the public checkout route; the webhook keys off it exactly. */
export const PUBLIC_SIGNUP_SOURCE = "public-signup";

/** The subset of a Stripe.Checkout.Session the paid-signup path reads. */
export type CheckoutSessionSignupLike = {
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
};

/**
 * Lowercased/trimmed, minimally-validated email. Mirrors `redeem-access-code`'s normalizer: the
 * goal is a stable DB key, not RFC validation — Stripe already validated deliverability harder
 * than a regex can.
 */
export function normalizeSignupEmail(raw: string | null | undefined): string | null {
  const t = raw?.trim().toLowerCase();
  if (!t || !t.includes("@") || /\s/.test(t)) return null;
  return t;
}

/**
 * Did this checkout session come through the public (unauthenticated) door? Keyed on the exact
 * metadata stamp — NOT on "no client_reference_id", so an authenticated checkout that happens to
 * omit the reference can never be mistaken for a stranger signing up.
 */
export function isPublicSignupSession(session: CheckoutSessionSignupLike): boolean {
  return session.metadata?.source === PUBLIC_SIGNUP_SOURCE;
}

/**
 * The email to provision from. `customer_details.email` is what the buyer actually typed into
 * Checkout (always present on a completed session); `customer_email` is only the pre-fill hint,
 * kept as a fallback for defensive completeness.
 */
export function extractCheckoutEmail(session: CheckoutSessionSignupLike): string | null {
  return (
    normalizeSignupEmail(session.customer_details?.email) ??
    normalizeSignupEmail(session.customer_email)
  );
}
