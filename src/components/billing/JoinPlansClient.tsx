"use client";

import { useState } from "react";

export type JoinPlan = {
  tier: "standard" | "pro";
  interval: "month" | "year";
  priceId: string;
  /** Formatted amount, e.g. "$14.99" — null when Stripe couldn't be read (render without). */
  amount: string | null;
};

const TIER_COPY: Record<
  "standard",
  { name: string; blurb: string; features: string[] }
> & Record<"pro", { name: string; blurb: string; features: string[] }> = {
  standard: {
    name: "Standard",
    blurb: "The smart race notebook.",
    features: [
      "Log every run in seconds",
      "Review sessions and lap analysis",
      "Compare runs and setups",
      "Ask the Engineer — 2 questions a day",
    ],
  },
  pro: {
    name: "Pro",
    blurb: "The full race engineer.",
    features: [
      "Everything in Standard",
      "Engineer — 300 questions a month",
      "Video analysis",
      "Roll-center tools",
    ],
  },
};

/**
 * The paid door's plan picker (public — no session). Posts to /api/billing/public-checkout;
 * Stripe Checkout collects the email and the webhook provisions the account
 * (MONETISATION_NORTH_STAR.md, Phase 1).
 */
export function JoinPlansClient({ plans }: { plans: JoinPlan[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(priceId: string) {
    setBusy(priceId);
    setError(null);
    try {
      const res = await fetch("/api/billing/public-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  const tiers: Array<"standard" | "pro"> = ["standard", "pro"];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {tiers.map((tier) => {
          const copy = TIER_COPY[tier];
          const tierPlans = plans.filter((p) => p.tier === tier);
          return (
            <div
              key={tier}
              className="flex flex-col gap-3 rounded-xl border border-neutral-300 p-5 dark:border-neutral-700"
            >
              <div>
                <h2 className="text-lg font-semibold">{copy.name}</h2>
                <p className="text-sm text-muted-foreground">{copy.blurb}</p>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {copy.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden="true" className="text-accent">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2 pt-2">
                {tierPlans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not available yet.</p>
                ) : (
                  tierPlans.map((p) => (
                    <button
                      key={p.priceId}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => startCheckout(p.priceId)}
                      className="rounded-lg border border-neutral-300 px-4 py-2.5 text-left transition-colors hover:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
                    >
                      <span className="block text-sm font-medium">
                        {p.amount ? `${p.amount} ` : ""}
                        {p.interval === "year" ? "per year" : "per month"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {busy === p.priceId ? "Redirecting…" : "Get started"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Not for you? Full refund in the first 14 days, no questions. Have a promo code? Enter it at
        checkout.
      </p>
    </div>
  );
}
