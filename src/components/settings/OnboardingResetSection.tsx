"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";

/**
 * Re-run the guided intro — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Onboarding is the one flow you can only experience once, which makes it the
 * easiest to ship broken. This clears the `AppSetting` flags so the dashboard
 * intro card, guide chip and highlighted taps behave like a first sign-in
 * again. Rendered for admins only (see `settings/page.tsx`) — it is a testing
 * affordance, not a user feature.
 *
 * It does NOT delete cars, tracks or runs, so derived progress will still read
 * as complete on a garage that's already full. For a true empty account, sign
 * in as a throwaway address (`AUTH_DEV_ALLOW_ANY_EMAIL=1`) and delete it
 * afterwards.
 */
export function OnboardingResetSection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Onboarding (admin)</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Clears your guided-intro state so the dashboard intro card and guide chip run again.
        Leaves cars, tracks and runs alone.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void reset()}
          className={outlineButtonClassName("px-3 py-1.5 text-sm disabled:opacity-50")}
        >
          {busy ? "Resetting…" : "Reset onboarding"}
        </button>
        {done ? (
          <a href="/" className="text-xs font-semibold text-primary underline">
            Open the dashboard
          </a>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </CardPanel>
  );
}
