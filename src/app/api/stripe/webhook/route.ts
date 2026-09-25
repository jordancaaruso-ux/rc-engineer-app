export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe, stripeConfigured, resolveTierForPriceId } from "@/lib/stripe";
import { deriveSubscriptionSchedule, keepStoredSubscription } from "@/lib/stripeSubscriptionSync";
import { isActiveSubscriptionStatus } from "@/lib/entitlementLogic";
import {
  extractCheckoutEmail,
  isAppSignupSession,
  resolveCheckoutOwner,
} from "@/lib/billing/paidSignupLogic";
import { provisionPaidUser, sendPaidSignupSignInLink } from "@/lib/billing/paidSignup";
import { FOUNDING_OFFER } from "@/lib/billing/foundingOfferLogic";
import { foundingSeatPriceId, isFoundingSeatPrice } from "@/lib/billing/foundingOffer";
import { isSharedDemoAccount } from "@/lib/demo/demoAccess";
import { applyRunWindow } from "@/lib/runs/runWindow";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";

/**
 * Stripe webhook — the ONLY source of truth for entitlement. Public (server-to-server), verified
 * by signature; middleware lets `/api/stripe/webhook` through unauthenticated.
 *
 * Node runtime + raw body: signature verification needs the exact bytes, so never `request.json()`
 * before `constructEvent`. Idempotent: each `event.id` is claimed once; duplicate deliveries ack
 * without reprocessing, and a failed handler drops the claim so Stripe's retry can reprocess.
 */

type StoredPlan = { stripeSubscriptionId: string; status: string; priceId: string | null };

/** Plans Stripe is still trying to collect for: buying again on top of one would stack a second. */
const UNPAID_STATUSES = new Set(["past_due", "unpaid", "paused", "incomplete"]);

async function readStoredPlan(userId: string): Promise<StoredPlan | null> {
  return prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true, status: true, priceId: true },
  });
}

/** Is Stripe still billing (or trying to bill) for this stored plan? */
function planStillBilling(plan: StoredPlan | null): plan is StoredPlan {
  return Boolean(plan && (isActiveSubscriptionStatus(plan.status) || UNPAID_STATUSES.has(plan.status)));
}

/** Stripe refuses an update to a subscription that has already ended; that is nothing to stop. */
function isStripeInvalidRequest(error: unknown): boolean {
  return (error as { type?: string } | null)?.type === "StripeInvalidRequestError";
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return; // customer not linked to a user yet — nothing to sync
  // The shared demo account keeps its seeded plan; a real payment never lands on it.
  if (isSharedDemoAccount({ id: user.id, email: user.email })) return;

  const priceId = sub.items.data[0]?.price?.id ?? null;
  // One row per member, but events arrive for every subscription on their customer: a founding
  // seat, or a newer live plan, must not be overwritten by events about the plan it replaced.
  const stored = await readStoredPlan(user.id);
  if (
    keepStoredSubscription(stored, { id: sub.id, status: String(sub.status), priceId }, isFoundingSeatPrice)
  ) {
    return;
  }

  const tier = await resolveTierForPriceId(priceId);
  const { currentPeriodEnd, cancelAtPeriodEnd } = deriveSubscriptionSchedule(sub);

  const data = {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    status: String(sub.status),
    tier,
    priceId,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  };

  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  // The plan just changed hands, so the run window follows it: a new Starter member's older runs
  // hide, an upgrade brings every hidden run straight back (docs/STARTER_TIER_PLAN.md).
  const window = await applyRunWindow(user.id);
  if (window.hidden + window.revealed > 0) revalidateAfterRunMutation(user.id);
}

/**
 * Stop a plan that a new purchase replaced. A live one stops renewing and runs out on its own
 * (the member already paid for this period); one Stripe is still chasing for payment ends now.
 * Safe to repeat: an already-ended plan is left as it is.
 */
async function stopReplacedPlan(subscriptionId: string | null | undefined): Promise<void> {
  if (!subscriptionId) return;
  const stripe = getStripe();
  let old: Stripe.Subscription;
  try {
    old = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (isStripeInvalidRequest(error)) return;
    throw error;
  }
  const status = String(old.status);
  try {
    if (isActiveSubscriptionStatus(status)) {
      if (!old.cancel_at_period_end && old.cancel_at == null) {
        await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      }
    } else if (UNPAID_STATUSES.has(status)) {
      await stripe.subscriptions.cancel(subscriptionId);
    }
  } catch (error) {
    if (isStripeInvalidRequest(error)) return;
    throw error;
  }
}

