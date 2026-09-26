import "server-only";
import { cache } from "react";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getPricePlansWithAmounts, getStripe, stripeConfigured } from "@/lib/stripe";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import { isActiveSubscriptionStatus } from "@/lib/entitlementLogic";
import {
  DEFAULT_PRICE_CURRENCY,
  amountInCurrency,
  asPriceCurrency,
  type PriceCurrency,
} from "@/lib/billing/priceCurrencyLogic";
import { getVisitorPriceCurrency } from "@/lib/billing/visitorCurrency";
import {
  FOUNDING_BATCHES,
  FOUNDING_COMPARE_YEARS,
  FOUNDING_LAST_DAY_LABEL,
  formatFoundingAmount,
  foundingOfferState,
  foundingSeatsLine,
  pickFoundingCurrency,
  type FoundingBatch,
  type FoundingOfferState,
} from "@/lib/billing/foundingOfferLogic";

/**
 * Founding member seats: the Stripe and database half (the rules are in `foundingOfferLogic.ts`).
 *
 * Three Stripe prices, all on one "Founding member" product whose `metadata.tier` is `pro`:
 *   - STRIPE_PRICE_FOUNDING_1 / _2: the one-off payments, A$399 and A$499, each carrying its own
 *     US$ and € amounts as `currency_options` (US$259/US$319, €239/€299).
 *   - STRIPE_PRICE_FOUNDING_SEAT: a $0 yearly price (also $0 in US$ and €). The webhook puts each
 *     founder on a subscription to it once their payment clears, and that subscription IS the seat.
 * Until all three are set (and Stripe is), the offer shows nowhere and the checkout refuses, so
 * an environment without them is safe by default. `FOUNDING_OFFER_OFF=1` is the kill switch.
 *
 * The product's metadata.app is `rc-engineer-founding`, NOT `rc-engineer`: both Stripe setup
 * scripts find the three plan products by app + tier, and a founding product carrying the plain
 * app stamp would be picked up as Race Engineer's product and renamed.
 */

const SEAT_PRICE_ENV = "STRIPE_PRICE_FOUNDING_SEAT";
const BATCH_PRICE_ENV: Record<number, string> = {
  1: "STRIPE_PRICE_FOUNDING_1",
  2: "STRIPE_PRICE_FOUNDING_2",
};

/** Statuses that hold a seat. A refunded seat is cancelled, stops counting, and goes back on sale. */
const LIVE_SEAT_STATUSES = ["active", "trialing"];

/** Plans Stripe still holds and still bills in their own currency (as the Subscription page reads them). */
const LIVE_UNPAID_STATUSES = new Set(["past_due", "unpaid", "paused"]);

export function foundingSeatPriceId(): string | null {
  return process.env[SEAT_PRICE_ENV]?.trim() || null;
}

/** Is this the $0 seat price, i.e. is the subscription carrying it a founding seat? */
export function isFoundingSeatPrice(priceId: string | null | undefined): boolean {
  const seat = foundingSeatPriceId();
  return Boolean(seat && priceId && priceId === seat);
}

export function foundingBatchPriceId(batch: number): string | null {
  const key = BATCH_PRICE_ENV[batch];
  return key ? process.env[key]?.trim() || null : null;
}

function foundingConfigured(): boolean {
  return (
    stripeConfigured() &&
    Boolean(foundingSeatPriceId()) &&
    FOUNDING_BATCHES.every((b) => Boolean(foundingBatchPriceId(b.batch)))
  );
}

const isDevServer = () => process.env.NODE_ENV !== "production";

/**
 * Test hooks, honoured by a dev server only, never by a deployed build (Vercel builds run as
 * production). `FOUNDING_OFFER_TEST_NOW` moves the clock so the offer can be driven after it
 * closes; `FOUNDING_OFFER_TEST_BATCH_SEATS` shrinks every batch so the
 * switch to the second batch can be driven without selling 25 seats.
 */
