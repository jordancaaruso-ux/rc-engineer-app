import type { ReactNode } from "react";
import Link from "next/link";

export default async function VerifyRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ delivery?: string }>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const consoleOnly = sp.delivery === "console";

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">Check your email</h1>
      {consoleOnly ? (
        <div
          className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-left text-sm text-foreground"
          role="status"
        >
          <p className="font-medium text-foreground">No email was sent from this environment</p>
          <p className="mt-2 text-muted-foreground">
            <code className="text-xs">EMAIL_SERVER</code> and <code className="text-xs">EMAIL_FROM</code>{" "}
            are not both set, so the sign-in link is only printed in the terminal where{" "}
            <code className="text-xs">npm run dev</code> is running. Copy that URL and open it in your
            browser.
          </p>
          <p className="mt-2 text-muted-foreground">
            For real inbox delivery, configure SMTP in <code className="text-xs">.env.local</code> (see{" "}
            <code className="text-xs">.env.example</code>). For local dev, set{" "}
            <code className="text-xs">AUTH_URL=http://localhost:3000</code> so the link matches this app.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          If this address is on the invite list, we sent a sign-in link. It may take a minute to arrive.
        </p>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-accent underline-offset-2 hover:underline">
          Use a different email
        </Link>
      </p>
    </main>
  );
}
