import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import { JoinPlansClient, type JoinPlan } from "@/components/billing/JoinPlansClient";

export const metadata = { title: "Join JRC Engineer" };

/**
 * The paid door (MONETISATION_NORTH_STAR.md, Phase 1): the PUBLIC pricing page — payment is the
 * only way into the app, and this is where a stranger pays. Middleware lets /join through
 * unauthenticated. The Phase 4 landing page will sit in front of this; until then this page is
 * the front door itself.
 *
 * Signed-in users are sent to /billing — their checkout runs authenticated so it attaches to
 * their existing Stripe customer instead of minting a duplicate.
 */
export default async function JoinPage(): Promise<ReactNode> {
  const session = await auth();
  if (session?.user) redirect("/billing");

  const plans = await getPricePlansWithAmounts();
  const joinPlans: JoinPlan[] = plans
    .filter((p): p is typeof p & { tier: "standard" | "pro" } => p.tier !== "none")
    .map((p) => ({
      tier: p.tier,
      interval: p.interval,
      priceId: p.priceId,
      amount:
        p.unitAmount != null && p.currency
          ? new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: p.currency.toUpperCase(),
            }).format(p.unitAmount / 100)
          : null,
    }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="page-title">Join JRC Engineer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Log every run in seconds, analyze your performance, and ask the Engineer. Pick a plan —
        you&rsquo;ll get a sign-in link by email as soon as payment goes through.
      </p>
      <div className="mt-6">
        {joinPlans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sign-ups aren&rsquo;t open just yet. Check back soon.
          </p>
        ) : (
          <JoinPlansClient plans={joinPlans} />
        )}
      </div>
    </main>
  );
}
