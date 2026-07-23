import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Open the Stripe Billing Portal — the whole manage / cancel / update-card / switch-tier surface,
 * so we don't hand-build any of it. Auth required; user must already have a Stripe customer.
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

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${origin}/billing`,
  });

  return NextResponse.json({ url: session.url });
}
