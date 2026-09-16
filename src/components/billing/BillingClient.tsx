"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelTitle } from "@/components/ui/panel";
import { PillToggle, type PillToggleOption } from "@/components/ui/PillToggle";
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
  PLAN_TIERS,
  PlanHook,
  type PlanBullet,
} from "@/components/billing/planCopy";

export type MemberPlan = {
  tier: PaidTier;
  interval: "month" | "year";
  priceId: string;
  /** Formatted list price, e.g. "$9.99"; null when Stripe couldn't be read. */
  amount: string | null;
};

export type CurrentPlan = {
  tier: PaidTier;
  status: string;
  /** What THIS member pays, which can be an older price than today's list. */
  amount: string | null;
  interval: "month" | "year" | null;
  /** Renewal or end date, already formatted in the viewer's timezone on the server. */
  periodEndLabel: string | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * What the plan buttons do, decided on the server from the Subscription row:
 *  - switch: a live, paid-up subscription. Every change is Stripe's portal changing the price on
 *    the subscription they already hold, prorated. Never a second checkout: `/api/billing/checkout`
 *    would sell them a second subscription (docs/STARTER_TIER_PLAN.md).
 *  - fix: Stripe still holds the subscription but can't collect (past due, unpaid, paused).
 *    Buying again would stack a second one, so the only door is the portal, to fix payment.
 *  - choose: no live subscription (never had one, or it ended). The buttons start checkout.
 *  - view: full access without a subscription (admins). The plans show; nothing is sold.
 */
export type BillingMode = "switch" | "fix" | "choose" | "view";

const RANK: Record<PaidTier, number> = { starter: 0, standard: 1, pro: 2 };

const BUTTON_BOX =
  "min-h-[44px] w-full px-4 py-2.5 text-sm font-semibold normal-case tracking-normal disabled:cursor-not-allowed disabled:opacity-60";

const INTERVAL_OPTIONS: ReadonlyArray<PillToggleOption<"month" | "year">> = [
  { value: "month", label: "Monthly" },
  {
    value: "year",
    label: (
      <>
        Annual <span className="text-muted-foreground">· 2 months free</span>
      </>
    ),
    ariaLabel: "Annual, two months free",
  },
];

type PlanAction =
  | { kind: "own" }
  | { kind: "go"; key: string; label: string; primary: boolean; run: () => void };

function priceLine(amount: string | null, interval: "month" | "year" | null): string | null {
  if (!amount) return null;
  return interval ? `${amount} ${INTERVAL_SUFFIX[interval]}` : amount;
}

function statusLine(mode: BillingMode, current: CurrentPlan | null): string | null {
  if (mode === "view") return "No payment needed";
  if (!current) return null;
  const price = priceLine(current.amount, current.interval);
  const date = current.periodEndLabel;
  if (mode === "switch") {
    const when = date ? `${current.cancelAtPeriodEnd ? "Ends" : "Renews"} ${date}` : null;
    return [price, when].filter(Boolean).join(" · ") || null;
  }
  if (mode === "fix") {
    return [current.status === "paused" ? "Paused" : "Payment overdue", price]
      .filter(Boolean)
      .join(" · ");
  }
  return date ? `Ended ${date}` : "Ended";
}

function Bullets({ items }: { items: PlanBullet[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px] leading-snug">
      {items.map((b) => (
        <li
          key={b.text}
          className={cn(
            "grid grid-cols-[0.9rem_minmax(0,1fr)] gap-2",
            b.off ? "text-muted-foreground/70" : "text-foreground"
          )}
        >
          <span aria-hidden="true" className="text-muted-foreground">
            {b.off ? "×" : "—"}
          </span>
          <span>
            {b.text}
            {b.off ? <span className="sr-only">, not included</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatBox({ tier }: { tier: PaidTier }) {
  const stat = PLAN_STAT[tier];
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-background/45 px-3 py-2">
      <span className="type-data-label">{stat.label}</span>
      <span className="fig-stat font-semibold text-foreground">{stat.value}</span>
    </div>
  );
}

function ActionButton({ action, busy }: { action: PlanAction | null; busy: string | null }) {
  if (!action) return null;
  if (action.kind === "own") {
    return (
      <button
        type="button"
        disabled
        className={outlineButtonClassName(cn(BUTTON_BOX, "text-muted-foreground disabled:opacity-100"))}
      >
        Your plan
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy !== null}
      onClick={action.run}
      className={action.primary ? primaryButtonClassName(BUTTON_BOX) : outlineButtonClassName(BUTTON_BOX)}
    >
      {busy === action.key ? "Opening…" : action.label}
    </button>
  );
}

/**
 * The in-app Subscription page (rebuilt 2026-09-15 after the founder called the old one
 * "unfinished"): the member's own plan on top, then the same three plans the website and /join
 * sell, with the same words (`planCopy.tsx`). Desktop shows the cards side by side; below `md:`
 * they fold into rows, a "line by line" table and one button, the /join phone pattern the
 * founder already approved ("too much vertical space" was his verdict on stacked cards).
 *
 * A member's own card shows what THEY pay, not today's list price: the family members still on
 * the old $14.99 Notebook must not see $9.99 marked as their plan.
 */
export function BillingClient({
  plans,
  current,
  mode,
  hasCustomer,
  enforced,
  justChanged,
  initialPlan = null,
}: {
  plans: MemberPlan[];
  current: CurrentPlan | null;
  mode: BillingMode;
  hasCustomer: boolean;
  enforced: boolean;
  /** Back from Stripe after a plan change: the webhook may land a moment after the redirect. */
  justChanged: boolean;
  /** The plan a locked door named (`?plan=`, "Upgrade to Notebook"): the phone opens on it. */
  initialPlan?: PaidTier | null;
}) {
  const router = useRouter();
  const tiers = PLAN_TIERS.filter((t) => plans.some((p) => p.tier === t) || current?.tier === t);
  const ownTier = (mode === "switch" || mode === "fix") && current ? current.tier : null;
  const interactive = mode === "switch" || mode === "choose";
  const hasAnnual = plans.some((p) => p.interval === "year");

  const [billingInterval, setBillingInterval] = useState<"month" | "year">(
    current?.interval === "year" ? "year" : "month"
  );
  const [selected, setSelected] = useState<PaidTier>(() => {
    if (initialPlan && initialPlan !== ownTier && tiers.includes(initialPlan)) return initialPlan;
    if (ownTier && ownTier !== "pro" && tiers.includes("pro")) return "pro";
    if (ownTier) return ownTier;
    return tiers.includes("pro") ? "pro" : (tiers[tiers.length - 1] ?? "pro");
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  // Stripe redirects back the moment the change is confirmed; its webhook usually lands within a
  // second or two, sometimes after. Look again twice so the new plan shows without a manual reload.
  useEffect(() => {
    if (!justChanged) return;
    const timers = [2500, 7000].map((ms) => window.setTimeout(() => router.refresh(), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [justChanged, router]);

  const planFor = (tier: PaidTier) =>
    plans.find(
      (p) => p.tier === tier && p.interval === (tier === "starter" ? "month" : billingInterval)
    ) ?? null;

  async function go(key: string, url: string, payload: unknown) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  function actionFor(tier: PaidTier): PlanAction | null {
    if (tier === ownTier) return { kind: "own" };
    if (!interactive) return null;
    const plan = planFor(tier);
    if (!plan) return null;
    const label = TIER_LABELS[tier];
    if (mode === "choose") {
      return {
        kind: "go",
        key: plan.priceId,
        label: `Choose ${label}`,
        primary: tier === "pro",
        run: () => void go(plan.priceId, "/api/billing/checkout", { priceId: plan.priceId }),
      };
    }
    const up = ownTier == null || RANK[tier] > RANK[ownTier];
    return {
      kind: "go",
      key: plan.priceId,
      label: `${up ? "Upgrade to" : "Switch to"} ${label}`,
      primary: up && tier === "pro",
      run: () =>
        void go(plan.priceId, "/api/billing/portal", {
          flow: "subscription_update",
          priceId: plan.priceId,
        }),
    };
  }

  /** A member's own card shows their own price; every other card shows today's list price. */
  function shownPrice(tier: PaidTier): { amount: string | null; suffix: string | null } {
    if (tier === ownTier && current?.amount) {
      return {
        amount: current.amount,
        suffix: current.interval ? INTERVAL_SUFFIX[current.interval] : null,
      };
    }
    const plan = planFor(tier);
    return { amount: plan?.amount ?? null, suffix: plan ? INTERVAL_SUFFIX[plan.interval] : null };
  }

  const line = statusLine(mode, current);
  const showStatus = mode === "view" || current != null;
  const selectedAction = actionFor(selected);

  return (
    <>
      {showStatus ? (
        <CardPanel contentClassName="p-4 lg:p-5">
          <Eyebrow>{mode === "choose" ? "Your last plan" : "Your plan"}</Eyebrow>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <PanelTitle>
                {mode === "view" || !current ? "Full access" : TIER_LABELS[current.tier]}
              </PanelTitle>
              {line ? (
                <p className="mt-1 text-[13px] tabular-nums text-muted-foreground">{line}</p>
              ) : null}
            </div>
            {hasCustomer ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void go("portal", "/api/billing/portal", {})}
                className={
                  mode === "fix"
                    ? primaryButtonClassName("px-4 py-2.5 text-sm disabled:opacity-60")
                    : outlineButtonClassName("px-4 py-2.5 text-sm disabled:opacity-60")
                }
              >
                {busy === "portal" ? "Opening…" : "Manage subscription"}
              </button>
            ) : null}
          </div>
        </CardPanel>
      ) : null}

      {interactive && hasAnnual ? (
        <div className="w-full max-w-[20rem]">
          <PillToggle
            ariaLabel="Billing interval"
            value={billingInterval}
            onChange={setBillingInterval}
            options={INTERVAL_OPTIONS}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}

      {/* ── md+: the cards ─────────────────────────────────────────────── */}
      <div
        className={cn(
          "hidden gap-3 md:grid",
          tiers.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
        )}
      >
        {tiers.map((tier) => {
          const price = shownPrice(tier);
          return (
            <CardPanel
              key={tier}
              className={cn("h-full", tier === ownTier && "border-primary-ink/35")}
              contentClassName="flex h-full flex-col gap-3 p-4 lg:p-5"
            >
              <Eyebrow>{TIER_LABELS[tier]}</Eyebrow>
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                {PLAN_TAGLINE[tier]}
              </h2>
              <p className="flex items-baseline gap-1.5">
                <span className="fig-hero font-bold text-foreground">{price.amount ?? "—"}</span>
                {price.suffix ? (
                  <span className="text-[12px] text-muted-foreground">{price.suffix}</span>
                ) : null}
              </p>
              <StatBox tier={tier} />
              <Bullets items={PLAN_BULLETS[tier]} />
              <div className="mt-auto pt-1">
                <ActionButton action={actionFor(tier)} busy={busy} />
              </div>
            </CardPanel>
          );
        })}
      </div>

      {/* ── below md: rows, the folded table, one button ─────────────────── */}
      <div
        role={interactive ? "radiogroup" : undefined}
        aria-label={interactive ? "Plan" : undefined}
        className="flex flex-col gap-2 md:hidden"
      >
        {tiers.map((tier) => {
          const own = tier === ownTier;
          const on = interactive && selected === tier;
          const body = (
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[14.5px] font-semibold text-foreground">
                  {TIER_LABELS[tier]}
                  {own ? (
                    <span className="ml-2 type-data-label text-primary-ink">Your plan</span>
                  ) : null}
                </span>
                <span className="fig-stat font-semibold text-foreground">
                  {shownPrice(tier).amount ?? "—"}
                </span>
              </span>
              <span className="text-[12px] leading-snug text-muted-foreground">
                <PlanHook tier={tier} />
              </span>
            </span>
          );
          return interactive ? (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(tier)}
              className={cn(
                "glass-card tap-active grid w-full grid-cols-[18px_minmax(0,1fr)] items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                on && "border-primary-ink/50"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-[18px] place-items-center rounded-full border",
                  on ? "border-primary-ink" : "border-border"
                )}
              >
                {on ? <span className="size-2 rounded-full bg-primary-ink" /> : null}
              </span>
              {body}
            </button>
          ) : (
            <div key={tier} className="glass-card rounded-xl border p-3.5">
              {body}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-expanded={compareOpen}
        onClick={() => setCompareOpen((v) => !v)}
        className="glass-card flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground md:hidden"
      >
        Compare them, line by line
        <span aria-hidden="true">{compareOpen ? "−" : "+"}</span>
      </button>

      {compareOpen ? (
        <div className="glass-card overflow-x-auto rounded-xl border md:hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="type-data-label px-3 py-2">What you get</th>
                {tiers.map((tier) => (
                  <th
                    key={tier}
                    className="type-data-label border-l border-border px-2 py-2 text-center"
                  >
                    {TIER_LABELS[tier]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 leading-snug text-muted-foreground">{row.label}</td>
                  {tiers.map((tier) => {
                    const v = row[tier];
                    return (
                      <td
                        key={tier}
                        className={cn(
                          "border-l border-border px-2 py-2 text-center tabular-nums",
                          v === "—" ? "text-muted-foreground/60" : "text-foreground"
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

      {interactive ? (
        <button
          type="button"
          disabled={busy !== null || selectedAction?.kind !== "go"}
          onClick={selectedAction?.kind === "go" ? selectedAction.run : undefined}
          className={primaryButtonClassName(cn(BUTTON_BOX, "md:hidden"))}
        >
          {busy !== null
            ? "Opening…"
            : selectedAction?.kind === "go"
              ? selectedAction.label
              : "Your plan"}
        </button>
      ) : null}

      {!enforced ? (
        <p className="text-[12px] text-muted-foreground">
          Billing is off on this server · everyone has full access
        </p>
      ) : null}
    </>
  );
}
