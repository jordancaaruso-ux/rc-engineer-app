import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Open the Stripe Billing Portal — the whole manage / cancel / update-card / switch-tier surface,
 * so we don't hand-build any of it. Auth required; user must already have a Stripe customer.
 *
 * `{ flow: "subscription_update" }` in the body opens the portal straight on the plan switcher
 * for the member's live subscription (docs/STARTER_TIER_PLAN.md): a Starter or Notebook member
 * upgrades by Stripe changing the price on the subscription they already hold, prorated — never
 * by `/api/billing/checkout`, which would sell them a second subscription. The flow needs the
 * portal configuration to list every product under subscription updates (the Stripe setup
 * scripts do that); if Stripe refuses it, the plain portal opens instead and the refusal is
 * logged, so a member can still manage while the gap gets fixed.
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
  const stripe = getStripe();

  const body = (await request.json().catch(() => null)) as { flow?: unknown } | null;
  if (body?.flow === "subscription_update") {
    const sub = await prisma.subscription.findUnique({
      where: { userId: user.id },
      select: { stripeSubscriptionId: true },
    });
    if (sub?.stripeSubscriptionId) {
      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: user.stripeCustomerId,
          return_url: returnUrl,
          flow_data: {
            type: "subscription_update",
            subscription_update: { subscription: sub.stripeSubscriptionId },
            after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
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
