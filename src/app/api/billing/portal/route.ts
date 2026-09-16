import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { getPricePlans, getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Open the Stripe Billing Portal — the whole manage / cancel / update-card / switch-tier surface,
 * so we don't hand-build any of it. Auth required; user must already have a Stripe customer.
 *
 * `{ flow: "subscription_update", priceId }` opens the portal straight on Stripe's confirm screen
 * for THAT plan (2026-09-15): the Subscription page's "Upgrade to Race Engineer" lands on "Race
 * Engineer, $X due today, Confirm", not on a list to pick from again. The price must be one we
 * configured, and the portal configuration must list it under subscription updates (the Stripe
 * setup scripts do that). If Stripe refuses the confirm flow, the plan switcher opens instead;
 * if it refuses that too, the plain portal. Each refusal is logged, so a member can always still
 * manage while the gap gets fixed.
 *
 * `{ flow: "subscription_update" }` without a price opens the plan switcher. Either way the member
 * changes plan by Stripe changing the price on the subscription they already hold, prorated —
 * never by `/api/billing/checkout`, which would sell them a second subscription
 * (docs/STARTER_TIER_PLAN.md).
 */
export async function POST(request: Request): Promise<Response> {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account" }, { status: 400 });
  }

  const origin =
    request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const returnUrl = `${origin}/billing`;
  // Back from a plan change the webhook can still be in flight; `?changed=1` tells the page to
  // look again a moment later so the new plan shows without a manual reload.
  const changedUrl = `${returnUrl}?changed=1`;
  const stripe = getStripe();

  const body = (await request.json().catch(() => null)) as {
    flow?: unknown;
    priceId?: unknown;
  } | null;
  if (body?.flow === "subscription_update") {
    const sub = await prisma.subscription.findUnique({
      where: { userId: user.id },
      select: { stripeSubscriptionId: true, priceId: true },
    });
    if (sub?.stripeSubscriptionId) {
      const priceId = typeof body.priceId === "string" ? body.priceId : null;
      if (priceId) {
        if (!getPricePlans().some((p) => p.priceId === priceId)) {
          return NextResponse.json({ error: "Unknown price" }, { status: 400 });
        }
        if (priceId === sub.priceId) {
          return NextResponse.json({ error: "That's already your plan." }, { status: 400 });
        }
        try {
          const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
          // The confirm flow updates exactly one item; ours always have one.
          const item = live.items.data.length === 1 ? live.items.data[0] : null;
          if (item) {
            const session = await stripe.billingPortal.sessions.create({
              customer: user.stripeCustomerId,
              return_url: returnUrl,
              flow_data: {
                type: "subscription_update_confirm",
                subscription_update_confirm: {
                  subscription: sub.stripeSubscriptionId,
                  items: [{ id: item.id, price: priceId, quantity: 1 }],
                },
                after_completion: { type: "redirect", redirect: { return_url: changedUrl } },
              },
            });
            return NextResponse.json({ url: session.url });
          }
        } catch (error) {
          console.error(
            "[billing/portal] chosen-plan confirm flow refused — opening the plan switcher instead.",
            error,
          );
        }
      }
      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: user.stripeCustomerId,
          return_url: returnUrl,
          flow_data: {
            type: "subscription_update",
            subscription_update: { subscription: sub.stripeSubscriptionId },
            after_completion: { type: "redirect", redirect: { return_url: changedUrl } },
          },
        });
        return NextResponse.json({ url: session.url });
      } catch (error) {
        console.error(
          "[billing/portal] plan-switch flow refused — opening the portal home instead. " +
            "Check the portal configuration lists every product under subscription updates.",
          error,
        );
      }
    }
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    // A customer id Stripe does not know, or Stripe down. A message the button can show beats
    // a bare 500 — and the id is logged, because that is the one thing support will need.
    console.error(`[billing/portal] could not open the portal for ${user.stripeCustomerId}`, error);
    return NextResponse.json(
      { error: "Couldn't open the billing page just now. Try again in a minute." },
      { status: 502 },
    );
  }
}
