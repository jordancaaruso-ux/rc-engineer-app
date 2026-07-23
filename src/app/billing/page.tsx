import { requireCurrentUser } from "@/lib/currentUser";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { getPricePlans } from "@/lib/stripe";
import { BillingClient, type BillingPlan } from "@/components/billing/BillingClient";

export const metadata = { title: "Subscription" };

const TIER_LABEL: Record<string, string> = { standard: "Standard", pro: "Pro" };

/**
 * Billing / plan picker. Uses `requireCurrentUser` (NOT `requireEntitledUser`) so an
 * authenticated-but-unpaid user can always reach it — this is where the paywall sends them.
 */
export default async function BillingPage() {
  const user = await requireCurrentUser();
  const entitlement = await getEntitlement(user);
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
      />
    </main>
  );
}
