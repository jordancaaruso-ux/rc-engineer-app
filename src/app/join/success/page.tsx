import type { ReactNode } from "react";

export const metadata = { title: "Check your email" };

/**
 * Post-payment landing (public). By the time Stripe redirects here the webhook has usually
 * already provisioned the account and sent the sign-in link — but webhook delivery is async, so
 * the copy promises "a few minutes", not "instantly". "Paid but no email" is the known support
 * case (MONETISATION_NORTH_STAR.md, hazards).
 */
export default function JoinSuccessPage(): ReactNode {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="page-title">Payment received — check your email</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your sign-in link is on its way to the email address you used at checkout. It usually
        arrives within a minute or two.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Nothing after a few minutes? Check your spam folder first. Still nothing — reply to your
        Stripe receipt email and we&rsquo;ll get you in.
      </p>
    </main>
  );
}
