import type { ReactNode } from "react";
import Link from "next/link";
import { DoorScene } from "@/components/brand/DoorScene";
import { JrcMark } from "@/components/brand/JrcMark";
import { VerifyRequestAutoAdvance } from "./VerifyRequestAutoAdvance";
import { EnterSignInCode } from "./EnterSignInCode";

/**
 * The screen someone stares at between "Continue with email" and being in — restyled onto the
 * signed-out family's shared scene (2026-08-15). Before this it was a bare heading and a
 * paragraph on flat charcoal, the only signed-out page with no backdrop and no card, which made
 * the most anxious moment of the flow look like the least finished page of the product.
 */
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
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      <DoorScene variant="focus" />
      {/* If the link happens to open in THIS browser, the cookie lands here too — notice and go
          straight in, rather than making someone type a code they no longer need. */}
      <VerifyRequestAutoAdvance callbackUrl={callbackUrl} />

      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex justify-center">
          <JrcMark variant="yellow" priority className="h-10" />
        </div>

        <div className="door-sheet login-sheen mt-8 p-6">
          <h1 className="page-title text-center">Check your email</h1>

          {consoleOnly ? (
            <div className="mt-4 rounded-xl border border-primary-ink/40 bg-accent/10 p-4 text-left text-sm" role="status">
              <p className="font-medium text-foreground">No email was sent from this environment</p>
              <p className="mt-2 text-muted-foreground">
                <code className="text-xs">EMAIL_SERVER</code> and{" "}
                <code className="text-xs">EMAIL_FROM</code> are not both set, so the sign-in code
                and link are only printed in the terminal where{" "}
                <code className="text-xs">npm run dev</code> is running. Copy the code into the box
                below, or open that URL in your browser.
              </p>
              <p className="mt-2 text-muted-foreground">
                For real inbox delivery, configure SMTP in{" "}
                <code className="text-xs">.env.local</code> (see{" "}
                <code className="text-xs">.env.example</code>). For local dev, set{" "}
                <code className="text-xs">AUTH_URL=http://localhost:3000</code> so the link matches
                this app.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
              We sent a six-digit code
              {email ? (
                <>
                  {" "}
                  to <span className="text-foreground">{email}</span>
                </>
              ) : null}
              . It may take a minute to arrive.
            </p>
          )}

          {email ? (
            <EnterSignInCode email={email} callbackUrl={callbackUrl} />
          ) : (
            // No address to check a code against — only reachable by opening this URL directly.
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Open the link in that email to sign in, or{" "}
              <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
                start again
              </Link>{" "}
              to get a code you can type here.
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          Didn&rsquo;t arrive?{" "}
          <Link href="/login" className="text-primary-ink underline-offset-2 hover:underline">
            Send a fresh code
          </Link>{" "}
          — or use a different email.
        </p>
      </div>
    </div>
  );
}
