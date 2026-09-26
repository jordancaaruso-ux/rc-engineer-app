import { NextResponse } from "next/server";
import { getPricePlansWithAmounts, type PricePlanWithAmount } from "@/lib/stripe";
import { formatPlanAmount, type PriceCurrency } from "@/lib/billing/priceCurrencyLogic";
import { getVisitorPriceCurrency } from "@/lib/billing/visitorCurrency";

export const dynamic = "force-dynamic";

/**
 * The plan prices in this visitor's currency, for the landing page (`public/landing/index.html`).
 * The landing is a static file written in AUD; it swaps in these figures, keyed
 * `<tier>-<interval>` ("pro-month": "$14.99"), and keeps its AUD if this fails.
 *
 * Public (middleware exempts it) and read-only. Memoised briefly per instance and currency, so a
 * busy launch morning costs a few Stripe reads a minute, not five per visitor.
 */
const memo = new Map<PriceCurrency, { at: number; plans: PricePlanWithAmount[] }>();
const MEMO_MS = 60_000;

export async function GET(): Promise<Response> {
  const wanted = await getVisitorPriceCurrency();
  const now = Date.now();
  let hit = memo.get(wanted);
  if (!hit || now - hit.at > MEMO_MS) {
    const plans = await getPricePlansWithAmounts(wanted).catch((error) => {
      console.error("[plan-prices] could not read the prices", error);
      return [] as PricePlanWithAmount[];
    });
    hit = { at: now, plans };
    memo.set(wanted, hit);
  }

  const prices: Record<string, string> = {};
  let currency: string | null = null;
  for (const p of hit.plans) {
    const amount = formatPlanAmount(p.unitAmount, p.currency);
    if (!amount || p.tier === "none") continue;
    prices[`${p.tier}-${p.interval}`] = amount;
    currency = p.currency;
  }
  return NextResponse.json(
    { currency: currency ? currency.toUpperCase() : null, prices },
    { headers: { "Cache-Control": "no-store" } }
  );
}
