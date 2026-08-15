"use client";

import { useState } from "react";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import { cn } from "@/lib/utils";
import {
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
} from "@/lib/aiUsage/budgets";

export type JoinPlan = {
  tier: "standard" | "pro";
  interval: "month" | "year";
  priceId: string;
  /** Formatted amount, e.g. "$9.99" — null when Stripe couldn't be read (render em dash). */
  amount: string | null;
};

/**
 * Feature truth mirrors entitlementLogic.ts, and the Engineer numbers read from `budgets.ts`
 * rather than repeating them: this surface is the promise, `applyEngineerTierBudget` is the
 * enforcement, and the two drifting apart is how a member gets sold one number and refused at
 * another.
 *
 * The same truth renders twice (2026-08-15 redesign): as prose bullets on the desktop cards,
 * and as the fold-out comparison table on the phone. Change a feature in BOTH lists or the
 * two widths sell different products.
 */
const COMPARE_ROWS: Array<{ label: string; standard: string; pro: string }> = [
  { label: "Run logging (LiveRC · Speedhive · MyRCM)", standard: "✓", pro: "✓" },
  { label: "Session review & lap analysis", standard: "✓", pro: "✓" },
  { label: "Compare runs & setups", standard: "✓", pro: "✓" },
  {
    label: "Engineer questions",
    standard: `${STANDARD_ENGINEER_DAILY_QUESTIONS} a day`,
    pro: `${PRO_ENGINEER_MONTHLY_QUESTIONS} a month`,
  },
  { label: "Ask a weekend's worth in one day", standard: "—", pro: "✓" },
  { label: "Video analysis", standard: "—", pro: "Soon" },
  { label: "Roll-centre tools", standard: "—", pro: "✓" },
];

const STANDARD_BULLETS: Array<{ text: string; off?: boolean }> = [
  { text: "Unlimited run logging" },
  { text: "Session review: pace, consistency, mistakes" },
  { text: "Compare runs and setups" },
  { text: "Laps from LiveRC, Speedhive and MyRCM" },
  { text: "Video and sector analysis", off: true },
  { text: "Roll-centre and geometry", off: true },
];

const PRO_BULLETS: Array<{ text: string; soon?: boolean }> = [
  { text: `Everything in ${TIER_LABELS.standard}` },
  { text: "A whole race weekend's questions in one day" },
  { text: "Video and sector analysis", soon: true },
  { text: "Roll-centre and geometry tools" },
  { text: "Remaining-this-month meter" },
];

const INTERVAL_SUFFIX = { month: "AUD / month", year: "AUD / year" } as const;

/**
 * The /join decision surface, redesigned 2026-08-15 onto the door scene (see the page file for
 * the shape). One component, two arrangements off a single `md:` fold — the width where two
 * plan cards stop fitting side by side:
 *
 *   - md+: two frosted cards (the login sheet recipe), each with its own checkout button.
 *   - below md: the cards fold into two radio rows with Race Engineer pre-selected, the
 *     comparison table folds behind "line by line", and ONE button commits — the founder's
 *     phone verdict on the stacked-cards version was "too much vertical space", and the fold
 *     takes start-to-button from ~1,400px to under a screen.
 *
 * Yellow-active billing toggle: deliberate departure from `PillToggle` (whose active segment
 * is neutral by app rule). These pages follow the LANDING's grammar — yellow closes the sale —
 * and the app-side rule stays untouched because this toggle is bespoke here.
 *
 * Posts to /api/billing/public-checkout; Stripe collects the email and the webhook provisions
 * the account (MONETISATION_NORTH_STAR.md Phase 1, unchanged).
 */
