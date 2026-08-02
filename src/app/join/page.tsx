import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import { JoinPlansClient, type JoinPlan } from "@/components/billing/JoinPlansClient";

export const metadata = { title: "Join JRC Dynamics App" };

/**
 * The paid door's decision page (rebuilt 2026-08-02 to the decision-board picks): back link,
 * one Standard-vs-Pro comparison table, monthly/annual toggle. The landing (/welcome) does the
 * selling; this page closes it. Public via middleware; checkout unchanged.
 *
 * Signed-in users are sent to /billing — their checkout runs authenticated so it attaches to
 * their existing Stripe customer instead of minting a duplicate.
 */
export default async function JoinPage(): Promise<ReactNode> {
  const session = await auth();
  if (session?.user) redirect("/billing");

  const demoReady = Boolean(process.env.DEMO_USER_ID);

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
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4">
        <PageBackLink href="/welcome" />
      </div>
      <h1 className="page-title">Choose your plan</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick a plan — you&rsquo;ll get a sign-in link by email as soon as payment goes through.
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
      {demoReady ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Not ready?{" "}
          <Link
            href="/demo"
            prefetch={false}
            className="text-accent underline-offset-2 hover:underline"
          >
            Try the live demo
          </Link>{" "}
          — a real driver&rsquo;s 6 months of data, read-only.
        </p>
      ) : null}
    </main>
  );
}
