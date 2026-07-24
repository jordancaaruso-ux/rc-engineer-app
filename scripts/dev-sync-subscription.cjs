/**
 * dev-sync-subscription.cjs — DEV/TEST ONLY.
 *
 * Stands in for the Stripe webhook when testing locally (no `stripe listen`).
 * After a Checkout payment completes, this reads the user's live subscription
 * straight from Stripe and writes/updates the local `Subscription` row — exactly
 * what `customer.subscription.created|updated` would do in production.
 *
 * Run it after paying via the link from dev-checkout-link.cjs.
 */
const { PrismaClient } = require("@prisma/client");
const Stripe = require("stripe");

const EMAIL = process.env.CHECKOUT_EMAIL || "jordancaaruso@gmail.com";
const KEY = process.env.STRIPE_SECRET_KEY;

const TIER_BY_PRICE = {
  [process.env.STRIPE_PRICE_STANDARD_MONTHLY]: "standard",
  [process.env.STRIPE_PRICE_STANDARD_ANNUAL]: "standard",
  [process.env.STRIPE_PRICE_PRO_MONTHLY]: "pro",
  [process.env.STRIPE_PRICE_PRO_ANNUAL]: "pro",
};

// Canonical mapping lives in src/lib/stripeSubscriptionSync.ts (deriveSubscriptionSchedule).
// This throwaway helper can't import TS at runtime, so it mirrors that logic — keep in sync.
// A pending cancel is either the classic `cancel_at_period_end` flag OR a fixed `cancel_at`
// timestamp (flexible billing / portal).
function mapCancellation(sub) {
  const periodEndUnix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const cancelAtUnix = sub.cancel_at ?? null;
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end) || cancelAtUnix !== null;
  const endUnix = cancelAtUnix ?? periodEndUnix;
  return {
    currentPeriodEnd: endUnix ? new Date(endUnix * 1000) : null,
    cancelAtPeriodEnd,
  };
}

(async () => {
  if (!KEY) throw new Error("STRIPE_SECRET_KEY missing from env");

  const prisma = new PrismaClient();
  const stripe = new Stripe(KEY);
  try {
    const user = await prisma.user.findFirst({
      where: { email: EMAIL },
      select: { id: true, stripeCustomerId: true },
    });
    if (!user) throw new Error(`No user found with email ${EMAIL}`);
    if (!user.stripeCustomerId)
      throw new Error("User has no stripeCustomerId — run dev-checkout-link.cjs first");

    const list = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 10,
    });
    if (!list.data.length)
      throw new Error("No subscriptions for this customer yet — did the payment finish?");

    // Prefer a live sub; otherwise the most recent of any status.
    const live = list.data.filter((s) => s.status === "active" || s.status === "trialing");
    const sub = (live.length ? live : list.data).sort((a, b) => b.created - a.created)[0];

    const priceId = sub.items.data[0]?.price?.id ?? null;
    const tier = (priceId && TIER_BY_PRICE[priceId]) || "pro";

    const data = {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: user.stripeCustomerId,
      status: sub.status,
      tier,
      priceId,
      ...mapCancellation(sub),
    };

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });

    console.log("SUBSCRIPTION_SYNCED");
    console.log(JSON.stringify({ userId: user.id, ...data }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