export function JoinPlansClient({ plans }: { plans: JoinPlan[] }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [selectedTier, setSelectedTier] = useState<"standard" | "pro">("pro");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

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
  const selected = plan(selectedTier);
  const suffix = INTERVAL_SUFFIX[interval];
  const stdDaily =
    STANDARD_ENGINEER_DAILY_QUESTIONS === 1
      ? "once a day"
      : `${STANDARD_ENGINEER_DAILY_QUESTIONS} times a day`;

  return (
    <div className="flex w-full flex-col items-center gap-4 md:gap-5">
      {/* Billing interval — yellow-active by design (see the header comment). */}
      <div
        role="radiogroup"
        aria-label="Billing interval"
        className="inline-flex items-center gap-0.5 rounded-full border border-elevate/15 bg-black/40 p-1 backdrop-blur-md"
      >
        {(
          [
            { value: "month", label: "Monthly" },
            { value: "year", label: "Annual" },
          ] as const
        ).map((opt) => {
          const on = interval === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setInterval(opt.value)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                on
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
              {opt.value === "year" ? (
                <span
                  className={cn(
                    "ml-1.5 text-[10px] font-medium",
                    on ? "text-primary-foreground/70" : "text-primary-ink"
                  )}
                >
                  · 2 months free
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-[13px] leading-snug text-destructive">
          {error}
        </p>
      )}

      {/* ── md+: the two sheets ───────────────────────────────────────────── */}
      <div className="hidden w-full gap-4 text-left md:grid md:grid-cols-2">
        <section className="door-sheet flex flex-col gap-3 p-6" aria-label={TIER_LABELS.standard}>
          <p className="micro-caps tracking-[0.18em] text-faint">{TIER_LABELS.standard}</p>
          <h2 className="text-[15px] font-semibold leading-snug">The smart race notebook.</h2>
          <p className="door-price">
            {standard?.amount ?? "—"}
            <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
              {suffix}
            </span>
          </p>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-elevate/10 bg-elevate/[0.04] px-3 py-2">
            <span className="micro-caps text-faint">Engineer questions</span>
            <span className="fig-stat font-semibold text-foreground">
              {STANDARD_ENGINEER_DAILY_QUESTIONS} a day
            </span>
          </div>
          <ul className="mt-1 flex flex-col gap-2 text-[13px] leading-snug">
            {STANDARD_BULLETS.map((b) => (
              <li
                key={b.text}
                className={cn(
                  "grid grid-cols-[0.9rem_minmax(0,1fr)] gap-2",
                  b.off ? "text-faint" : "text-muted-foreground"
                )}
              >
                <span aria-hidden="true" className={b.off ? "text-border" : "text-primary-ink"}>
                  {b.off ? "×" : "—"}
                </span>
                {b.text}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy !== null || !standard}
            onClick={() => standard && startCheckout(standard.priceId)}
            className="tap-active mt-auto w-full rounded-lg border border-border bg-transparent px-4 py-3 text-sm font-semibold text-foreground transition hover:border-faint hover:bg-elevate/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === standard?.priceId ? "Redirecting…" : "Get started"}
          </button>
        </section>

        <section
          className="door-sheet door-sheet-hero flex flex-col gap-3 p-6"
          aria-label={TIER_LABELS.pro}
        >
          <p className="micro-caps tracking-[0.18em] text-primary-ink">{TIER_LABELS.pro}</p>
          <h2 className="text-[15px] font-semibold leading-snug">The full race engineer.</h2>
          <p className="door-price">
            {pro?.amount ?? "—"}
            <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
              {suffix}
            </span>
          </p>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2">
            <span className="micro-caps text-faint">Engineer questions</span>
            <span className="fig-stat font-semibold text-primary-ink">
              {PRO_ENGINEER_MONTHLY_QUESTIONS} a month
            </span>
          </div>
          <ul className="mt-1 flex flex-col gap-2 text-[13px] leading-snug">
            {PRO_BULLETS.map((b) => (
              <li
                key={b.text}
                className="grid grid-cols-[0.9rem_minmax(0,1fr)] gap-2 text-muted-foreground"
              >
                <span aria-hidden="true" className="text-primary-ink">
                  —
                </span>
                <span>
                  {b.text}
                  {b.soon ? <span className="text-faint"> · soon</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy !== null || !pro}
            onClick={() => pro && startCheckout(pro.priceId)}
            className={primaryButtonClassName(
              "primary-action-chip-prominent mt-auto w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {busy === pro?.priceId ? "Redirecting…" : "Get started"}
          </button>
        </section>
      </div>

      {/* ── below md: the fold — rows, folded table, one button ───────────── */}
      <div
        role="radiogroup"
        aria-label="Plan"
        className="flex w-full flex-col gap-2.5 text-left md:hidden"
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedTier === "standard"}
          onClick={() => setSelectedTier("standard")}
          className={cn(
            "door-sheet tap-active grid w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-3 p-4 text-left transition-colors",
            selectedTier === "standard" && "door-sheet-hero"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 grid size-[18px] place-items-center rounded-full border",
              selectedTier === "standard" ? "border-primary" : "border-faint"
            )}
          >
            {selectedTier === "standard" ? (
              <span className="size-2 rounded-full bg-primary" />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[14.5px] font-semibold text-foreground">
                {TIER_LABELS.standard}
              </span>
              <span className="door-price-sm text-foreground">{standard?.amount ?? "—"}</span>
            </span>
            <span className="text-[12px] leading-snug text-muted-foreground">
              The smart race notebook · ask the Engineer{" "}
              <span className="font-semibold text-primary-ink">{stdDaily}</span>
            </span>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={selectedTier === "pro"}
          onClick={() => setSelectedTier("pro")}
          className={cn(
            "door-sheet tap-active grid w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-3 p-4 text-left transition-colors",
            selectedTier === "pro" && "door-sheet-hero"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 grid size-[18px] place-items-center rounded-full border",
              selectedTier === "pro" ? "border-primary" : "border-faint"
            )}
          >
            {selectedTier === "pro" ? <span className="size-2 rounded-full bg-primary" /> : null}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[14.5px] font-semibold text-foreground">{TIER_LABELS.pro}</span>
              <span className="door-price-sm text-foreground">{pro?.amount ?? "—"}</span>
            </span>
            <span className="text-[12px] leading-snug text-muted-foreground">
              <span className="font-semibold text-primary-ink">
                {PRO_ENGINEER_MONTHLY_QUESTIONS} questions a month
              </span>{" "}
              + roll centre, video, the lot
            </span>
          </span>
        </button>
      </div>

      <button
        type="button"
        aria-expanded={compareOpen}
        onClick={() => setCompareOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-elevate/10 bg-black/35 px-4 py-2.5 text-[13px] font-medium text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground md:hidden"
      >
        Compare the two, line by line
        <span aria-hidden="true" className="text-primary-ink">
          {compareOpen ? "−" : "+"}
        </span>
      </button>

      {compareOpen ? (
        <div className="w-full overflow-hidden rounded-xl border border-elevate/10 bg-black/50 backdrop-blur-md md:hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-elevate/10 bg-elevate/[0.04] text-left">
                <th className="px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  What you get
                </th>
                <th className="border-l border-elevate/10 px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {TIER_LABELS.standard}
                </th>
                <th className="border-l border-elevate/10 px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {TIER_LABELS.pro}
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-elevate/[0.07] last:border-b-0">
                  <td className="px-3 py-2 leading-snug text-muted-foreground">{row.label}</td>
                  {[row.standard, row.pro].map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "border-l border-elevate/[0.07] px-2 py-2 text-center tabular-nums",
                        v === "✓" ? "text-primary-ink" : v === "—" ? "text-faint" : "text-foreground"
                      )}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy !== null || !selected}
        onClick={() => selected && startCheckout(selected.priceId)}
        className={primaryButtonClassName(
          "primary-action-chip-prominent w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-60 md:hidden"
        )}
      >
        {busy !== null ? "Redirecting…" : "Continue to payment →"}
      </button>
    </div>
  );
}
