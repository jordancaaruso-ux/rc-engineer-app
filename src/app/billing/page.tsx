import { requireCurrentUserAllowUnpaid } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { getPricePlans } from "@/lib/stripe";
import { BillingClient, type BillingPlan } from "@/components/billing/BillingClient";

export const metadata = { title: "Subscription" };

const TIER_LABEL: Record<string, string> = { standard: "Standard", pro: "Pro" };

/**
 * Billing / plan picker. Uses `requireCurrentUserAllowUnpaid` — `requireCurrentUser` now
 * bounces unpaid users HERE (the shell gate), so this page must stay reachable without a
 * subscription or the redirect would loop.
 */
export default async function BillingPage() {
  const user = await requireCurrentUserAllowUnpaid();
  const entitlement = await getEntitlement(user);
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  const subscription = sub
    ? {
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }
    : null;
  const plans: BillingPlan[] = getPricePlans().map((p) => ({
    tier: p.tier,
    interval: p.interval,
    priceId: p.priceId,
    label: `${TIER_LABEL[p.tier] ?? p.tier} · ${p.interval === "year" ? "Annual" : "Monthly"}`,
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-semibold">Subscription</h1>
      <BillingClient
        plans={plans}
        entitled={entitlement.entitled}
        tier={entitlement.tier}
        grandfathered={entitlement.grandfathered}
        hasCustomer={Boolean(user.stripeCustomerId)}
        enforced={isBillingEnforced()}
        subscription={subscription}
      />
    </main>
  );
}
