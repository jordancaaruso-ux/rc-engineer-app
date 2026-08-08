import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { JoinPlansClient, type JoinPlan } from "@/components/billing/JoinPlansClient";

export const metadata = { title: `Join ${PRODUCT_NAME}` };

/**
 * The paid door's decision page (rebuilt 2026-08-02 to the decision-board picks): back link,
 * one Standard-vs-Pro comparison table, monthly/annual toggle. The landing (/welcome) does the
 * selling; this page closes it. Public via middleware; checkout unchanged.
 *
 * Every "Get started" on the landing lands here, and until 2026-08-07 this page had nothing to
 * say to a visitor who already had an account — in EITHER direction (founder report):
 *   - Signed in: silently redirected to /billing, so the click produced a page headed
 *     "Subscription" that never mentioned the button pressed or the account already held.
 *   - Signed out: the plan table and two checkout buttons, with no "already have an account?"
 *     anywhere. An existing member whose session had lapsed was offered only "pay again";
 *     the site's one Sign in link sits in the landing footer, a full page-length away.
 * Both are answered below. The signed-in door stays SHUT on the public checkout either way —
 * that path mints a second Stripe customer instead of reusing theirs, which is why the bounce
 * existed — it just says so now, and points at both ways on.
 */
export default async function JoinPage(): Promise<ReactNode> {
  const session = await auth();
  const viewer = session?.user ?? null;

  // The demo account is a shared read-only session handed to strangers, so a demo visitor
  // clicking "Get started" IS the conversion this page exists for — never tell them they are
  // already signed in. Middleware lets their checkout through for the same reason.
  const memberViewer =
    viewer && !(viewer.isDemo === true || isDemoIdentity({ id: viewer.id, email: viewer.email }))
      ? viewer
      : null;

  if (memberViewer) {
    const who = memberViewer.email ?? memberViewer.name ?? null;
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4">
          <PageBackLink href="/welcome" />
        </div>
        <h1 className="page-title">You&rsquo;re already signed in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {who ? (
            <>
              You&rsquo;re signed in as <span className="text-foreground">{who}</span>, so
              there&rsquo;s no need to sign up again.
            </>
          ) : (
            <>You already have an account, so there&rsquo;s no need to sign up again.</>
          )}{" "}
          Pick up where you left off, or change your plan.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className={buttonLinkClassName("primary")}>
            Open {PRODUCT_NAME}
          </Link>
          <Link href="/billing" className={buttonLinkClassName("outline")}>
            Plan &amp; billing
          </Link>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          Not you?{" "}
          {/* prefetch={false} is load-bearing: this route signs you out on GET, and the router
              would otherwise fire it just for scrolling the link into view. */}
          <Link
            href="/api/auth/logout"
            prefetch={false}
            className="text-accent underline-offset-2 hover:underline"
          >
            Sign out
          </Link>{" "}
          to use a different account.
        </p>
      </main>
    );
  }

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
      {/* The escape hatch for an existing member whose session lapsed — outside the plans
          conditional on purpose: when sign-ups are closed, signing in is the ONLY thing this
          page can still offer them. */}
      <p className="mt-5 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-accent underline-offset-2 hover:underline">
          Sign in
        </Link>
        .
      </p>
      {demoReady ? (
        <p className="mt-2 text-sm text-muted-foreground">
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
