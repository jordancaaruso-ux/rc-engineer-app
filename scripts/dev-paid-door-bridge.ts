/**
 * dev-paid-door-bridge.ts — DEV/TEST ONLY. Stands in for Stripe webhook delivery so the paid
 * door (docs/MONETISATION_NORTH_STAR.md) is testable locally with NO Stripe CLI and no inbox.
 *
 *   Terminal A:  npm run dev
 *   Terminal B:  npm run paydoor:bridge
 *   Browser:     localhost:3000 (incognito) → Get started → pay (4242… or code JRC-TESTER)
 *
 * It polls test-mode Stripe for newly COMPLETED checkout sessions and POSTs each to the local
 * `/api/stripe/webhook` as a properly SIGNED `checkout.session.completed` — the same bytes-and-
 * signature path production takes, so provisioning, subscription sync and the sign-in email all
 * run for real. For public signups it then prints a ready magic link here (the server prints its
 * own in Terminal A too; either works — tokens are additive and single-use).
 *
 * Both sides sign with STRIPE_WEBHOOK_SECRET from .env.local — any `whsec_local…` value works,
 * it just has to be the same for the dev server and this bridge. If you switch to
 * `stripe listen`, use ITS printed secret in both places instead.
 *
 * Event ids are stable per session (`evt_bridge_<id>`), so the webhook's idempotency ledger acks
 * repeats as duplicates — safe to restart the bridge freely.
 */
import { createHash, randomBytes } from "node:crypto";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

const BASE = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");
const key = process.env.STRIPE_SECRET_KEY;
const whsec = process.env.STRIPE_WEBHOOK_SECRET;

if (!key?.startsWith("sk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY must be a TEST key (sk_test_...).");
  process.exit(1);
}
if (!whsec) {
  console.error(
    "STRIPE_WEBHOOK_SECRET is not set. Put any shared value (e.g. whsec_local_dev_bridge) in .env.local,\n" +
      "then restart BOTH `npm run dev` and this bridge so they sign/verify with the same secret.",
  );
  process.exit(1);
}
const stripe = new Stripe(key);

/** Same scheme as scripts/dev-fresh-onboarding.ts — see there if @auth/core ever changes it. */
async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email });
  return `${BASE}/api/auth/callback/nodemailer?${params}`;
}

async function deliver(session: Stripe.Checkout.Session): Promise<void> {
  const payload = JSON.stringify({
    id: `evt_bridge_${session.id}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: whsec! });
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  const body = (await res.json().catch(() => ({}))) as { duplicate?: boolean };
  const email = session.customer_details?.email ?? "?";
  if (!res.ok) {
    console.error(`  ✗ webhook ${res.status} for ${session.id} (${email}) — will retry next poll`);
    throw new Error("delivery failed");
  }
  if (body.duplicate) {
    console.log(`  · ${session.id} (${email}) already processed`);
    return;
  }
  console.log(`  ✓ delivered ${session.id} — ${email}, total ${session.amount_total ?? "?"}c`);
  if (session.metadata?.source === "public-signup" && session.customer_details?.email) {
    const url = await mintSignInUrl(session.customer_details.email.trim().toLowerCase());
    console.log(`\n  Sign-in link for ${session.customer_details.email} (single-use, 24h):\n  ${url}\n`);
  }
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`Bridge up — watching test-mode checkouts → ${BASE}/api/stripe/webhook`);
  console.log(`Database: ${dbHost}`);
  console.log(`Pay in the browser; completed sessions land here within ~5s. Ctrl+C to stop.\n`);

  const startedAt = Math.floor(Date.now() / 1000) - 120; // pick up a payment made just before start
  const handled = new Set<string>();

  for (;;) {
    try {
      const sessions = await stripe.checkout.sessions.list({ limit: 10 });
      for (const s of sessions.data) {
        if (handled.has(s.id) || s.created < startedAt || s.status !== "complete") continue;
        try {
          await deliver(s);
          handled.add(s.id);
        } catch {
          // left out of `handled` → retried on the next poll
        }
      }
    } catch (err) {
      console.error(`  poll error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
