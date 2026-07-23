import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { getPricePlans, getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Create a Stripe Checkout Session for a subscription. Auth required; the price must be one we
 * configured (never trust a client-supplied arbitrary price id). Entitlement is granted only later,
 * by the webhook — this route just starts checkout.
 */
export async function POST(request: Request): Promise<Response> {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { priceId?: string } | null;
  const priceId = body?.priceId;
  if (!priceId) return NextResponse.json({ error: "priceId is required" }, { status: 400 });
  if (!getPricePlans().some((p) => p.priceId === priceId)) {
    return NextResponse.json({ error: "Unknown price" }, { status: 400 });
  }

  const stripe = getStripe();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const origin =
    request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?status=success`,
    cancel_url: `${origin}/billing?status=cancel`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}