function offerNow(): Date {
  const override = isDevServer() ? process.env.FOUNDING_OFFER_TEST_NOW?.trim() : undefined;
  if (override) {
    const d = new Date(override);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function offerBatches(): readonly FoundingBatch[] {
  const seats = isDevServer() ? Number(process.env.FOUNDING_OFFER_TEST_BATCH_SEATS) : NaN;
  return Number.isInteger(seats) && seats > 0
    ? FOUNDING_BATCHES.map((b) => ({ ...b, seats }))
    : FOUNDING_BATCHES;
}

/** Live seats: members whose Subscription row is an active subscription to the seat price. */
export async function countFoundingSeats(): Promise<number> {
  const seat = foundingSeatPriceId();
  if (!seat) return 0;
  return prisma.subscription.count({
    where: { priceId: seat, status: { in: LIVE_SEAT_STATUSES } },
  });
}

/** Does this member hold a live founding seat? */
export async function holdsFoundingSeat(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { priceId: true, status: true },
  });
  return Boolean(sub && isFoundingSeatPrice(sub.priceId) && LIVE_SEAT_STATUSES.includes(sub.status));
}

export async function getFoundingOfferState(): Promise<FoundingOfferState> {
  const unavailable = process.env.FOUNDING_OFFER_OFF === "1" || !foundingConfigured();
  const sold = unavailable ? 0 : await countFoundingSeats();
  return foundingOfferState({ sold, now: offerNow(), unavailable, batches: offerBatches() });
}

/**
 * The currency a signed-in member's pages are priced in, by the Subscription page's own rule: a
 * plan Stripe still holds bills in its own currency, so everything they are shown is priced in it;
 * otherwise the currency of where they are. The founding checkout calls this so it charges what
 * /billing showed them.
 */
export async function memberPriceCurrency(userId: string): Promise<PriceCurrency> {
  const visitor = await getVisitorPriceCurrency();
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { stripeSubscriptionId: true, status: true },
  });
  const live = sub && (isActiveSubscriptionStatus(sub.status) || LIVE_UNPAID_STATUSES.has(sub.status));
  if (!live || !stripeConfigured()) return visitor;
  try {
    const subscription = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    return asPriceCurrency(subscription.currency) ?? visitor;
  } catch (error) {
    console.error(`[founding] could not read the currency of ${sub.stripeSubscriptionId}`, error);
    return visitor;
  }
}

/** A founding price with its US$ and € amounts. Memoised per request; null when Stripe can't answer. */
const retrieveFoundingPrice = cache(async function retrieveFoundingPrice(
  priceId: string,
): Promise<Stripe.Price | null> {
  if (!stripeConfigured()) return null;
  try {
    return await getStripe().prices.retrieve(priceId, { expand: ["currency_options"] });
  } catch (error) {
    console.error(`[founding] could not load price ${priceId}`, error);
    return null;
  }
});

function carries(price: Stripe.Price | null, currency: PriceCurrency): boolean {
  return Boolean(price && amountInCurrency(price, currency).currency === currency);
}

type FoundingPricing = {
  state: Extract<FoundingOfferState, { status: "open" }>;
  currency: PriceCurrency;
  amountCents: number;
  nextAmountCents: number | null;
  /** Race Engineer's yearly price in `currency`, for the labelled comparison; null when unknown. */
  yearlyCents: number | null;
};

/**
 * What is on sale for a visitor priced in `wanted`, in the currency the band will show and the
 * checkout will charge (`pickFoundingCurrency`): the plans' own answer for that visitor, used only
 * when every founding price the band names carries it. Amounts come from Stripe, so the page can't
 * print a figure checkout won't charge. Null when nothing is on sale.
 */
