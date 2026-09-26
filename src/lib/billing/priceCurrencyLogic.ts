/**
 * Which currency a visitor's plan prices are shown and charged in (2026-09-25, founder call).
 *
 * Every live price is set in AUD, with round US-dollar and euro amounts added to the same Stripe
 * price as `currency_options` (US$14.99 / €12.99 for Race Engineer, not a converted A$19.99).
 * A visitor in the US sees and pays the US$ amount, one in the euro area the € amount, and
 * everyone else sees AUD on our pages. Stripe's checkout may still convert AUD into their own
 * money (Adaptive Pricing, a dashboard switch), which never applies to USD or EUR once a price
 * carries its own amount there.
 *
 * The country comes from Vercel's `x-vercel-ip-country` header; locally there is none, so AUD.
 */

export type PriceCurrency = "aud" | "usd" | "eur";

export const DEFAULT_PRICE_CURRENCY: PriceCurrency = "aud";

/** The US and the territories that bank in US dollars. */
const USD_COUNTRIES = new Set(["US", "PR", "GU", "VI", "AS", "MP"]);

/**
 * The euro area as of 2026 (Bulgaria joined on 1 January 2026), plus the microstates that use the
 * euro by agreement with the EU.
 */
const EUR_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PT", "SK", "SI", "ES",
  "AD", "MC", "SM", "VA",
]);

export function priceCurrencyForCountry(country: string | null | undefined): PriceCurrency {
  const code = country?.trim().toUpperCase();
  if (!code) return DEFAULT_PRICE_CURRENCY;
  if (USD_COUNTRIES.has(code)) return "usd";
  if (EUR_COUNTRIES.has(code)) return "eur";
  return DEFAULT_PRICE_CURRENCY;
}

/** Narrow a currency Stripe reports (any case) to one we price in, or null. */
export function asPriceCurrency(currency: string | null | undefined): PriceCurrency | null {
  const c = currency?.trim().toLowerCase();
  return c === "aud" || c === "usd" || c === "eur" ? c : null;
}

type PriceLike = {
  currency: string;
  unit_amount: number | null;
  currency_options?: Record<string, { unit_amount?: number | null } | undefined> | null;
};

/**
 * The amount to show for one price in `wanted`, or the price's own (AUD) amount when it has no
 * option in that currency. Needs the price retrieved with `expand: ["currency_options"]`.
 */
export function amountInCurrency(
  price: PriceLike,
  wanted: PriceCurrency
): { unitAmount: number | null; currency: string } {
  if (price.currency.toLowerCase() === wanted) {
    return { unitAmount: price.unit_amount, currency: price.currency.toLowerCase() };
  }
  const option = price.currency_options?.[wanted];
  if (option && option.unit_amount != null) {
    return { unitAmount: option.unit_amount, currency: wanted };
  }
  return { unitAmount: price.unit_amount, currency: price.currency.toLowerCase() };
}

/**
 * "$14.99", "€12.99", "$19.99". The currency itself is named once, in the interval suffix
 * ("USD / month"), so the figure keeps the short symbol.
 */
export function formatPlanAmount(
  unitAmount: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (unitAmount == null || !currency) return null;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "narrowSymbol",
  }).format(unitAmount / 100);
}

/** "USD / month". */
export function intervalSuffix(currency: string | null | undefined, interval: "month" | "year"): string {
  return `${(currency || DEFAULT_PRICE_CURRENCY).toUpperCase()} / ${interval}`;
}