/**
 * A plan checkout (subscription mode): the paid door and /billing's "Choose".
 *
 * Also the fix for a double charge found 2026-09-25: a member who was signed out and bought again
 * from /join got a second Stripe customer, the account was re-pointed at it, and the old plan
 * kept billing with nothing in the app pointing at it. Now the plan the account held is found
 * BEFORE the account moves, remembered on the new subscription (so a retried event still knows),
 * and stopped.
 */
async function syncFromPlanCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  // A checkout naming the demo account is a stranger's (see `resolveCheckoutOwner`).
  const { memberUserId: userId, publicSignup } = resolveCheckoutOwner(session, (id) =>
    isSharedDemoAccount({ id }),
  );

  // Read the plan the account holds before anything moves: once the customer link moves,
  // events for the new subscription can overwrite the row at any moment.
  const publicSignupEmail = publicSignup && customerId ? extractCheckoutEmail(session) : null;
  const existingUserId =
    userId ??
    (publicSignupEmail
      ? ((await prisma.user.findFirst({ where: { email: publicSignupEmail }, select: { id: true } }))
          ?.id ?? null)
      : null);
  const previous = existingUserId ? await readStoredPlan(existingUserId) : null;

  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (previous && isFoundingSeatPrice(previous.priceId) && isActiveSubscriptionStatus(previous.status)) {
    // A founder bought a plan they already hold for life (signed out, on another device). The
    // account stays on its seat: no re-pointing (the seat's own events must keep reaching it) and
    // no sync. The new plan stops renewing. The code email still goes, so they can get back in.
    await stopReplacedPlan(subId);
    if (publicSignupEmail && !isAppSignupSession(session)) {
      await sendPaidSignupSignInLink(publicSignupEmail);
    }
    return;
  }

  if (userId && customerId) {
    await prisma.user
      .update({ where: { id: userId }, data: { stripeCustomerId: customerId } })
      .catch(() => undefined);
  }

  // The paid door (MONETISATION_NORTH_STAR.md): a stranger paid via /join, so no user exists yet.
  // Provision BEFORE the subscription sync (syncSubscription finds users by customer id) and email
  // the sign-in link only AFTER the sync succeeds, so a sync failure retries without having sent.
  // Ordering within the handler is safe because a thrown error drops the event claim for retry,
  // and every step here is idempotent.
  if (publicSignupEmail && customerId) {
    await provisionPaidUser(publicSignupEmail, customerId);
  }

  if (subId) {
    const stripe = getStripe();
    let sub = await stripe.subscriptions.retrieve(subId);

    let replaces: string | null = sub.metadata?.replaces || null;
    if (!replaces && planStillBilling(previous) && previous.stripeSubscriptionId !== sub.id) {
      replaces = previous.stripeSubscriptionId;
      // Remembered on the new subscription, so a retry after a failure below still knows.
      sub = await stripe.subscriptions.update(sub.id, { metadata: { replaces } });
    }

    await syncSubscription(sub);
    await stopReplacedPlan(replaces);
  }

  // Someone who signed up in the app is already signed in there — the thank-you page sends them
  // back to it — so a code email would only confuse them.
  if (publicSignupEmail && !isAppSignupSession(session)) {
    await sendPaidSignupSignInLink(publicSignupEmail);
  }
}

/** The subscription that holds the seat bought in this checkout, if it has been made already. */
async function findSeatForCheckout(
  customerId: string,
  checkoutId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  return subs.data.find((s) => s.metadata?.founding_checkout === checkoutId) ?? null;
}

/**
 * A founding seat was paid for (docs/MONETISATION_NORTH_STAR.md, "Founding seats").
 *
 * The payment is a one-off; the seat is a $0 yearly subscription made here, which is what every
 * other surface reads. It remembers the checkout and the payment (so a retry reuses it and a
 * refund can find it) and the plan it replaced (so that plan stops renewing, and comes back if
 * the seat is refunded).
 */
