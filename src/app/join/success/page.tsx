import type { ReactNode } from "react";
import Link from "next/link";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import { EnterSignInCode } from "@/app/login/verify-request/EnterSignInCode";

export const metadata = { title: "Check your email" };

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
 */
export default async function JoinSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}): Promise<ReactNode> {
  const { session_id: sessionId } = await searchParams;

  // Best-effort: any failure here (bad id, Stripe down, key mismatch) degrades to the old
  // static page rather than erroring a customer who has JUST paid.
  let payerEmail: string | null = null;
  if (sessionId && stripeConfigured()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      if (session.status === "complete") {
        payerEmail = session.customer_details?.email?.trim().toLowerCase() ?? null;
      }
    } catch {
      /* fall through to the static copy */
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="page-title">Payment received — check your email</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We&rsquo;ve emailed a six-digit sign-in code
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

      {payerEmail ? (
        <EnterSignInCode email={payerEmail} callbackUrl="/" />
      ) : (
        /* Without the session we don't know their email, so the code box can't render here.
           Requesting from /login issues a FRESH code (deliberately invalidating the emailed
           one — issueSignInCode replaces per-address), so the copy must promise a new email
           rather than telling them to reuse the one they have. */
        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          with the same email and we&rsquo;ll send you a fresh code.
        </p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Nothing after a few minutes? Check your spam folder first. Still nothing — reply to your
        Stripe receipt email and we&rsquo;ll get you in.
      </p>
    </main>
  );
}
