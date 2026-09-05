import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { DoorScene } from "@/components/brand/DoorScene";
import { JrcMark } from "@/components/brand/JrcMark";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { JoinPlansClient, type JoinPlan } from "@/components/billing/JoinPlansClient";

export const metadata = { title: `Join ${PRODUCT_NAME}` };

/**
 * The paid door's decision page. Rebuilt 2026-08-02 to the decision-board picks (one table,
 * monthly/annual toggle); redesigned 2026-08-15 onto the signed-out family's shared scene —
 * the baked drivers-meeting photo with the login telemetry running over it (`DoorScene`),
 * a Sora 700 headline (Space Grotesk until 2026-09-05), frosted plan cards. Desktop shows two cards side by side; under
 * `md:` they fold into two selectable rows and a single checkout button (the fold lives in
 * `JoinPlansClient`). Public via middleware; checkout unchanged.
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
      <div className="door-dark relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background px-5 py-12">
        <DoorScene variant="focus" />
        <div className="relative z-10 w-full max-w-[420px]">
          <div className="flex justify-center">
            <JrcMark variant="yellow" priority className="h-10" />
          </div>
          <div className="door-sheet login-sheen mt-8 p-6">
            <h1 className="page-title text-center">You&rsquo;re already signed in</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
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
            <div className="mt-5 flex flex-col gap-2.5">
              <Link href="/" className={buttonLinkClassName("primary", "w-full px-4 py-3")}>
                Open {PRODUCT_NAME}
              </Link>
              <Link href="/billing" className={buttonLinkClassName("outline", "w-full px-4 py-3")}>
                Plan &amp; billing
              </Link>
            </div>
          </div>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Not you?{" "}
            {/* prefetch={false} is load-bearing: this route signs you out on GET, and the router
                would otherwise fire it just for scrolling the link into view. */}
            <Link
              href="/api/auth/logout"
              prefetch={false}
              className="text-primary-ink underline-offset-2 hover:underline"
            >
              Sign out
            </Link>{" "}
            to use a different account.
          </p>
        </div>
      </div>
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
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-col bg-background">
      <DoorScene variant="join" />

      <div className="relative z-10 mx-auto flex w-full max-w-[920px] flex-1 flex-col px-5 pb-10 md:items-center">
        {/* Top row — the way back, and whose door this is. */}
        <div className="flex w-full items-center justify-between pt-4 md:pt-5">
          <PageBackLink href="/welcome" />
          <JrcMark variant="yellow" priority className="h-6" />
          <span className="w-9" aria-hidden="true" />
        </div>

        {/* justify-center: on a tall viewport the block sits balanced in the scene instead of
            hanging off the header; when content outgrows it (annual + open compare table) the
            column simply scrolls. */}
        <div className="flex w-full flex-1 flex-col justify-center gap-5 py-7 md:items-center md:gap-6 md:py-10 md:text-center">
          {/* What happens next, in order — this page, Stripe, the code in your inbox. */}
          <ol
            aria-label="What happens next"
            className="micro-caps flex items-center gap-2.5 text-faint"
          >
            <li className="text-primary-ink">Plan</li>
            <li aria-hidden="true" className="h-px w-3.5 bg-border" />
            <li>Payment</li>
            <li aria-hidden="true" className="h-px w-3.5 bg-border" />
            <li>Your garage</li>
          </ol>

          <h1 className="door-headline max-w-[17ch]">
            The notebook, <span className="text-primary-ink">or the race engineer.</span>
          </h1>

          {/* Cut on the phone (the fold's whole point is fewer paragraphs before the button):
              the headline and the two row hooks carry it there. */}
          <p className="hidden max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground md:block">
            Both keep every run, every setup and every lap time. What changes is how often you can
            ask the Engineer, and whether the heavy tools come with it.
          </p>

          {joinPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sign-ups aren&rsquo;t open just yet. Check back soon.
            </p>
          ) : (
            <JoinPlansClient plans={joinPlans} />
          )}

          <div className="flex flex-col gap-2 pt-1 text-center md:max-w-[64ch]">
            <p className="text-[12px] leading-relaxed text-faint">
              Full refund in the first 14&nbsp;days, no questions. Promo codes go in at checkout. A
              sign-in code arrives by email the moment payment goes through.
            </p>
            {/* The escape hatch for an existing member whose session lapsed — outside the plans
                conditional on purpose: when sign-ups are closed, signing in is the ONLY thing
                this page can still offer them. */}
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
                Sign in
              </Link>
              {demoReady ? (
                <>
                  {" "}
                  · Not ready?{" "}
                  <Link
                    href="/demo"
                    prefetch={false}
                    className="text-primary-ink underline-offset-2 hover:underline"
                  >
                    Try the live demo
                  </Link>{" "}
                  — a real driver&rsquo;s 6&nbsp;months of data, read-only.
                </>
              ) : (
                <>.</>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
