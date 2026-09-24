"use client";

import { useState } from "react";
import { outlineButtonClassName, primaryButtonClassName } from "@/components/ui/ButtonLink";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import type { PaidTier } from "@/lib/entitlementLogic";
import { cn } from "@/lib/utils";
import {
  COMPARE_ROWS,
  INTERVAL_SUFFIX,
  PLAN_BULLETS,
  PLAN_STAT,
  PLAN_TAGLINE,
  PlanHook,
  type PlanBullet,
} from "@/components/billing/planCopy";

export type JoinPlan = {
  tier: PaidTier;
  interval: "month" | "year";
  priceId: string;
  /** Formatted amount, e.g. "$9.99" — null when Stripe couldn't be read (render em dash). */
  amount: string | null;
};

/**
 * Every word on these cards comes from `planCopy.tsx`, shared with the in-app Subscription page
 * (2026-09-15) so the two can never sell different products; the notes on feature truth, the
 * Engineer taste and video live there. What stays here is how the signed-out door draws them.
 *
 * The same truth renders twice (2026-08-15 redesign): as prose bullets on the desktop cards,
 * and as the fold-out comparison table on the phone. Both read from planCopy.
 */

/**
 * Both plan buttons are the same box and the same voice — only the fill does the
 * recommending (founder 2026-08-25: side by side they read as two different components).
 * The Race Engineer button used to carry `.primary-action-chip-prominent`, which brought
 * uppercase, wider tracking, its own padding and `line-height: 1` with it; the explicit
 * min-height keeps the two boxes equal whichever line-height wins the cascade.
 */
const PLAN_BUTTON_BOX =
  "mt-auto min-h-[46px] w-full px-4 py-3 text-sm font-semibold normal-case tracking-normal disabled:cursor-not-allowed disabled:opacity-60";

