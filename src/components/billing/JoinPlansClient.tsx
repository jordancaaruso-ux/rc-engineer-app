"use client";

import { useState } from "react";
import { PillToggle } from "@/components/ui/PillToggle";

export type JoinPlan = {
  tier: "standard" | "pro";
  interval: "month" | "year";
  priceId: string;
  /** Formatted amount, e.g. "$14.99" — null when Stripe couldn't be read (render em dash). */
  amount: string | null;
};

/** The comparison rows (decision-board pick 4A) — feature truth mirrors entitlementLogic.ts. */
const ROWS: Array<{ label: string; standard: string; pro: string }> = [
  { label: "Run logging (LiveRC · Speedhive · MyRCM)", standard: "✓", pro: "✓" },
  { label: "Session review & lap analysis", standard: "✓", pro: "✓" },
  { label: "Compare runs & setups", standard: "✓", pro: "✓" },
  { label: "Engineer questions", standard: "2 a day", pro: "300 a month" },
  { label: "Video analysis", standard: "—", pro: "✓" },
  { label: "Roll-centre tools", standard: "—", pro: "✓" },
];

/**
 * The /join decision surface: one table, monthly/annual toggle ("2 months free" — pick 5A),
 * a checkout door per tier. Posts to /api/billing/public-checkout; Stripe collects the email
 * and the webhook provisions the account (MONETISATION_NORTH_STAR.md Phase 1, unchanged).
 */
export function JoinPlansClient({ plans }: { plans: JoinPlan[] }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = (tier: "standard" | "pro") =>
    plans.find((p) => p.tier === tier && p.interval === interval) ?? null;

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

  const standard = plan("standard");
  const pro = plan("pro");

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto w-full max-w-xs">
        <PillToggle
          ariaLabel="Billing interval"
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Annual · 2 months free" },
          ]}
          value={interval}
          onChange={setInterval}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Comparison table — hairline grid, the app's lap-grid idiom. */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/60">
              <th className="w-[46%] px-3 py-2.5 text-left text-[12px] font-semibold text-muted-foreground">
                What you get
              </th>
              <th className="border-l border-border px-3 py-2.5 text-left text-[13px] font-semibold">
                Standard
              </th>
              <th className="border-l border-border px-3 py-2.5 text-left text-[13px] font-semibold">
                Pro
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5 text-[12.5px] leading-snug text-muted-foreground">
                  {row.label}
                </td>
                <td className="border-l border-border px-3 py-2.5 text-[13px]">{row.standard}</td>
                <td className="border-l border-border px-3 py-2.5 text-[13px]">{row.pro}</td>
              </tr>
            ))}
            <tr className="border-t border-border bg-secondary/40">
              <td className="px-3 py-3 text-[12px] font-semibold text-muted-foreground">
                {interval === "year" ? "Per year" : "Per month"}
              </td>
              <td className="border-l border-border px-3 py-3 text-[15px] font-semibold">
                {standard?.amount ?? "—"}
              </td>
              <td className="border-l border-border px-3 py-3 text-[15px] font-semibold">
                {pro?.amount ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-3" />
              <td className="border-l border-border px-3 py-3">
                <button
                  type="button"
                  disabled={busy !== null || !standard}
                  onClick={() => standard && startCheckout(standard.priceId)}
                  className="w-full whitespace-nowrap rounded-lg bg-primary px-2 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
                >
                  {busy === standard?.priceId ? "Redirecting…" : "Get started"}
                </button>
              </td>
              <td className="border-l border-border px-3 py-3">
                <button
                  type="button"
                  disabled={busy !== null || !pro}
                  onClick={() => pro && startCheckout(pro.priceId)}
                  className="w-full whitespace-nowrap rounded-lg bg-primary px-2 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
                >
                  {busy === pro?.priceId ? "Redirecting…" : "Get started"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Not for you? Full refund in the first 14 days, no questions. Have a promo code? Enter it at
        checkout.
      </p>
    </div>
  );
}
