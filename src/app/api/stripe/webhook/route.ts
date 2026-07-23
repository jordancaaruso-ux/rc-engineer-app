export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe, stripeConfigured, tierForPriceId } from "@/lib/stripe";

/**
 * Stripe webhook — the ONLY source of truth for entitlement. Public (server-to-server), verified
 * by signature; middleware lets `/api/stripe/webhook` through unauthenticated.
 *
 * Node runtime + raw body: signature verification needs the exact bytes, so never `request.json()`
 * before `constructEvent`. Idempotent: each `event.id` is claimed once; duplicate deliveries ack
 * without reprocessing, and a failed handler drops the claim so Stripe's retry can reprocess.
 */

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return; // customer not linked to a user yet — nothing to sync

  const priceId = sub.items.data[0]?.price?.id ?? null;
  const tier = tierForPriceId(priceId);
  // `current_period_end` lives on the subscription in older API versions and on the item in newer
  // ones — read defensively so this survives an account's API version.
  const periodEndUnix =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)
      ?.current_period_end ??
    null;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

  const data = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    status: String(sub.status),
    tier,
    priceId,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };

  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
}

async function syncFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const userId = session.client_reference_id;
  if (userId && customerId) {
    await prisma.user
      .update({ where: { id: userId }, data: { stripeCustomerId: customerId } })
      .catch(() => undefined);
  }
  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
  if (!subId) return;
  await syncSubscription(await getStripe().subscriptions.retrieve(subId));
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await syncFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subField = (invoice as unknown as { subscription?: string | { id: string } | null })
        .subscription;
      const subId = typeof subField === "string" ? subField : subField?.id ?? null;
      if (subId) await syncSubscription(await getStripe().subscriptions.retrieve(subId));
      break;
    }
    default:
      break;
  }
}

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured() || !webhookSecret) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Claim the event id first; a duplicate delivery hits the unique PK → ack without reprocessing.
  try {
    await prisma.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Drop the claim so Stripe's retry can reprocess this event.
    await prisma.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Webhook handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
