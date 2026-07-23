-- Paywall foundation (v1). Additive + nullable — safe under `prisma migrate deploy`, no backfill.
-- Existing users are unaffected: nothing in a normal request path reads these until entitlement is
-- wired into routes (a later, deliberate step).
--
-- 1. "User"."stripeCustomerId" — 1:1 link to the Stripe customer.
-- 2. "Subscription" — one row per user; the Stripe webhook is the source of truth. `tier` is our
--    internal label ("standard" | "pro"), mapped from the Stripe price.
-- 3. "StripeWebhookEvent" — processed event ids, so retried/replayed webhooks are idempotent.

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "priceId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);
