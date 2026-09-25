import { redirect } from "next/navigation";
import { requireCurrentUserAllowUnpaid } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { getEntitlement } from "@/lib/entitlement";
import {
  isActiveSubscriptionStatus,
  isBillingEnforced,
  type PaidTier,
} from "@/lib/entitlementLogic";
import {
  getPricePlansWithAmounts,
  getStripe,
  stripeConfigured,
  type PricePlanWithAmount,
} from "@/lib/stripe";
import { TIER_LABELS, tierLabel } from "@/lib/brand/brandNames";
import { formatRunDateOnly } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import {
  BillingClient,
  type BillingMode,
  type CurrentPlan,
  type MemberPlan,
} from "@/components/billing/BillingClient";
import { FoundingBand } from "@/components/billing/FoundingBand";
import { ShellPlanNotice } from "@/components/billing/ShellPlanNotice";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelTitle } from "@/components/ui/panel";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import { getFoundingOfferView, isFoundingSeatPrice } from "@/lib/billing/foundingOffer";
import { formatFoundingAmount } from "@/lib/billing/foundingOfferLogic";

export const metadata = { title: "Subscription" };

const PAID_TIERS = new Set<string>(["starter", "standard", "pro"]);

/** Stripe still holds these and still wants paying: selling another plan on top would stack two. */
const LIVE_UNPAID_STATUSES = new Set(["past_due", "unpaid", "paused"]);

function asPaidTier(tier: string): PaidTier | null {
  return PAID_TIERS.has(tier) ? (tier as PaidTier) : null;
}

function formatAmount(
  unitAmount: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (unitAmount == null || !currency) return null;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(unitAmount / 100);
}

/**
 * What this member actually pays. Usually one of today's prices, but not always: Stripe prices are
 * immutable, so a member who joined before a reprice keeps their old one (the $14.99 Notebook, the
 * $279.90 annual). Those are looked up on their own; a failed lookup shows no figure rather than a
 * wrong one.
 */
async function memberPrice(
  priceId: string,
  listed: PricePlanWithAmount[]
): Promise<{ amount: string | null; interval: "month" | "year" | null }> {
  const hit = listed.find((p) => p.priceId === priceId);
  if (hit) return { amount: formatAmount(hit.unitAmount, hit.currency), interval: hit.interval };
  if (!stripeConfigured()) return { amount: null, interval: null };
  try {
    const price = await getStripe().prices.retrieve(priceId);
    const iv = price.recurring?.interval;
    return {
      amount: formatAmount(price.unit_amount, price.currency),
      interval: iv === "year" || iv === "month" ? iv : null,
    };
  } catch (error) {
    console.error(`[billing] could not load the member's own price ${priceId}`, error);
    return { amount: null, interval: null };
  }
}

