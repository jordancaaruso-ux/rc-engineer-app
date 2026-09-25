import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { isSharedDemoAccount } from "@/lib/demo/demoAccess";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import {
  APP_SIGNUP_FROM,
  PUBLIC_SIGNUP_SOURCE,
  normalizeSignupEmail,
} from "@/lib/billing/paidSignupLogic";
import { FOUNDING_OFFER, foundingClosedMessage } from "@/lib/billing/foundingOfferLogic";
import {
  foundingBatchPriceId,
  getFoundingOfferState,
  holdsFoundingSeat,
} from "@/lib/billing/foundingOffer";

/** Printed above Stripe's Pay button. The one place a buyer reads what "lifetime" means. */
const CHECKOUT_NOTE =
  "One payment, nothing renews. Race Engineer for the life of the app, with a full refund in the first 14 days.";

/**
 * Start a founding-seat checkout (docs/MONETISATION_NORTH_STAR.md, "Founding seats").
 *
 * A one-off Stripe payment, never a subscription checkout: the buyer sees "$399, once" and
 * nothing that looks like it renews. The seat itself (a $0 yearly subscription) is made by the
 * webhook once the payment clears. The batch price is decided HERE, from live seats, so the
 * page and the payment can never disagree about more than one racing buyer.
 *
 * Public, like /api/billing/public-checkout: a stranger pays and the webhook makes the account
 * from the checkout email. A signed-in member (from /billing) buys on their own Stripe customer,
 * and the webhook stops the plan they had from renewing.
 */
export async function POST(request: Request): Promise<Response> {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  const rl = checkApiRateLimit({
    key: `founding-checkout:${clientIpKey(request)}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  const state = await getFoundingOfferState();
  if (state.status !== "open") {
    return NextResponse.json({ error: foundingClosedMessage(state) }, { status: 409 });
  }
  const priceId = foundingBatchPriceId(state.batch.batch);
  if (!priceId) return NextResponse.json({ error: "Billing not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { email?: unknown; from?: unknown } | null;
  // From the app's welcome email (`/join?email=…&from=app`), exactly as public-checkout reads it.
  const prefillEmail = typeof body?.email === "string" ? normalizeSignupEmail(body.email) : null;
  const fromApp = body?.from === "app";

  const stripe = getStripe();
  const origin =
    request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  // The shared demo session is a stranger's borrowed one: buying from it must make the payer
  // their own account (same rule as public-checkout).
  const signedIn = await getAuthenticatedApiUser();
  const user =
    signedIn && !isSharedDemoAccount({ id: signedIn.id, email: signedIn.email }) ? signedIn : null;

  let customerId: string | null = null;
  if (user) {
    if (await holdsFoundingSeat(user.id)) {
      return NextResponse.json({ error: "You already have a founding seat." }, { status: 409 });
    }
    customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }
  }

  const batch = String(state.batch.batch);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: user
      ? `${origin}/billing?changed=1`
      : `${origin}/join/success?session_id={CHECKOUT_SESSION_ID}${fromApp ? "&app=1" : ""}`,
    cancel_url: user ? `${origin}/billing` : `${origin}/join?status=cancel`,
    // Short-lived, so an abandoned tab can't come back days later at a batch that has moved on.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    // Never a promo code: the testers' 100%-off-forever comp coupon would make a seat free.
    allow_promotion_codes: false,
    // Same opt-out as the plan checkouts: live Stripe rejects Managed Payments sessions whose
    // products carry no tax code.
    managed_payments: { enabled: false },
    custom_text: { submit: { message: CHECKOUT_NOTE } },
    payment_intent_data: {
      description: `${PRODUCT_NAME} founding member seat`,
      metadata: { offer: FOUNDING_OFFER, batch },
    },
    metadata: {
      offer: FOUNDING_OFFER,
      batch,
      // A stranger: the webhook makes the account from the checkout email, exactly as for a plan.
      ...(user ? {} : { source: PUBLIC_SIGNUP_SOURCE }),
      ...(!user && fromApp ? { from: APP_SIGNUP_FROM } : {}),
    },
    ...(user && customerId
      ? { customer: customerId, client_reference_id: user.id }
      : {
          // A payment-mode checkout makes no Stripe customer unless told to, and the seat
          // subscription needs one.
          customer_creation: "always" as const,
          ...(prefillEmail ? { customer_email: prefillEmail } : {}),
        }),
  });

  return NextResponse.json({ url: session.url });
}