async function fulfilFoundingSeat(session: Stripe.Checkout.Session): Promise<void> {
  // A bank debit still clearing arrives again as `checkout.session.async_payment_succeeded`.
  if (session.payment_status !== "paid") return;

  const seatPriceId = foundingSeatPriceId();
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  // Money was taken: fail loudly so Stripe retries and the dashboard shows a failing webhook,
  // rather than a founder silently left without a seat.
  if (!seatPriceId) throw new Error("Founding seat paid, but STRIPE_PRICE_FOUNDING_SEAT is not set");
  if (!customerId) throw new Error(`Founding checkout ${session.id} has no Stripe customer`);

  const { memberUserId, publicSignup } = resolveCheckoutOwner(session, (id) =>
    isSharedDemoAccount({ id }),
  );
  const signupEmail = !memberUserId && publicSignup ? extractCheckoutEmail(session) : null;
  if (!memberUserId && !signupEmail) {
    throw new Error(`Founding checkout ${session.id} names no account and no email`);
  }

  // The plan the account holds, read before the customer link moves (as for a plan checkout).
  const existingUserId =
    memberUserId ??
    ((await prisma.user.findFirst({ where: { email: signupEmail! }, select: { id: true } }))?.id ??
      null);
  const previous = existingUserId ? await readStoredPlan(existingUserId) : null;

  const stripe = getStripe();
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  let seat = await findSeatForCheckout(customerId, session.id);
  if (!seat && previous && isFoundingSeatPrice(previous.priceId) && isActiveSubscriptionStatus(previous.status)) {
    // Bought a second seat (signed out on another device, say). Never sell the same thing twice:
    // refund this payment in full and leave the seat they hold alone. This happens BEFORE the
    // account's customer link moves: re-pointed at this checkout's new customer, the account would
    // stop hearing about its own seat, so its yearly renewal would never land and access would
    // lapse a year later.
    if (paymentIntentId) {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId, metadata: { reason: "already a founding member" } },
        { idempotencyKey: `founding-second-seat-${session.id}` },
      );
    }
    return;
  }

  if (memberUserId) {
    await prisma.user
      .update({ where: { id: memberUserId }, data: { stripeCustomerId: customerId } })
      .catch(() => undefined);
  } else if (signupEmail) {
    await provisionPaidUser(signupEmail, customerId);
  }

  if (!seat) {
    const replaces =
      planStillBilling(previous) && !isFoundingSeatPrice(previous.priceId)
        ? previous.stripeSubscriptionId
        : "";
    seat = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: seatPriceId }],
        description: "Founding member: Race Engineer for the life of the app",
        metadata: {
          offer: FOUNDING_OFFER,
          founding_checkout: session.id,
          founding_payment_intent: paymentIntentId ?? "",
          batch: session.metadata?.batch ?? "",
          paid_cents: session.amount_total != null ? String(session.amount_total) : "",
          replaces,
        },
      },
      { idempotencyKey: `founding-seat-${session.id}` },
    );
  }

  await syncSubscription(seat);
  await stopReplacedPlan(seat.metadata?.replaces || null);

  if (signupEmail && !isAppSignupSession(session)) {
    await sendPaidSignupSignInLink(signupEmail);
  }
}

/**
 * A full refund of a founding payment ends the seat, and the seat goes back on sale (the count
 * reads live seats). A partial refund, a goodwill credit, keeps it. If the seat had replaced a
 * plan that has not run out yet, that plan renews again and the account points back at it, so a
 * refunded founder is left exactly where they started.
 */
async function endSeatOnRefund(charge: Stripe.Charge): Promise<void> {
  if (!charge.refunded) return;
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const customerId =
    typeof charge.customer === "string" ? charge.customer : charge.customer?.id ?? null;
  if (!paymentIntentId || !customerId) return;

  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  const seat = subs.data.find(
    (s) => s.metadata?.offer === FOUNDING_OFFER && s.metadata?.founding_payment_intent === paymentIntentId,
  );
  if (!seat) return;

  const ended = seat.status === "canceled" ? seat : await stripe.subscriptions.cancel(seat.id);
  await syncSubscription(ended);

  const replaced = seat.metadata?.replaces || null;
  if (!replaced) return;
  let old: Stripe.Subscription;
  try {
    old = await stripe.subscriptions.retrieve(replaced);
  } catch (error) {
    if (isStripeInvalidRequest(error)) return;
    throw error;
  }
  if (!isActiveSubscriptionStatus(String(old.status))) return;
  const resumed = old.cancel_at_period_end
    ? await stripe.subscriptions.update(replaced, { cancel_at_period_end: false })
    : old;
  const oldCustomerId = typeof resumed.customer === "string" ? resumed.customer : resumed.customer.id;
  if (oldCustomerId !== customerId) {
    // A seat bought signed out moved the account to a new Stripe customer; move it back.
    const owner = await prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
    if (owner) {
      await prisma.user.update({ where: { id: owner.id }, data: { stripeCustomerId: oldCustomerId } });
    }
  }
  await syncSubscription(resumed);
}

function isFoundingSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.offer === FOUNDING_OFFER;
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (isFoundingSession(session)) await fulfilFoundingSeat(session);
      else await syncFromPlanCheckout(session);
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      // Only a founding seat waits for a slow payment; a plan checkout is handled on completion.
      const session = event.data.object as Stripe.Checkout.Session;
      if (isFoundingSession(session)) await fulfilFoundingSeat(session);
      break;
    }
    case "charge.refunded":
      await endSeatOnRefund(event.data.object as Stripe.Charge);
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