async function resolveFoundingPricing(wanted: PriceCurrency): Promise<FoundingPricing | null> {
  const state = await getFoundingOfferState();
  if (state.status !== "open") return null;
  const batchPriceId = foundingBatchPriceId(state.batch.batch);
  const nextPriceId = state.nextBatch ? foundingBatchPriceId(state.nextBatch.batch) : null;
  const [plans, batchPrice, nextPrice] = await Promise.all([
    getPricePlansWithAmounts(wanted),
    batchPriceId ? retrieveFoundingPrice(batchPriceId) : null,
    nextPriceId ? retrieveFoundingPrice(nextPriceId) : null,
  ]);

  const annual = plans.find((p) => p.tier === "pro" && p.interval === "year");
  const currency = pickFoundingCurrency(
    annual?.currency,
    (c) => carries(batchPrice, c) && (!state.nextBatch || carries(nextPrice, c)),
  );

  // Stripe's own amounts; the A$ constants only when Stripe couldn't be read (they are what the
  // setup script wrote, so the checkout still charges exactly this).
  const amountCents =
    (batchPrice ? amountInCurrency(batchPrice, currency).unitAmount : null) ?? state.batch.amountCents;
  const nextAmountCents = state.nextBatch
    ? ((nextPrice ? amountInCurrency(nextPrice, currency).unitAmount : null) ??
      state.nextBatch.amountCents)
    : null;

  // The comparison is in the seat's currency. It only differs from the plans' when the seat fell
  // back to A$, and then it is read in A$ too.
  const comparePlans =
    annual?.currency === currency ? plans : await getPricePlansWithAmounts(DEFAULT_PRICE_CURRENCY);
  const compareAnnual = comparePlans.find((p) => p.tier === "pro" && p.interval === "year");
  const yearlyCents =
    compareAnnual?.unitAmount != null && compareAnnual.currency === currency
      ? compareAnnual.unitAmount
      : null;

  return { state, currency, amountCents, nextAmountCents, yearlyCents };
}

/**
 * The currency to hand the founding checkout: US$ or € when the band showed it, else nothing (the
 * session stays A$, and Stripe's Adaptive Pricing may convert it, as it does for the plans).
 */
export async function foundingCheckoutCurrency(wanted: PriceCurrency): Promise<"usd" | "eur" | undefined> {
  const pricing = await resolveFoundingPricing(wanted);
  const c = pricing?.currency;
  return c === "usd" || c === "eur" ? c : undefined;
}

/** What the founding band prints. Every amount is already formatted. */
export type FoundingOfferView = {
  /** The price of the batch on sale, e.g. "$399". */
  amount: string;
  /** "AUD", "USD" or "EUR", printed beside the price ("USD, once") and the comparison. */
  currency: string;
  /** "5 years of Race Engineer", or null when the yearly price couldn't be read. */
  compareLabel: string | null;
  /** "$999.50", struck through on the band. */
  compareAmount: string | null;
  /** Printed only when few remain; null means don't print a count. */
  seatsLeft: number | null;
  /** Seats in the batch on sale. */
  batchSeats: number;
  isFirstBatch: boolean;
  /** The next batch's price, announced while the first is on sale. */
  nextAmount: string | null;
  nextBatchSeats: number | null;
  lastDay: string;
  /** "The first 25 seats, then 25 more at $499. Until 31 October." */
  seatsLine: string;
};

/**
 * The band's content for a visitor priced in `wanted` (the visitor's currency, or a member's own),
 * or null when nothing is on sale (sold out, closed, or switched off).
 */
export async function getFoundingOfferView(
  wanted: PriceCurrency = DEFAULT_PRICE_CURRENCY,
): Promise<FoundingOfferView | null> {
  const pricing = await resolveFoundingPricing(wanted);
  if (!pricing) return null;
  const { state, currency, amountCents, nextAmountCents, yearlyCents } = pricing;

  // Five years at Race Engineer's LIVE yearly price in the same currency, so it can never drift from
  // what the plan actually costs. A failed read drops the comparison rather than guessing.
  const compareCents = yearlyCents != null ? yearlyCents * FOUNDING_COMPARE_YEARS : null;
  const showCompare = compareCents != null && compareCents > amountCents;

  const view: Omit<FoundingOfferView, "seatsLine"> = {
    amount: formatFoundingAmount(amountCents, currency),
    currency: currency.toUpperCase(),
    compareLabel: showCompare ? `${FOUNDING_COMPARE_YEARS} years of ${TIER_LABELS.pro}` : null,
    compareAmount:
      showCompare && compareCents != null ? formatFoundingAmount(compareCents, currency) : null,
    seatsLeft: state.showCount ? state.seatsLeft : null,
    batchSeats: state.batch.seats,
    isFirstBatch: state.batch.batch === 1,
    nextAmount: nextAmountCents != null ? formatFoundingAmount(nextAmountCents, currency) : null,
    nextBatchSeats: state.nextBatch?.seats ?? null,
    lastDay: FOUNDING_LAST_DAY_LABEL,
  };
  return { ...view, seatsLine: foundingSeatsLine(view) };
}