function PlanBullets({ items }: { items: PlanBullet[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-2 text-[13px] leading-snug">
      {items.map((b) => (
        <li
          key={b.text}
          className={cn(
            "grid grid-cols-[0.9rem_minmax(0,1fr)] gap-2",
            b.off ? "text-faint" : "text-muted-foreground"
          )}
        >
          <span aria-hidden="true" className={b.off ? "text-faint" : "text-primary-ink"}>
            {b.off ? "×" : "—"}
          </span>
          <span>{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One radio row of the phone fold — the same box for every plan, only the copy differs. */
function PlanRow({
  tier,
  amount,
  selected,
  onSelect,
  hook,
}: {
  tier: PaidTier;
  amount: string | null;
  selected: boolean;
  onSelect: () => void;
  hook: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "door-sheet tap-active grid w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-3 p-4 text-left transition-colors",
        selected && "door-sheet-hero"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-[18px] place-items-center rounded-full border",
          selected ? "border-primary" : "border-faint"
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[14.5px] font-semibold text-foreground">{TIER_LABELS[tier]}</span>
          <span className="door-price-sm text-foreground">{amount ?? "—"}</span>
        </span>
        <span className="text-[12px] leading-snug text-muted-foreground">{hook}</span>
      </span>
    </button>
  );
}

/**
 * The /join decision surface, redesigned 2026-08-15 onto the door scene (see the page file for
 * the shape). One component, two arrangements off a single `md:` fold — the width where the
 * plan cards stop fitting side by side:
 *
 *   - md+: two or three frosted cards (the login sheet recipe), each with its own checkout button.
 *   - below md: the cards fold into radio rows with Race Engineer pre-selected, the
 *     comparison table folds behind "line by line", and ONE button commits — the founder's
 *     phone verdict on the stacked-cards version was "too much vertical space", and the fold
 *     takes start-to-button from ~1,400px to under a screen.
 *
 * Starter (docs/STARTER_TIER_PLAN.md, 2026-09-09) is the third card, cheapest first. It is
 * monthly only, so the interval toggle never applies to it, and it appears only once its price
 * is configured — until then this is the two-tier page it was.
 *
 * Yellow-active billing toggle: deliberate departure from `PillToggle` (whose active segment
 * is neutral by app rule). These pages follow the LANDING's grammar — yellow closes the sale —
 * and the app-side rule stays untouched because this toggle is bespoke here.
 *
 * Posts to /api/billing/public-checkout; Stripe collects the email and the webhook provisions
 * the account (MONETISATION_NORTH_STAR.md Phase 1, unchanged).
 */
export function JoinPlansClient({
  plans,
  prefillEmail = null,
  fromApp = false,
}: {
  plans: JoinPlan[];
  /** From the app's welcome email: checkout opens with this address already in. */
  prefillEmail?: string | null;
  fromApp?: boolean;
}) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [selectedTier, setSelectedTier] = useState<PaidTier>("pro");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const hasStarter = plans.some((p) => p.tier === "starter");
  const plan = (tier: PaidTier) =>
    plans.find(
      (p) => p.tier === tier && p.interval === (tier === "starter" ? "month" : interval)
    ) ?? null;

  async function startCheckout(priceId: string) {
    setBusy(priceId);
    setError(null);
    try {
      const res = await fetch("/api/billing/public-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId,
          ...(prefillEmail ? { email: prefillEmail } : {}),
          ...(fromApp ? { from: "app" } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  const starter = hasStarter ? plan("starter") : null;
  const standard = plan("standard");
  const pro = plan("pro");
  const selected = plan(selectedTier);
  const suffix = INTERVAL_SUFFIX[interval];
  const tierColumns: PaidTier[] = hasStarter ? ["starter", "standard", "pro"] : ["standard", "pro"];

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
                  ? "primary-face bg-primary text-primary-foreground"
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

      {/* ── md+: the sheets ──────────────────────────────────────────────── */}
      <div
        className={cn(
          "hidden w-full gap-4 text-left md:grid",
          hasStarter ? "md:grid-cols-3" : "md:grid-cols-2"
        )}
      >
        {hasStarter ? (
          <section className="door-sheet flex flex-col gap-3 p-6" aria-label={TIER_LABELS.starter}>
            <p className="micro-caps tracking-[0.18em] text-faint">{TIER_LABELS.starter}</p>
            <h2 className="text-[15px] font-semibold leading-snug">{PLAN_TAGLINE.starter}</h2>
            <p className="door-price">
              {starter?.amount ?? "—"}
              <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
                {INTERVAL_SUFFIX.month}
              </span>
            </p>
            <div className="flex items-baseline justify-between gap-3 rounded-lg border border-elevate/10 bg-elevate/[0.04] px-3 py-2">
              <span className="micro-caps text-faint">{PLAN_STAT.starter.label}</span>
              <span className="fig-stat font-semibold text-foreground">
                {PLAN_STAT.starter.value}
              </span>
            </div>
            <PlanBullets items={PLAN_BULLETS.starter} />
            <button
              type="button"
              disabled={busy !== null || !starter}
              onClick={() => starter && startCheckout(starter.priceId)}
              className={outlineButtonClassName(
                cn(PLAN_BUTTON_BOX, "bg-transparent hover:border-faint hover:bg-elevate/5")
              )}
            >
              {busy === starter?.priceId ? "Redirecting…" : "Get started"}
            </button>
          </section>
        ) : null}

        <section className="door-sheet flex flex-col gap-3 p-6" aria-label={TIER_LABELS.standard}>
          <p className="micro-caps tracking-[0.18em] text-faint">{TIER_LABELS.standard}</p>
          <h2 className="text-[15px] font-semibold leading-snug">{PLAN_TAGLINE.standard}</h2>
          <p className="door-price">
            {standard?.amount ?? "—"}
            <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
              {suffix}
            </span>
          </p>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-elevate/10 bg-elevate/[0.04] px-3 py-2">
            <span className="micro-caps text-faint">{PLAN_STAT.standard.label}</span>
            <span className="fig-stat font-semibold text-foreground">{PLAN_STAT.standard.value}</span>
          </div>
          <PlanBullets items={PLAN_BULLETS.standard} />
          <button
            type="button"
            disabled={busy !== null || !standard}
            onClick={() => standard && startCheckout(standard.priceId)}
            className={outlineButtonClassName(
              cn(PLAN_BUTTON_BOX, "bg-transparent hover:border-faint hover:bg-elevate/5")
            )}
          >
            {busy === standard?.priceId ? "Redirecting…" : "Get started"}
          </button>
        </section>

        <section
          className="door-sheet door-sheet-hero flex flex-col gap-3 p-6"
          aria-label={TIER_LABELS.pro}
        >
          <p className="micro-caps tracking-[0.18em] text-primary-ink">{TIER_LABELS.pro}</p>
          <h2 className="text-[15px] font-semibold leading-snug">{PLAN_TAGLINE.pro}</h2>
          <p className="door-price">
            {pro?.amount ?? "—"}
            <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
              {suffix}
            </span>
          </p>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2">
            <span className="micro-caps text-faint">{PLAN_STAT.pro.label}</span>
            <span className="fig-stat font-semibold text-primary-ink">{PLAN_STAT.pro.value}</span>
          </div>
          <PlanBullets items={PLAN_BULLETS.pro} />
          <button
            type="button"
            disabled={busy !== null || !pro}
            onClick={() => pro && startCheckout(pro.priceId)}
            className={primaryButtonClassName(PLAN_BUTTON_BOX)}
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
        {hasStarter ? (
          <PlanRow
            tier="starter"
            amount={starter?.amount ?? null}
            selected={selectedTier === "starter"}
            onSelect={() => setSelectedTier("starter")}
            hook={<PlanHook tier="starter" />}
          />
        ) : null}

        <PlanRow
          tier="standard"
          amount={standard?.amount ?? null}
          selected={selectedTier === "standard"}
          onSelect={() => setSelectedTier("standard")}
          hook={<PlanHook tier="standard" />}
        />

        <PlanRow
          tier="pro"
          amount={pro?.amount ?? null}
          selected={selectedTier === "pro"}
          onSelect={() => setSelectedTier("pro")}
          hook={<PlanHook tier="pro" />}
        />
      </div>

      <button
        type="button"
        aria-expanded={compareOpen}
        onClick={() => setCompareOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-elevate/10 bg-black/35 px-4 py-2.5 text-[13px] font-medium text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground md:hidden"
      >
        {hasStarter ? "Compare them, line by line" : "Compare the two, line by line"}
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
                {tierColumns.map((tier) => (
                  <th
                    key={tier}
                    className="border-l border-elevate/10 px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint"
                  >
                    {TIER_LABELS[tier]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-elevate/[0.07] last:border-b-0">
                  <td className="px-3 py-2 leading-snug text-muted-foreground">{row.label}</td>
                  {tierColumns.map((tier) => {
                    const v = row[tier];
                    return (
                      <td
                        key={tier}
                        className={cn(
                          "border-l border-elevate/[0.07] px-2 py-2 text-center tabular-nums",
                          v === "✓" ? "text-primary-ink" : v === "—" ? "text-faint" : "text-foreground"
                        )}
                      >
                        {v}
                      </td>
                    );
                  })}
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