/**
 * Subscription: the member's plan and the three plans, rebuilt 2026-09-15 (see `BillingClient`).
 * Uses `requireCurrentUserAllowUnpaid` — `requireCurrentUser` bounces unpaid users HERE (the shell
 * gate), so this page must stay reachable without a subscription or the redirect would loop.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireCurrentUserAllowUnpaid();
  const entitlement = await getEntitlement(user);
  // Inside the native shell the plan is shown, never sold — see `lib/nativeShell.ts`.
  if (await isNativeShellRequest()) {
    // An account the app's sign-up made, with no plan yet, waits on its own screen
    // (`/login/signed-up`). A lapsed payer keeps this notice.
    if (!entitlement.entitled) {
      const sub = await prisma.subscription.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!sub) redirect("/login/signed-up");
    }
    return <ShellPlanNotice tierLabel={entitlement.entitled ? tierLabel(entitlement.tier) : null} />;
  }

  const [sub, listed, timeZone, params] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId: user.id } }),
    getPricePlansWithAmounts(),
    getExplicitTimeZoneForRunFormatting(),
    searchParams,
  ]);

  const plans: MemberPlan[] = listed.flatMap((p) => {
    const tier = asPaidTier(p.tier);
    return tier
      ? [{ tier, interval: p.interval, priceId: p.priceId, amount: formatAmount(p.unitAmount, p.currency) }]
      : [];
  });

  const subTier = sub ? asPaidTier(sub.tier) : null;
  let current: CurrentPlan | null = null;
  if (sub && subTier) {
    const own = sub.priceId ? await memberPrice(sub.priceId, listed) : null;
    // No price on the row (dev fixtures, rows written before the column existed): fall back to
    // the tier's monthly list price rather than showing nothing.
    const list = plans.find((p) => p.tier === subTier && p.interval === "month") ?? null;
    current = {
      tier: subTier,
      status: sub.status,
      amount: own ? own.amount : (list?.amount ?? null),
      interval: own ? own.interval : list ? "month" : null,
      periodEndLabel: sub.currentPeriodEnd
        ? formatRunDateOnly(sub.currentPeriodEnd, timeZone)
        : null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }

  // Read off the row, not the entitlement: with billing dark the entitlement says "full access"
  // for everyone, and that must not re-open checkout to a payer.
  const mode: BillingMode =
    sub && isActiveSubscriptionStatus(sub.status)
      ? "switch"
      : sub && LIVE_UNPAID_STATUSES.has(sub.status)
        ? "fix"
        : entitlement.grandfathered
          ? "view"
          : "choose";

  const changed = Array.isArray(params.changed) ? params.changed[0] : params.changed;
  // A locked door names the plan it sells (`?plan=standard`); the phone opens with it picked.
  const planParam = Array.isArray(params.plan) ? params.plan[0] : params.plan;

  // The standard header, not a bare <h1>: on a phone the title has to clear the corner pills, and
  // the bare heading sat under the JRC mark (2026-09-05 pre-release walk).
  const header = (
    <header className="page-header">
      <div className="min-w-0">
        <h1 className="page-title">Subscription</h1>
      </div>
    </header>
  );

  // A founding member holds Race Engineer for the life of the app. Nothing to switch, and no
  // portal: its Cancel would end the seat, and a founder has no card or renewal to manage.
  if (sub && isFoundingSeatPrice(sub.priceId) && isActiveSubscriptionStatus(sub.status)) {
    const receipt = await founderReceipt(sub.stripeSubscriptionId, timeZone);
    const line = ["Founding member", receipt.paid ? `${receipt.paid} once` : null, receipt.on]
      .filter(Boolean)
      .join(" · ");
    return (
      <>
        {header}
        <section className="page-body">
          <CardPanel contentClassName="p-4 lg:p-5">
            <Eyebrow>Your plan</Eyebrow>
            <PanelTitle>{TIER_LABELS.pro}</PanelTitle>
            <p className="mt-1 text-[13px] tabular-nums text-muted-foreground">{line}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Yours for the life of the app. Nothing renews.
            </p>
          </CardPanel>
        </section>
      </>
    );
  }

  // Founding seats (1 to 31 October 2026) are sold here too, to anyone who pays for their own
  // access; an admin's free access has nothing to replace.
  const founding = mode === "view" ? null : await getFoundingOfferView();

  return (
    <>
      {header}
      <section className="page-body">
        <BillingClient
          plans={plans}
          current={current}
          mode={mode}
          hasCustomer={Boolean(user.stripeCustomerId)}
          enforced={isBillingEnforced()}
          justChanged={changed === "1"}
          initialPlan={planParam ? asPaidTier(planParam) : null}
        />
        {founding ? <FoundingBand offer={founding} variant="paper" /> : null}
      </section>
    </>
  );
}

/** What a founder paid and when, off the seat subscription Stripe holds. Best-effort. */
async function founderReceipt(
  stripeSubscriptionId: string,
  timeZone: Awaited<ReturnType<typeof getExplicitTimeZoneForRunFormatting>>
): Promise<{ paid: string | null; on: string | null }> {
  if (!stripeConfigured()) return { paid: null, on: null };
  try {
    const seat = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
    const cents = Number(seat.metadata?.paid_cents);
    return {
      paid: Number.isFinite(cents) && cents > 0 ? formatFoundingAmount(cents) : null,
      on: seat.created ? formatRunDateOnly(new Date(seat.created * 1000), timeZone) : null,
    };
  } catch (error) {
    console.error(`[billing] could not load the founding seat ${stripeSubscriptionId}`, error);
    return { paid: null, on: null };
  }
}
