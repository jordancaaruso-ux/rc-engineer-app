"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";
import { JrcMark } from "@/components/brand/JrcMark";
import { TelemetryBackground } from "@/components/brand/TelemetryBackground";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";

/** Official Google "G" mark — multicolor, reads cleanly on the dark surface button. */
function GoogleMark(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.892 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * What a stranger sees instead of a code box. `/join` is the pricing page and is deliberately
 * public in `middleware.ts` — it is the door people are meant to come through.
 */
const noAccountYet = (
  <>
    That email doesn&rsquo;t have an account yet.{" "}
    <Link href="/join" className="underline underline-offset-4 hover:text-foreground">
      See plans
    </Link>
    .
  </>
);

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [openSignup, setOpenSignup] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);

  const from = searchParams.get("from") || "/";
  const callbackUrl = from.startsWith("/") ? from : "/";

  /**
   * The invite code rides in the URL now, not in a box on the form. Nearly everyone arrives here
   * either already invited or having paid, so a field asking for a code they've never heard of
   * read as a locked door on a product they just bought. Comping someone is a conversation you're
   * already having, so send them `/login?code=jrc-xxxx` and they never see it either.
   */
  const accessCode = searchParams.get("code")?.trim() ?? "";

  useEffect(() => {
    if (searchParams.get("error") === "AccessDenied") {
      setError(
        openSignup
          ? "That sign-in didn't go through. Please try again."
          : noAccountYet
      );
    }
  }, [searchParams, openSignup]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hintRes = await fetch("/api/auth/config-hint");
        const hint = (await hintRes.json()) as {
          googleOAuthConfigured?: boolean;
          smtpConfigured?: boolean;
          openSignup?: boolean;
        };
        if (cancelled) return;
        if (hint.googleOAuthConfigured === true) setGoogleOAuthConfigured(true);
        if (hint.openSignup === true) setOpenSignup(true);
        setSmtpConfigured(hint.smtpConfigured === true);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setConfigLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Add this email to the allowlist if an invite code came in on the URL (or it's already
   * allowed). Runs before both sign-in paths — otherwise a non-allowlisted address silently gets
   * no magic link (`sendVerificationRequest` declines to send) and the user waits forever.
   */
  async function redeemAccess(normalizedEmail: string): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/redeem-access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, code: accessCode }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        needsAccount?: boolean;
      };
      if (res.ok && data.ok === true) return true;
      // `needsAccount` means "no invite code was offered and this address isn't known" — the
      // ordinary stranger. Point them at the paid door rather than at a code they don't have.
      setError(data.needsAccount === true ? noAccountYet : (data.error ?? noAccountYet));
      return false;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const normalized = email.trim().toLowerCase();
      if (!(await redeemAccess(normalized))) return;

      const res = await signIn("nodemailer", {
        email: normalized,
        callbackUrl,
        redirect: false,
      });
      if (res?.error) {
        // AccessDenied means the allowlist rejected the address, not that mail is broken —
        // reporting the latter sends you debugging SMTP for an auth problem. Anything else is a
        // real send failure, which is ours to fix and not something to hand a driver server-log
        // instructions about; point them at Google, which doesn't depend on mail delivery.
        setError(
          res.error === "AccessDenied"
            ? openSignup
              ? "That sign-in didn't go through. Please try again."
              : noAccountYet
            : googleOAuthConfigured
              ? "We couldn't send the sign-in email. Try “Continue with Google” instead."
              : "We couldn't send the sign-in email just now. Please try again shortly."
        );
        return;
      }
      // Carry both forward. The email is what the typed code is checked against, and `from` is
      // where they were headed before the login wall — it used to be dropped at this hop, so
      // everyone landed on the dashboard no matter what they'd clicked.
      const verifyParams = new URLSearchParams({ email: normalized });
      if (callbackUrl !== "/") verifyParams.set("from", callbackUrl);
      if (!smtpConfigured) verifyParams.set("delivery", "console");
      router.push(`/login/verify-request?${verifyParams}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  /**
   * Empty email box → straight to Google like normal SSO; the `signIn` callback still enforces
   * the allowlist and bounces a non-approved account back here with ?error=AccessDenied (which
   * prompts for an access code). Email typed → redeem first, so a valid access code allowlists
   * the address before the OAuth hop (self-serve signup in one round-trip).
   */
  async function onGoogleSignIn() {
    setError(null);
    const normalized = email.trim().toLowerCase();
    setPending(true);
    try {
      if (normalized.includes("@") && !(await redeemAccess(normalized))) return;
      await signIn("google", { callbackUrl });
    } finally {
      setPending(false);
    }
  }

  const showGoogle = configLoaded && googleOAuthConfigured;

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      {/* Animated telemetry backdrop — traces + oscilloscope grid (login only). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <TelemetryBackground />
      </div>

      {/* Yellow hero whisper (brand, sanctioned on login). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 75% at 50% -8%, rgba(255,214,10,0.12), rgba(255,214,10,0) 55%)",
        }}
      />

      {/* Top hairline accent. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="relative z-10 w-full max-w-[400px]">
        {/* Brand lockup — JRC mark only (Race Engineer wordline retired 2026-07-17). */}
        <div
          className="rc-reveal flex flex-col items-center text-center"
          style={{ "--rc-delay": "60ms" } as CSSProperties}
        >
          <JrcMark variant="yellow" priority className="h-12" />
        </div>

        <div
          className="login-sheen rc-reveal relative mt-9 overflow-hidden rounded-2xl border border-border bg-background/70 p-6 shadow-[0_24px_70px_-28px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl"
          style={{ "--rc-delay": "170ms" } as CSSProperties}
        >
          <h1 className="page-title text-center">Sign in</h1>

          {showGoogle ? (
            <button
              type="button"
              onClick={() => void onGoogleSignIn()}
              disabled={pending}
              className="tap-active mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GoogleMark />
              Continue with Google
            </button>
          ) : null}

          {showGoogle ? (
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="type-data-label">Or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className={showGoogle ? "space-y-4" : "mt-6 space-y-4"}>
            <label className="block">
              <span className="type-data-label mb-2 block">Email</span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="ui-control w-full rounded-lg border border-border bg-input px-3.5 py-3 text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary-ink"
              />
            </label>
            {error ? <p className="text-[13px] leading-snug text-destructive">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className={primaryButtonClassName(
                "primary-action-chip-prominent w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {pending ? "Sending…" : "Email me a code"}
            </button>
          </form>

          <p className="mt-5 text-center text-[12px] leading-snug text-muted-foreground">
            By continuing you agree to the{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
              Privacy policy
            </Link>
            .
          </p>
        </div>

        <p
          className="rc-reveal mt-7 text-center"
          style={{ "--rc-delay": "270ms" } as CSSProperties}
        >
          <Link
            href="/"
            className="type-data-label underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
          >
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage(): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] w-full flex-1 items-center justify-center bg-background">
          <span className="type-data-label">Loading…</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
