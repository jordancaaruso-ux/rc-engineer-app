import type { ReactNode } from "react";
import Link from "next/link";
import { DoorScene } from "@/components/brand/DoorScene";
import { getPricePlansWithAmounts, getStripe, stripeConfigured } from "@/lib/stripe";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import {
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
} from "@/lib/aiUsage/budgets";
import { EnterSignInCode } from "@/app/login/verify-request/EnterSignInCode";

export const metadata = { title: "Check your email" };

/** What the customer just bought, resolved from the Stripe session — best-effort. */
type PaidPlan = {
  label: string;
  amount: string | null;
  interval: "month" | "year";
  questions: string;
};

/**
 * Post-payment landing (public). Stripe redirects here with `?session_id=` (its own template,
 * filled at redirect time), which is looked up server-side for the payer's email so the sign-in
 * code box can sit right on this page. Without it, a payer whose email said "here's your code"
 * landed on a page with nowhere to type it — their only move was a detour through /login, which
 * mints a SECOND code and silently kills the one already in their inbox.
 *
 * The webhook that sends that email is async, so the copy promises minutes, not instantly —
 * "paid but no email" is the known support case (MONETISATION_NORTH_STAR.md, hazards). The code
 * box tolerates the race by construction: it does nothing until the driver types what the email
 * told them, and by then the webhook that sent it has necessarily run.
 *
 * Restyled onto the door scene 2026-08-15, and the session lookup now also expands line items so
 * the page can repeat WHAT was bought — the two things a fresh customer wants confirmed are
 * "payment worked" and "this is what I'm on", and until now it confirmed neither by name.
 */
export default async function JoinSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}): Promise<ReactNode> {
  const { session_id: sessionId } = await searchParams;

  // Best-effort: any failure here (bad id, Stripe down, key mismatch) degrades to the generic
  // copy rather than erroring a customer who has JUST paid.
  let payerEmail: string | null = null;
  let paidPlan: PaidPlan | null = null;
  if (sessionId && stripeConfigured()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId, {
        expand: ["line_items"],
      });
      if (session.status === "complete") {
        payerEmail = session.customer_details?.email?.trim().toLowerCase() ?? null;

        const priceId = session.line_items?.data[0]?.price?.id ?? null;
        if (priceId) {
          const plan = (await getPricePlansWithAmounts()).find((p) => p.priceId === priceId);
          if (plan && plan.tier !== "none") {
            paidPlan = {
              label: TIER_LABELS[plan.tier],
              amount:
                plan.unitAmount != null && plan.currency
                  ? new Intl.NumberFormat("en-AU", {
                      style: "currency",
                      currency: plan.currency.toUpperCase(),
                    }).format(plan.unitAmount / 100)
                  : null,
              interval: plan.interval,
              questions:
                plan.tier === "pro"
                  ? `${PRO_ENGINEER_MONTHLY_QUESTIONS} a month`
                  : `${STANDARD_ENGINEER_DAILY_QUESTIONS} a day`,
            };
          }
        }
      }
    } catch {
      /* fall through to the generic copy */
    }
  }

  return (
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      <DoorScene variant="focus" />

      <div className="relative z-10 w-full max-w-[400px]">
        <div
          className="mx-auto grid size-12 place-items-center rounded-full border border-primary/50 bg-primary/10 text-lg text-primary-ink"
          aria-hidden="true"
        >
          ✓
        </div>

        <div className="door-sheet login-sheen mt-6 p-6">
          <h1 className="page-title text-center">You&rsquo;re on the grid</h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
            Payment went through. We&rsquo;ve emailed a six-digit sign-in code
            {payerEmail ? (
              <>
                {" "}
                to <span className="text-foreground">{payerEmail}</span>
              </>
            ) : (
              <> to the address you used at checkout</>
            )}
            . It usually arrives within a minute or two.
          </p>

          {paidPlan ? (
            <dl className="mt-4 flex flex-col gap-1.5 rounded-xl border border-elevate/10 bg-black/30 p-3.5 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Plan</dt>
                <dd className="font-semibold text-foreground">{paidPlan.label}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Billed</dt>
                <dd className="fig-stat font-semibold text-foreground">
                  {paidPlan.amount ?? "—"} / {paidPlan.interval}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Engineer questions</dt>
                <dd className="fig-stat font-semibold text-primary-ink">{paidPlan.questions}</dd>
              </div>
            </dl>
          ) : null}

          {payerEmail ? (
            <EnterSignInCode email={payerEmail} callbackUrl="/" />
          ) : (
            /* Without the session we don't know their email, so the code box can't render here.
               Requesting from /login issues a FRESH code (deliberately invalidating the emailed
               one — issueSignInCode replaces per-address), so the copy must promise a new email
               rather than telling them to reuse the one they have. */
            <p className="mt-5 text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              with the same email and we&rsquo;ll send you a fresh code.
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          Nothing after a few minutes? Check your spam folder first. Still nothing — reply to your
          Stripe receipt email and we&rsquo;ll get you in.
        </p>
      </div>
    </div>
  );
}
