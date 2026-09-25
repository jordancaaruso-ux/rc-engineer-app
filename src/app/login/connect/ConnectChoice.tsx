"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { AppleMark, GoogleMark } from "@/components/auth/ProviderMarks";
import { buttonLinkClassName, primaryButtonClassName } from "@/components/ui/ButtonLink";
import { connectSignInPath, type SocialProvider } from "@/lib/auth/social/socialSignInLogic";

const PRIMARY = primaryButtonClassName(
  "primary-action-chip-prominent w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60"
);

/**
 * The two answers on `/login/connect`. "New" makes the account in the app, or goes to the plans on
 * the website (the website never makes an account on sign-in). "Already have one" signs in to it
 * once — any way but this Apple/Google — and `/api/auth/social/finish` links the two.
 */
export function ConnectChoice({
  provider,
  email,
  emailHidden,
  inApp,
}: {
  provider: SocialProvider;
  email: string;
  emailHidden: boolean;
  inApp: boolean;
}): ReactNode {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAccount(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/social/create", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
      if (!res.ok || !data.next) {
        setError(data.error ?? "We couldn't create your account just now. Please try again.");
        setPending(false);
        return;
      }
      // A full navigation: the next hop is Auth.js setting the session cookie.
      window.location.assign(data.next);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <>
      <p className="mt-3 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        {provider === "apple" ? <AppleMark size={15} /> : <GoogleMark />}
        <span className="min-w-0 truncate">
          {emailHidden ? "Email hidden by Apple" : email}
        </span>
      </p>

      <div className="mt-6 space-y-3">
        {inApp ? (
          <button
            type="button"
            onClick={() => void createAccount()}
            disabled={pending}
            className={PRIMARY}
          >
            {pending ? "Creating…" : "Create my account"}
          </button>
        ) : (
          <Link href={`/join?${new URLSearchParams({ email })}`} className={PRIMARY}>
            See plans
          </Link>
        )}
        <Link
          href={connectSignInPath(provider)}
          className={buttonLinkClassName("outline", "w-full px-4 py-3")}
        >
          I already have an account
        </Link>
      </div>

      {error ? <p className="mt-4 text-[13px] leading-snug text-destructive">{error}</p> : null}

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        <Link href="/login" className="underline-offset-4 hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
