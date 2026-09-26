/**
 * Founding member seats: the pure rules (docs/MONETISATION_NORTH_STAR.md, "Founding seats").
 * NO database, NO Stripe, NO `server-only`, so `npm run test:founding` can prove them.
 *
 * Founder calls, 2026-09-25:
 *   - A seat is one payment for Race Engineer, for the life of the app. It covers whatever Race
 *     Engineer becomes, but not anything sold separately. The 100-questions-a-month cap stays.
 *   - Two batches, both announced up front: 25 seats at $399, then 25 at $499. The dearer second
 *     batch is the honest reason to buy now; a surprise second batch at the same price after
 *     "only 25" would read as fake scarcity in a scene this small.
 *   - On sale until the end of 31 October, Sydney time. There is no start date: the offer opens
 *     the moment the live Stripe settings exist (2026-09-26, founder: "I want it to be live
 *     now"; it was going to open at midnight 1 October, launch day).
 *   - The seats-left count shows only once fewer than ten remain in the batch: a counter stuck
 *     at "23 of 25 left" tells every visitor nobody is buying.
 *   - No seat numbers ("#7 of 50") for now: if someone is #1 days after launch they know nobody
 *     else bought. Add them later if the offer is popular.
 *
 *   - In US dollars and euros too (2026-09-26, founder: "fix before launch day the rough edge"):
 *     a US visitor whose plan cards were in US$ saw the seat in A$ and, at checkout, Stripe's
 *     own conversion of it. The seat now has its own round US$ and € amounts, shown and charged
 *     exactly when the plans on the same page are (`pickFoundingCurrency`). Matched the same day
 *     to the plans' approved overseas table (founder: "the table is a yes"): US$299 / €259, then
 *     US$369 / €319.
 *
 * The seat itself is a $0 yearly Stripe subscription on its own product (`metadata.tier` = pro),
 * so every surface that reads the Subscription row (sign-in, entitlement, the run window, teams)
 * treats a founder as Race Engineer with no special case. `foundingOffer.ts` holds the Stripe and
 * database half.
 */

import {
  DEFAULT_PRICE_CURRENCY,
  asPriceCurrency,
  type PriceCurrency,
} from "@/lib/billing/priceCurrencyLogic";

/** Stamped into `metadata.offer` on the checkout session, its payment and the seat subscription. */
export const FOUNDING_OFFER = "founding";

/** Midnight at the end of 31 October 2026 in Sydney, on AEDT (UTC+11). */
export const FOUNDING_CLOSES_AT = new Date("2026-10-31T13:00:00.000Z");

/** The last day on sale, as a driver reads it. Keep it in step with `FOUNDING_CLOSES_AT`. */
export const FOUNDING_LAST_DAY_LABEL = "31 October";

export type FoundingBatch = {
  batch: number;
  seats: number;
  /** AUD cents, charged once: the batch price's own amount. */
  amountCents: number;
  /**
   * The same seat's own round US$ and € amounts, carried by the batch price as Stripe
   * `currency_options`. Set the way the A$ ones were: the largest whole amount ending in 9 that is
   * below two years (batch 1) or two and a half years (batch 2) of Race Engineer's yearly price in
   * that currency (A$199.90, US$149.90, €129.90). Once added to a live price an amount can never
   * be changed or removed; a different amount means a new price and new STRIPE_PRICE_FOUNDING_*.
   */
  currencyAmounts: { usd: number; eur: number };
};

export const FOUNDING_BATCHES: readonly FoundingBatch[] = [
  { batch: 1, seats: 25, amountCents: 39_900, currencyAmounts: { usd: 29_900, eur: 25_900 } },
  { batch: 2, seats: 25, amountCents: 49_900, currencyAmounts: { usd: 36_900, eur: 31_900 } },
];

/** The count appears once FEWER than this many seats remain in the batch on sale. */
export const FOUNDING_SHOW_COUNT_BELOW = 10;

/**
 * The struck-through comparison: this many years of Race Engineer at its yearly price. A bare
 * "was $999" would be a price the seat never sold at; this is a real price, labelled.
 */
export const FOUNDING_COMPARE_YEARS = 5;

export type FoundingOfferState =
  | { status: "closed" }
  | { status: "sold-out" }
  | {
      status: "open";
      batch: FoundingBatch;
      /** Seats left in the batch on sale now. */
      seatsLeft: number;
      /** Whether to print `seatsLeft` at all (see `FOUNDING_SHOW_COUNT_BELOW`). */
      showCount: boolean;
      /** The batch after this one, which the band announces while the first is on sale. */
      nextBatch: FoundingBatch | null;
    };

