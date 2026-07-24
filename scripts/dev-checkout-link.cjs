/**
 * dev-checkout-link.cjs — DEV/TEST ONLY.
 *
 * Mints a Stripe *test-mode* Checkout link for a given user so the subscribe
 * workflow can be exercised end-to-end without running `stripe listen`.
 *
 *   1. Finds the app user by email.
 *   2. Ensures they have a Stripe customer (creates + saves stripeCustomerId if missing).
 *   3. Creates a subscription Checkout Session for the Pro-monthly price.
 *   4. Prints the hosted Checkout URL.
 *
 * The webhook is bridged separately after payment (see dev-sync-subscription.cjs)
 * because no local webhook listener is running. Nothing here charges real money —
 * it uses whatever STRIPE_SECRET_KEY is in .env.local (a test key).
 */
const { PrismaClient } = require("@prisma/client");
const Stripe = require("stripe");

const EMAIL = process.env.CHECKOUT_EMAIL || "jordancaaruso@gmail.com";
const PRICE = process.env.STRIPE_PRICE_PRO_MONTHLY;
const KEY = process.env.STRIPE_SECRET_KEY;

(async () => {
  if (!KEY) throw new Error("STRIPE_SECRET_KEY missing from env");
  if (!PRICE) throw new Error("STRIPE_PRICE_PRO_MONTHLY missing from env");

  const prisma = new PrismaClient();
  const stripe = new Stripe(KEY);
  try {
    const user = await prisma.user.findFirst({
      where: { email: EMAIL },
      select: { id: true, email: true, stripeCustomerId: true },
    });
    if (!user) throw new Error(`No user found with email ${EMAIL}`);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? EMAIL,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: PRICE, quantity: 1 }],
      success_url: "http://localhost:3000/billing?checkout=success",
      cancel_url: "http://localhost:3000/billing?checkout=cancel",
    });

    console.log("USER_ID=" + user.id);
    console.log("CUSTOMER_ID=" + customerId);
    console.log("CHECKOUT_URL=" + session.url);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
