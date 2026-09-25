import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { isSharedDemoAccount } from "@/lib/demo/demoAccess";
import { checkoutCurrencyFor, getPricePlans, getStripe, stripeConfigured } from "@/lib/stripe";
import { getVisitorPriceCurrency } from "@/lib/billing/visitorCurrency";
import {
  APP_SIGNUP_FROM,
  PUBLIC_SIGNUP_SOURCE,
  normalizeSignupEmail,
} from "@/lib/billing/paidSignupLogic";

/**
 * The paid door (MONETISATION_NORTH_STAR.md, Phase 1): create a Stripe Checkout Session for a
 * STRANGER — no account exists yet. Public by design (middleware lets /api/billing/public-checkout
 * through); Stripe Checkout collects the email, and the webhook provisions the account on
 * `checkout.session.completed` via the `metadata.source` stamp.
 *
 * A signed-in user who lands here is handed the authenticated shape instead (their customer id +
 * `client_reference_id`), so wandering to /join while signed in never mints a duplicate customer.
 */
export async function POST(request: Request): Promise<Response> {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  // Public endpoint — brake by IP. Best-effort (per serverless instance), same caveat as
  // redeem-access-code; the real cost of abuse is bounded because a session is just a URL.
  const rl = checkApiRateLimit({
    key: `public-checkout:${clientIpKey(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const body = (await request.json().catch(() => null)) as {
    priceId?: string;
    email?: unknown;
    from?: unknown;
  } | null;
  const priceId = body?.priceId;
  // From the app's welcome email (`/join?email=…&from=app`): open checkout with the address the
  // account was made with, so the webhook's match-by-email lands the plan on that account.
  const prefillEmail = typeof body?.email === "string" ? normalizeSignupEmail(body.email) : null;
  const fromApp = body?.from === "app";
  if (!priceId) return NextResponse.json({ error: "priceId is required" }, { status: 400 });
  if (!getPricePlans().some((p) => p.priceId === priceId)) {
    return NextResponse.json({ error: "Unknown price" }, { status: 400 });
  }

  const stripe = getStripe();
  const origin =
    request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  // Middleware doesn't gate this route, but a session cookie may still be present. The shared demo
  // session is a stranger's borrowed one (the /join page treats it that way too): buying from it
  // must make the payer their own account, never put the plan on the demo's (2026-09-24 audit).
  const signedIn = await getAuthenticatedApiUser();
  const user =
    signedIn && !isSharedDemoAccount({ id: signedIn.id, email: signedIn.email }) ? signedIn : null;

  // The currency the plan cards showed this visitor (US$ in the US, € in the euro area).
  const currency = await checkoutCurrencyFor(priceId, await getVisitorPriceCurrency());

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ...(currency ? { currency } : {}),
    line_items: [{ price: priceId, quantity: 1 }],
    // The template literal is Stripe's, filled at redirect time — the success page uses it to
    // look up the payer's email so the sign-in code box can be offered right there.
    success_url: `${origin}/join/success?session_id={CHECKOUT_SESSION_ID}${fromApp ? "&app=1" : ""}`,
    cancel_url: `${origin}/join?status=cancel`,
    // Testers redeem their 100%-off comp codes through this same door — one provisioning path.
    allow_promotion_codes: true,
    // With a 100% code the first invoice is $0 — don't demand a card from a comped tester.
    // Anyone actually owing money still gets the normal card form.
    payment_method_collection: "if_required",
    // New Stripe accounts enable Managed Payments (Stripe as merchant of record) by default,
    // which rejects sessions unless every product carries a tax code — this 500'd the first
    // live checkout (2026-08-01). Opt out per-session: classic Checkout, exactly as tested.
    managed_payments: { enabled: false },
    ...(user
      ? {
          // Signed-in: behave like /api/billing/checkout so the webhook links by reference.
          ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : {}),
          client_reference_id: user.id,
        }
      : {
          // Stranger: Stripe collects the email; the webhook keys provisioning off this stamp, and
          // skips the sign-in email when the payer came from the app (already signed in there).
          metadata: {
            source: PUBLIC_SIGNUP_SOURCE,
            ...(fromApp ? { from: APP_SIGNUP_FROM } : {}),
          },
          ...(prefillEmail ? { customer_email: prefillEmail } : {}),
        }),
  });

  return NextResponse.json({ url: session.url });
}