/**
 * What the offer is doing right now.
 *
 * `sold` is the number of LIVE seats: a refunded seat is cancelled, stops counting, and goes back
 * on sale. Two buyers racing for the last seat of a batch can both pay the lower price; that seat
 * is honoured, and the next buyer simply meets the next batch.
 */
export function foundingOfferState(input: {
  sold: number;
  now: Date;
  /** The kill switch (`FOUNDING_OFFER_OFF=1`), or Stripe not configured for the offer. */
  unavailable?: boolean;
  batches?: readonly FoundingBatch[];
  closesAt?: Date;
}): FoundingOfferState {
  const batches = input.batches ?? FOUNDING_BATCHES;
  const closesAt = input.closesAt ?? FOUNDING_CLOSES_AT;
  if (input.unavailable) return { status: "closed" };
  const t = input.now.getTime();
  if (t >= closesAt.getTime()) return { status: "closed" };

  const sold = Math.max(0, Math.floor(input.sold));
  let seatsBefore = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const seatsAfter = seatsBefore + batch.seats;
    if (sold < seatsAfter) {
      const seatsLeft = seatsAfter - sold;
      return {
        status: "open",
        batch,
        seatsLeft,
        showCount: seatsLeft < FOUNDING_SHOW_COUNT_BELOW,
        nextBatch: batches[i + 1] ?? null,
      };
    }
    seatsBefore = seatsAfter;
  }
  return { status: "sold-out" };
}

/** Why the checkout refuses, in words a driver reads. Null when the offer is open. */
export function foundingClosedMessage(state: FoundingOfferState): string | null {
  switch (state.status) {
    case "open":
      return null;
    case "sold-out":
      return "Every founding seat is taken.";
    case "closed":
      return "The founding offer has closed.";
  }
}

/**
 * The seats line under the band's title, e.g. "The first 25 seats, then 25 more at $499. Until
 * 31 October." One wording for the app's band and the static landing page, which prints this
 * string as the status route hands it over.
 */
export function foundingSeatsLine(o: {
  isFirstBatch: boolean;
  seatsLeft: number | null;
  batchSeats: number;
  nextAmount: string | null;
  nextBatchSeats: number | null;
  lastDay: string;
}): string {
  if (o.isFirstBatch) {
    const seats =
      o.seatsLeft != null
        ? `${o.seatsLeft} of the first ${o.batchSeats} seats left`
        : `The first ${o.batchSeats} seats`;
    const next =
      o.nextAmount && o.nextBatchSeats ? `, then ${o.nextBatchSeats} more at ${o.nextAmount}` : "";
    return `${seats}${next}. Until ${o.lastDay}.`;
  }
  const seats =
    o.seatsLeft != null
      ? `${o.seatsLeft} ${o.seatsLeft === 1 ? "seat" : "seats"} left`
      : `The last ${o.batchSeats} seats`;
  return `The first batch sold out. ${seats}, until ${o.lastDay}.`;
}

/**
 * Cents to "$399", "€259" or "$749.50": whole amounts drop the cents. The short symbol only, as on
 * the plan cards; the currency is named once beside it ("USD, once").
 */
export function formatFoundingAmount(cents: number, currency: string = DEFAULT_PRICE_CURRENCY): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/**
 * The currency the founding band shows, and its checkout charges, for one visitor.
 *
 * It follows the plans on the same page: `plansCurrency` is the all-or-nothing answer the plan
 * cards resolved to (`getPricePlansWithAmounts`). US$ or € only when the plans are in it AND every
 * founding price the band names carries it too; otherwise A$. So a page never shows US$ plans
 * beside an A$ seat once both are priced, and never prints a figure Stripe would not charge.
 */
export function pickFoundingCurrency(
  plansCurrency: string | null | undefined,
  foundingCarries: (currency: PriceCurrency) => boolean,
): PriceCurrency {
  const wanted = asPriceCurrency(plansCurrency) ?? DEFAULT_PRICE_CURRENCY;
  if (wanted === DEFAULT_PRICE_CURRENCY) return wanted;
  return foundingCarries(wanted) ? wanted : DEFAULT_PRICE_CURRENCY;
}
