"use client";

import { useState } from "react";

export type BillingPlan = {
  tier: string;
  interval: string;
  priceId: string;
  label: string;
};

export type BillingSubscription = {
  /** Already resolved to a display name upstream — never the raw `Subscription.tier` id. */
  tierLabel: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export function BillingClient({
  plans,
  entitled,
  tierLabel,
  grandfathered,
  hasCustomer,
  enforced,
  subscription,
  activeSubscriber,
  canUpgrade,
}: {
  plans: BillingPlan[];
  entitled: boolean;
  tierLabel: string;
  grandfathered: boolean;
  hasCustomer: boolean;
  enforced: boolean;
  subscription: BillingSubscription | null;
  /** A live subscription exists — plan changes go through Stripe's portal, never a new checkout. */
  activeSubscriber: boolean;
  /** Live subscription on a tier with something above it. */
  canUpgrade: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, payload?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong");
    window.location.assign(data.url);
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {subscription && (
        <div className="rounded-lg border border-neutral-300 px-4 py-3 text-sm dark:border-neutral-700">
          <span className="font-medium">Current subscription:</span>{" "}
          {subscription.tierLabel} · {subscription.status}
          {subscription.currentPeriodEnd &&
            ` · ${subscription.cancelAtPeriodEnd ? "ends" : "renews"} ${new Date(
              subscription.currentPeriodEnd,
            ).toLocaleDateString()}`}
        </div>
      )}

      <p className="text-sm text-neutral-500">
        {grandfathered
          ? "You have full access as an existing member — no payment needed."
          : entitled
            ? `Current plan: ${tierLabel}.`
            : "Choose a plan to unlock the app."}
        {!enforced && " (Billing is not yet enforced — everyone has full access for now.)"}
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* An existing subscriber never goes through checkout again (docs/STARTER_TIER_PLAN.md):
          `/api/billing/checkout` creates a SECOND subscription for a customer who already has
          one. A plan change is Stripe's portal switching the price on the subscription they
          hold, prorated. Only a lapsed or never-subscribed member sees the plan grid. */}
      {activeSubscriber ? (
        canUpgrade ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("upgrade", () => post("/api/billing/portal", { flow: "subscription_update" }))
            }
            className="self-start rounded-lg border border-neutral-300 px-4 py-3 text-left transition-colors hover:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
          >
            <span className="block font-medium">Upgrade</span>
            <span className="block text-sm text-neutral-500">
              {busy === "upgrade" ? "Opening…" : "Change plan"}
            </span>
          </button>
        ) : null
      ) : plans.length === 0 ? (
        <p className="text-sm text-neutral-500">No plans are configured yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <button
              key={p.priceId}
              type="button"
              disabled={busy !== null}
              onClick={() => run(p.priceId, () => post("/api/billing/checkout", { priceId: p.priceId }))}
              className="rounded-lg border border-neutral-300 px-4 py-3 text-left transition-colors hover:border-neutral-500 disabled:opacity-50 dark:border-neutral-700"
            >
              <span className="block font-medium">{p.label}</span>
              <span className="block text-sm text-neutral-500">
                {busy === p.priceId ? "Redirecting…" : "Subscribe"}
              </span>
            </button>
          ))}
        </div>
      )}

      {hasCustomer && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("portal", () => post("/api/billing/portal"))}
          className="self-start text-sm underline disabled:opacity-50"
        >
          {busy === "portal" ? "Opening…" : "Manage subscription"}
        </button>
      )}
    </div>
  );
}
