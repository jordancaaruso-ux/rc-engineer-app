"use client";

import { useState, type ReactNode } from "react";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { SIGN_IN_CODE_LENGTH } from "@/lib/auth/signInCodeShared";

/**
 * The code box — the path that works no matter where the emailed link ends up.
 *
 * `autocomplete="one-time-code"` is not decoration: it is the entire iOS/macOS autofill feature.
 * With it, a code that arrives in Mail is offered in the strip above the keyboard and fills on one
 * tap, so the driver never leaves this tab. `inputMode="numeric"` brings up the keypad instead of
 * the full keyboard on a phone.
 *
 * A full navigation on success, not `router.push`: the response URL is Auth.js's own callback,
 * and it must be fetched by the browser as a top-level request so the `Set-Cookie` it issues
 * lands in this jar.
 */
export function EnterSignInCode({
  email,
  callbackUrl,
}: {
  email: string;
  callbackUrl: string;
}): ReactNode {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, callbackUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (res.ok && data.ok === true && data.url) {
        window.location.href = data.url;
        return; // Keep the button disabled through the navigation.
      }
      setError(data.error ?? "That code isn't right, or it has expired. Request a new one.");
      setPending(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 text-left">
      <label className="block">
        <span className="type-data-label mb-2 block">Sign-in code</span>
        <input
          type="text"
          name="code"
          value={code}
          // Strip as they type so a pasted "123 456" lands clean and maxLength counts digits.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={SIGN_IN_CODE_LENGTH}
          autoFocus
          required
          placeholder="000000"
          aria-describedby={error ? "sign-in-code-error" : undefined}
          className="ui-control w-full rounded-lg border border-border bg-input px-3.5 py-3 text-center text-2xl font-semibold tracking-[0.35em] text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary-ink"
        />
      </label>
      {error ? (
        <p id="sign-in-code-error" role="alert" className="mt-3 text-[13px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || code.length !== SIGN_IN_CODE_LENGTH}
        className={primaryButtonClassName(
          "primary-action-chip-prominent mt-4 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
