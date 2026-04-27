"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { JrcRaceEngineerLogo } from "@/components/brand/JrcRaceEngineerLogo";
import { Suspense, useEffect, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const from = searchParams.get("from") || "/";
  const callbackUrl = from.startsWith("/") ? from : "/";

  useEffect(() => {
    if (searchParams.get("error") === "AccessDenied") {
      setError("That sign-in is not allowed. Ask for an invite (allowlisted email).");
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hintRes = await fetch("/api/auth/config-hint");
        const hint = (await hintRes.json()) as { googleOAuthConfigured?: boolean };
        if (!cancelled && hint.googleOAuthConfigured === true) {
          setGoogleOAuthConfigured(true);
        }
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await signIn("nodemailer", {
        email: email.trim().toLowerCase(),
        callbackUrl,
        redirect: false,
      });
      if (res?.error) {
        setError("Could not send sign-in email. Check server logs and SMTP configuration.");
        return;
      }
      let delivery: string | undefined;
      try {
        const hintRes = await fetch("/api/auth/config-hint");
        const hint = (await hintRes.json()) as { smtpConfigured?: boolean };
        if (hint.smtpConfigured !== true) {
          delivery = "console";
        }
      } catch {
        /* ignore */
      }
      const verifyUrl =
        delivery === "console"
          ? "/login/verify-request?delivery=console"
          : "/login/verify-request";
      router.push(verifyUrl);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <div className="flex flex-col items-center text-center sm:items-stretch sm:text-left">
        <JrcRaceEngineerLogo className="h-12 w-auto sm:h-14" priority />
        <h1 className="mt-4 text-lg font-semibold text-foreground not-italic normal-case">Sign in</h1>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Only invited email addresses can sign in. Ask the app owner to add yours to the allowlist.
      </p>
      {configLoaded && googleOAuthConfigured ? (
        <div className="mt-6">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/80"
            onClick={() => void signIn("google", { callbackUrl })}
          >
            Continue with Google
          </button>
          <p className="mt-3 text-center text-xs text-muted-foreground">or use email</p>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="text-muted-foreground">Email</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-foreground"
          />
        </label>
        {error ? <p className="text-sm text-primary">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage(): ReactNode {
  return (
    <Suspense
      fallback={<main className="px-4 py-16 text-center text-muted-foreground">Loading…</main>}
    >
      <LoginForm />
    </Suspense>
  );
}
