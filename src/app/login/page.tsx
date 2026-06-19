"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";

const SANS: React.CSSProperties = { fontFamily: "var(--font-jakarta), system-ui, sans-serif" };
const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono-jb), ui-monospace, SFMono-Regular, monospace",
};

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

  const showGoogle = configLoaded && googleOAuthConfigured;

  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden px-5 py-12"
      style={{ backgroundColor: "#17130F", ...SANS }}
    >
      {/* Faded hero wash — warm glow top, ember glow bottom (login/dashboard only). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 75% at 50% -8%, rgba(255,214,10,0.10), rgba(255,214,10,0) 55%), radial-gradient(90% 60% at 50% 115%, rgba(150,96,44,0.20), rgba(150,96,44,0) 70%)",
        }}
      />
      {/* Fine grain for richness — very subtle. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* Top hairline accent. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,214,10,0.5), transparent)" }}
      />

      <div className="relative z-10 w-full max-w-[400px]">
        {/* Brand lockup (type-based for now; logo asset rework is a separate step). */}
        <div className="flex flex-col items-center text-center">
          <span className="text-[44px] font-extrabold leading-none tracking-tight text-[#ECE7DF]">
            JRC
          </span>
          <span
            className="mt-2.5 text-[11px] font-medium tracking-[0.42em] text-[#FFD60A]"
            style={MONO}
          >
            RACE&nbsp;ENGINEER
          </span>
        </div>

        <div className="mt-9 rounded-2xl border border-[#241F1A] bg-[#161310]/70 p-6 shadow-[0_24px_70px_-28px_rgba(0,0,0,0.75)] backdrop-blur-sm">
          <div className="mb-5 flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4FD089]" />
            <span className="text-[10px] tracking-[0.3em] text-[#6A645B]" style={MONO}>
              SECURE SIGN-IN
            </span>
          </div>

          <h1 className="text-center text-[22px] font-bold tracking-tight text-[#ECE7DF]">
            Sign in
          </h1>
          <p className="mx-auto mt-2 max-w-[19rem] text-center text-[13.5px] leading-relaxed text-[#A89C8B]">
            Only invited email addresses can sign in. Ask the app owner to add yours to the
            allowlist.
          </p>

          {showGoogle ? (
            <button
              type="button"
              onClick={() => void signIn("google", { callbackUrl })}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-[#2C2823] bg-[#1E1A15] px-4 py-3 text-[14px] font-semibold text-[#ECE7DF] transition-colors hover:bg-[#241F18]"
            >
              <GoogleMark />
              Continue with Google
            </button>
          ) : null}

          {showGoogle ? (
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#2C2823]" />
              <span className="text-[10px] tracking-[0.3em] text-[#6A645B]" style={MONO}>
                OR
              </span>
              <span className="h-px flex-1 bg-[#2C2823]" />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className={showGoogle ? "space-y-4" : "mt-6 space-y-4"}>
            <label className="block">
              <span className="mb-2 block text-[10px] tracking-[0.25em] text-[#6A645B]" style={MONO}>
                EMAIL
              </span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="w-full rounded-lg border border-[#2C2823] bg-[#1B1712] px-3.5 py-3 text-[15px] text-[#ECE7DF] outline-none transition-colors placeholder:text-[#6A645B] focus:border-[#FFD60A]"
              />
            </label>
            {error ? <p className="text-[13px] leading-snug text-[#E5644E]">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-[#FFD60A] px-4 py-3 text-[13px] font-bold uppercase tracking-[0.14em] text-[#17130F] transition-colors hover:bg-[#E6BE00] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Sending…" : "Email me a link"}
            </button>
          </form>
        </div>

        <p className="mt-7 text-center">
          <Link
            href="/"
            className="text-[11px] tracking-[0.2em] text-[#6A645B] underline-offset-4 transition-colors hover:text-[#A89C8B] hover:underline"
            style={MONO}
          >
            ← BACK TO HOME
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
        <div
          className="flex min-h-[100dvh] w-full flex-1 items-center justify-center"
          style={{ backgroundColor: "#17130F" }}
        >
          <span className="text-[11px] tracking-[0.3em] text-[#6A645B]" style={MONO}>
            LOADING…
          </span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
