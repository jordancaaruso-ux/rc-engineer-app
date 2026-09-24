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

/**
 * Stamped into `metadata.from` by the public checkout when it started from the app's welcome email
 * (`/join?email=…&from=app`, 2026-09-24).
 */
export const APP_SIGNUP_FROM = "app";

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
 * Did this checkout start from the app's welcome email? That account was made in the app and is
 * already signed in there, so the payer needs no sign-in code. The founder got one on his own test
 * and couldn't tell why (2026-09-24).
 */
export function isAppSignupSession(session: CheckoutSessionSignupLike): boolean {
  return session.metadata?.from === APP_SIGNUP_FROM;
}

/**
 * Whose account a completed checkout belongs to. `memberUserId` is the signed-in account the
 * checkout named (`client_reference_id`); `publicSignup` means the payer needs an account made
 * from their checkout email, plus the sign-in code.
 *
 * A checkout naming the shared demo account is a stranger's. A visitor browsing the demo who
 * pressed "Get your own garage" carried the demo's session into checkout, and the webhook linked
 * the payment to the demo: no account of their own, no code, and the demo's plan overwritten for
 * every visitor after (2026-09-24 audit). The checkout route now opens a stranger's checkout for a
 * demo session; this keeps any session opened before that fix, or any other route to it, right.
 */
export function resolveCheckoutOwner(
  session: CheckoutSessionSignupLike,
  isDemoAccountId: (id: string) => boolean,
): { memberUserId: string | null; publicSignup: boolean } {
  const ref = session.client_reference_id?.trim() || null;
  const demoRef = ref != null && isDemoAccountId(ref);
  const memberUserId = demoRef ? null : ref;
  return {
    memberUserId,
    publicSignup: memberUserId == null && (demoRef || isPublicSignupSession(session)),
  };
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
