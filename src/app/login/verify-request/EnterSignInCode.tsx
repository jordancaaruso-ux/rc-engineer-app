"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { SIGN_IN_CODE_LENGTH } from "@/lib/auth/signInCodeShared";
import { cn } from "@/lib/utils";

/**
 * The code box — the path that works no matter where the emailed link ends up.
 *
 * `autocomplete="one-time-code"` is not decoration: it is the entire iOS/macOS autofill feature.
 * With it, a code that arrives in Mail is offered in the strip above the keyboard and fills on one
 * tap, so the driver never leaves this tab. `inputMode="numeric"` brings up the keypad instead of
 * the full keyboard on a phone.
 *
 * Six boxes, ONE input (2026-08-15 redesign). The visible cells are decoration over a single
 * invisible `<input>` stretched across them — six real inputs would break exactly the two things
 * that matter here: OS autofill (which fills one field, once) and paste ("123 456" from the
 * email lands in one box and is stripped to digits). A full code auto-submits, because that is
 * what the keyboard-strip tap already implies; the button stays for the manual path and for
 * retrying after an error.
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
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // One auto-submit per distinct full code — an error hands control back to the driver
  // instead of re-firing the same wrong six digits in a loop.
  const lastAutoRef = useRef("");

  const submit = useCallback(
    async (attempt: string): Promise<void> => {
      setError(null);
      setPending(true);
      try {
        const res = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code: attempt, callbackUrl }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          url?: string;
          error?: string;
        };
        if (res.ok && data.ok === true && data.url) {
          window.location.href = data.url;
          return; // Keep the form disabled through the navigation.
        }
        setError(data.error ?? "That code isn't right, or it has expired. Request a new one.");
        setPending(false);
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        setPending(false);
      }
    },
    [email, callbackUrl]
  );

  useEffect(() => {
    if (code.length === SIGN_IN_CODE_LENGTH && !pending && lastAutoRef.current !== code) {
      lastAutoRef.current = code;
      void submit(code);
    }
  }, [code, pending, submit]);

  // `autoFocus` is applied NATIVELY while the HTML parses — before React attaches the
  // onFocus handler — so the already-focused input never fires it and the active cell
  // stayed unlit. Read the truth once after hydration.
  useEffect(() => {
    setFocused(document.activeElement === inputRef.current);
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (pending) return;
    await submit(code);
  }

  // The cell awaiting the next digit — highlighted only while the real input holds focus.
  const activeIndex = focused && !pending ? Math.min(code.length, SIGN_IN_CODE_LENGTH - 1) : -1;

  return (
    <form onSubmit={onSubmit} className="mt-6">
      <span className="type-data-label mb-2.5 block text-center">Sign-in code</span>
      <div className="relative">
        <div aria-hidden="true" className="flex justify-center gap-2">
          {Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, i) => (
            <span
              key={i}
              className={cn(
                "grid h-12 w-10 place-items-center rounded-xl border bg-input/80 text-[22px] font-semibold tabular-nums text-foreground transition-colors",
                i === activeIndex && code.length < SIGN_IN_CODE_LENGTH
                  ? "border-primary-ink shadow-[0_0_0_1px_rgb(var(--color-primary-ink)/0.4)]"
                  : "border-border"
              )}
            >
              {code[i] ?? ""}
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          type="text"
          name="code"
          value={code}
          // Strip as they type so a pasted "123 456" lands clean and maxLength counts digits.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={SIGN_IN_CODE_LENGTH}
          autoFocus
          disabled={pending}
          aria-label="Sign-in code"
          aria-describedby={error ? "sign-in-code-error" : undefined}
          className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
          style={{ caretColor: "transparent" }}
        />
      </div>
      {error ? (
        <p
          id="sign-in-code-error"
          role="alert"
          className="mt-3 text-[13px] leading-snug text-destructive"
        >
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
