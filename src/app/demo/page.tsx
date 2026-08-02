"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

/**
 * Demo entry (MONETISATION_NORTH_STAR.md Phase 3). A tiny client page — NOT a server
 * redirect — so that a <Link> prefetch of /demo can never mint sign-in tokens; the token is
 * only created when a real browser lands here and follows /api/auth/demo.
 */
export default function DemoEntryPage() {
  const { data: session, status } = useSession();
  const [kicked, setKicked] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated" && !kicked) {
      setKicked(true);
      window.location.assign("/api/auth/demo");
    }
  }, [status, kicked]);

  if (status === "authenticated" && session?.user && !session.user.isDemo) {
    return (
      <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="page-title">You&rsquo;re already signed in</h1>
        <p className="text-sm text-muted-foreground">
          The demo is for visitors — your own garage is better.
        </p>
        <Link href="/" className={buttonLinkClassName("primary")}>
          Open your garage
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="page-title">Opening the demo garage…</h1>
      <p className="text-sm text-muted-foreground">
        A real driver&rsquo;s season, read-only. One moment.
      </p>
      {/* Deliberately a plain <a>: this is an API endpoint that must be a full navigation —
          <Link> would client-route/prefetch it and mint tokens it shouldn't. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/auth/demo" className={buttonLinkClassName("outline")}>
        Taking too long? Tap here
      </a>
    </main>
  );
}
