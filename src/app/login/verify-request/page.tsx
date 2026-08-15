import type { ReactNode } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { VerifyRequestAutoAdvance } from "./VerifyRequestAutoAdvance";
import { EnterSignInCode } from "./EnterSignInCode";

export default async function VerifyRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string; from?: string; email?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const consoleOnly = sp.delivery === "console";
  const callbackUrl = sp.from && sp.from.startsWith("/") ? sp.from : "/";
  // Forwarded by the login form. Only ever the address the visitor just typed into this browser,
  // so it is theirs to see; it is what the code is checked against.
  const email = typeof sp.email === "string" ? sp.email.trim().toLowerCase() : "";

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      {/* If the link happens to open in THIS browser, the cookie lands here too — notice and go
          straight in, rather than making someone type a code they no longer need. */}
      <VerifyRequestAutoAdvance callbackUrl={callbackUrl} />
      <h1 className="page-title">Check your email</h1>
      {consoleOnly ? (
        <div className="mt-4 text-left" role="status">
          <CardPanel contentClassName="border border-primary-ink/40 bg-accent/10">
          <p className="font-medium text-foreground">No email was sent from this environment</p>
          <p className="mt-2 text-muted-foreground">
            <code className="text-xs">EMAIL_SERVER</code> and <code className="text-xs">EMAIL_FROM</code>{" "}
            are not both set, so the sign-in code and link are only printed in the terminal where{" "}
            <code className="text-xs">npm run dev</code> is running. Copy the code into the box
            below, or open that URL in your browser.
          </p>
          <p className="mt-2 text-muted-foreground">
            For real inbox delivery, configure SMTP in <code className="text-xs">.env.local</code> (see{" "}
            <code className="text-xs">.env.example</code>). For local dev, set{" "}
            <code className="text-xs">AUTH_URL=http://localhost:3000</code> so the link matches this app.
          </p>
          </CardPanel>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          If this address is on the invite list, we sent a six-digit code
          {email ? <> to <span className="text-foreground">{email}</span></> : null}. It may take a
          minute to arrive.
        </p>
      )}

      {email ? (
        <EnterSignInCode email={email} callbackUrl={callbackUrl} />
      ) : (
        // No address to check a code against — only reachable by opening this URL directly.
        <p className="mt-6 text-sm text-muted-foreground">
          Open the link in that email to sign in, or{" "}
          <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
            start again
          </Link>{" "}
          to get a code you can type here.
        </p>
      )}

      {/* The link is the shortcut, not the main road: it signs in whichever browser the mail app
          decides to open, which on a phone is often not this one. */}
      <p className="mt-6 text-xs text-muted-foreground">
        The email also has a tap-to-sign-in link. It only works in the browser it opens in — if
        that isn&rsquo;t this one, use the code.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
          Use a different email
        </Link>
      </p>
    </main>
  );
}
