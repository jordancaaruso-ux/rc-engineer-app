"use client";

import { useState } from "react";

export type BillingPlan = {
  tier: string;
  interval: string;
  priceId: string;
  label: string;
};

export function BillingClient({
  plans,
  entitled,
  tier,
  grandfathered,
  hasCustomer,
  enforced,
}: {
  plans: BillingPlan[];
  entitled: boolean;
  tier: string;
  grandfathered: boolean;
  hasCustomer: boolean;
  enforced: boolean;
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
    window.location.href = data.url;
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
      <p className="text-sm text-neutral-500">
        {grandfathered
          ? "You have full access as an existing member — no payment needed."
          : entitled
            ? `Current plan: ${tier}.`
            : "Choose a plan to unlock the app."}
        {!enforced && " (Billing is not yet enforced — everyone has full access for now.)"}
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {plans.length === 0 ? (
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
