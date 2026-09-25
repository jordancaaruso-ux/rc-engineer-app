"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { JrcMark } from "@/components/brand/JrcMark";
import { DoorScene } from "@/components/brand/DoorScene";
import { buttonLinkClassName, primaryButtonClassName } from "@/components/ui/ButtonLink";
import { AppleMark, GoogleMark } from "@/components/auth/ProviderMarks";
import {
  nativeSocialAvailable,
  nativeSocialSignIn,
  type NativeSocialConfig,
} from "@/lib/auth/nativeSocialClient";
import { providerLabel, type SocialProvider } from "@/lib/auth/social/socialSignInLogic";

/**
 * Words for the short codes Apple/Google sign-in sends back here on failure
 * (`/api/auth/apple/callback`). The iPhone app shows the server's own sentence instead.
 */
const SOCIAL_ERRORS: Record<string, string> = {
  social: "That sign-in didn't go through. Please try again.",
  "social-taken": "That Apple or Google account is connected to a different Trackside account.",
  "social-denied": "This account can't sign in here.",
  "social-no-email": "Apple didn't share a verified email with us. Sign in with your email instead.",
};

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

/** The app's version: it can't point at the plans, so it offers its own sign-up instead. */
function NoAccountInApp({ onSignUp }: { onSignUp: () => void }): ReactNode {
  return (
    <>
      There&rsquo;s no account for that email.{" "}
      <button
        type="button"
        onClick={onSignUp}
        className="underline underline-offset-4 hover:text-foreground"
      >
        Sign up
      </button>{" "}
      instead?
    </>
  );
}

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
  const [inApp, setInApp] = useState(false);
  const [demoReady, setDemoReady] = useState(false);
  const [appleSignIn, setAppleSignIn] = useState(false);
  const [googleNative, setGoogleNative] = useState<NativeSocialConfig["google"]>(null);
  /** The app build carries the phone's own Apple/Google sheets (build 2 onward). */
  const [nativeSocial, setNativeSocial] = useState(false);
  /**
   * "I already have an account" from `/login/connect`: sign in once, and the Apple/Google identity
   * waiting there is linked to the account (`from` already points at `/api/auth/social/finish`).
   */
  const connectParam = searchParams.get("connect");
  const connecting: SocialProvider | null =
    connectParam === "apple" || connectParam === "google" ? connectParam : null;
  /**
   * Sign up exists only inside the iPhone/Android app (2026-09-24, founder: "sign in, with a thing
   * that says don't have an account?"). The website's way in is paying at /join; the app may not
   * point there, so it makes the account itself (`/api/auth/app-signup`) and the email-code
   * sign-in below opens it. `?mode=signup` arrives from the demo's "Get your own garage".
   */
  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signup" ? "signup" : "signin"
  );
  const signingUp = inApp && mode === "signup" && !connecting;
  const emailRef = useRef<HTMLInputElement | null>(null);

  // In the app both need the build that carries the phone's sheets; build 1 stays email-only.
  // While linking, the provider being linked is the one thing that can't sign in.
  const showApple =
    configLoaded && appleSignIn && (!inApp || nativeSocial) && connecting !== "apple";
  const showGoogle =
    configLoaded &&
    (inApp ? nativeSocial && googleNative !== null : googleOAuthConfigured) &&
    connecting !== "google";
  const showSocial = showApple || showGoogle;

  const from = searchParams.get("from") || "/";
  const callbackUrl = from.startsWith("/") ? from : "/";

  /**
   * Switching to sign-up changes the heading AND the buttons, so the tap visibly does something —
   * with only the heading changing, the founder couldn't tell anything had happened (2026-09-24).
   * With Apple and Google on screen it stops there: jumping into the email box with the keyboard
   * up made them feel second to email, when someone may well want to sign up with Apple (founder,
   * 2026-09-25). Email-only (build 1) still puts the cursor in the box, its one way in. The focus
   * runs inside the tap itself, which is what lets iOS raise the keyboard.
   */
  function switchMode(next: "signin" | "signup"): void {
    setError(null);
    setMode(next);
    if (!showSocial) emailRef.current?.focus();
  }

  /** A stranger's email. The website points at the plans; the app offers its own sign-up. */
  const noAccount = useCallback(
    (): ReactNode =>
      inApp ? (
        <NoAccountInApp
          onSignUp={() => {
            setError(null);
            setMode("signup");
            emailRef.current?.focus();
          }}
        />
      ) : (
        noAccountYet
      ),
    [inApp]
  );

  /**
   * The invite code rides in the URL now, not in a box on the form. Nearly everyone arrives here
   * either already invited or having paid, so a field asking for a code they've never heard of
   * read as a locked door on a product they just bought. Comping someone is a conversation you're
   * already having, so send them `/login?code=jrc-xxxx` and they never see it either.
   */
  const accessCode = searchParams.get("code")?.trim() ?? "";

  useEffect(() => {
    const code = searchParams.get("error");
    if (code === "AccessDenied") {
      setError(
        openSignup
          ? "That sign-in didn't go through. Please try again."
          : noAccount()
      );
    } else if (code && SOCIAL_ERRORS[code]) {
      setError(SOCIAL_ERRORS[code]);
    }
  }, [searchParams, openSignup, noAccount]);

  useEffect(() => {
    setNativeSocial(nativeSocialAvailable());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hintRes = await fetch("/api/auth/config-hint");
        const hint = (await hintRes.json()) as {
          googleOAuthConfigured?: boolean;
          smtpConfigured?: boolean;
          openSignup?: boolean;
          nativeShell?: boolean;
          demoReady?: boolean;
          appleSignIn?: boolean;
          googleNative?: NativeSocialConfig["google"];
        };
        if (cancelled) return;
        if (hint.googleOAuthConfigured === true) setGoogleOAuthConfigured(true);
        if (hint.appleSignIn === true) setAppleSignIn(true);
        if (hint.googleNative?.iosClientId && hint.googleNative.serverClientId) {
          setGoogleNative(hint.googleNative);
        }
        if (hint.openSignup === true) setOpenSignup(true);
        if (hint.nativeShell === true) setInApp(true);
        if (hint.demoReady === true) setDemoReady(true);
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
      // ordinary stranger. Point them at the way in rather than at a code they don't have.
      setError(data.needsAccount === true ? noAccount() : (data.error ?? noAccount()));
      return false;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  /** The app's sign-up: make the (unpaid) account, then the ordinary code sign-in opens it. */
  async function createAppAccount(normalizedEmail: string): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/app-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok === true) return true;
      setError(data.error ?? "We couldn't create your account just now. Please try again.");
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
      if (signingUp && !(await createAppAccount(normalized))) return;
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
              : noAccount()
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
    if (inApp) return onNativeSignIn("google");
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

  /**
   * The website sends the browser to Apple (`/api/auth/apple/start`); the app opens the phone's
   * own Apple sheet. Either way no account is made for an identity nobody can place: that goes to
   * `/login/connect` ("new, or already have an account?").
   */
  function onAppleSignIn() {
    if (inApp) return void onNativeSignIn("apple");
    setError(null);
    setPending(true);
    window.location.assign(`/api/auth/apple/start?${new URLSearchParams({ from: callbackUrl })}`);
  }

  async function onNativeSignIn(provider: SocialProvider) {
    setError(null);
    setPending(true);
    try {
      const result = await nativeSocialSignIn(
        provider,
        { apple: appleSignIn, google: googleNative },
        callbackUrl
      );
      if ("next" in result) {
        // A full navigation: the next hop is Auth.js setting the session cookie. The buttons stay
        // disabled while the page leaves.
        window.location.assign(result.next);
        return;
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "That sign-in didn't go through. Please try again."
      );
    }
    setPending(false);
  }

  return (
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      {/* The signed-out family's shared scene (2026-08-15): the baked drivers-meeting photo
          with the telemetry traces now compositing over it. The traces, the yellow whisper
          and the top hairline all moved inside DoorScene — same layers, one owner. */}
      <DoorScene variant="focus" />

      <div className="relative z-10 w-full max-w-[400px]">
        {/* Brand lockup — JRC mark only (Race Engineer wordline retired 2026-07-17). */}
        <div
          className="rc-reveal flex flex-col items-center text-center"
          style={{ "--rc-delay": "60ms" } as CSSProperties}
        >
          <JrcMark variant="yellow" priority className="h-12" />
        </div>

        {/* `.door-sheet` IS this card's old recipe, factored out (2026-08-15) so the /join plan
            cards and the code/success cards are literally the same surface. */}
        <div
          className="door-sheet login-sheen rc-reveal mt-9 p-6"
          style={{ "--rc-delay": "170ms" } as CSSProperties}
        >
          <h1 className="page-title text-center">
            {connecting
              ? `Sign in to connect ${providerLabel(connecting)}`
              : signingUp
                ? "Create your account"
                : "Sign in"}
          </h1>

          {showApple ? (
            <button
              type="button"
              onClick={onAppleSignIn}
              disabled={pending}
              // Apple's design rules for this button, on a dark background: white, with black
              // words and logo in the system font, and at least as prominent as any other.
              style={{ fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}
              className="tap-active mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-white bg-white px-4 py-3 text-[15px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <AppleMark />
              {signingUp ? "Sign up with Apple" : "Continue with Apple"}
            </button>
          ) : null}

          {showGoogle ? (
            <button
              type="button"
              onClick={() => void onGoogleSignIn()}
              disabled={pending}
              className={`tap-active ${showApple ? "mt-3" : "mt-6"} flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <GoogleMark />
              {signingUp ? "Sign up with Google" : "Continue with Google"}
            </button>
          ) : null}

          {showSocial ? (
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="type-data-label">Or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className={showSocial ? "space-y-4" : "mt-6 space-y-4"}>
            <label className="block">
              <span className="type-data-label mb-2 block">Email</span>
              <input
                ref={emailRef}
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
              {signingUp
                ? pending
                  ? "Creating…"
                  : "Create account"
                : pending
                  ? "Sending…"
                  : "Continue with email"}
            </button>
          </form>

          {inApp && !connecting ? (
            <p className="mt-4 text-center text-[13px] text-muted-foreground">
              {signingUp ? "Already have an account?" : "Don’t have an account?"}{" "}
              <button
                type="button"
                onClick={() => switchMode(signingUp ? "signin" : "signup")}
                className="font-semibold text-primary-ink underline-offset-2 hover:underline"
              >
                {signingUp ? "Sign in" : "Sign up"}
              </button>
            </p>
          ) : null}

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

        {configLoaded && !inApp ? (
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
        ) : null}

        {/* The app's other way in without an account. A plain full navigation: /demo mints a
            demo session on arrival, and a prefetch must never do that. */}
        {inApp && demoReady && !connecting ? (
          <div className="rc-reveal mt-5" style={{ "--rc-delay": "270ms" } as CSSProperties}>
            <Link
              href="/demo"
              prefetch={false}
              className={buttonLinkClassName("outline", "w-full px-4 py-3")}
            >
              Try the demo
            </Link>
          </div>
        ) : null}
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
