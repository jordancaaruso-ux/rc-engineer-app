import "server-only";
import { prisma } from "@/lib/prisma";
import { getPricePlansWithAmounts, stripeConfigured } from "@/lib/stripe";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import {
  FOUNDING_BATCHES,
  FOUNDING_COMPARE_YEARS,
  FOUNDING_LAST_DAY_LABEL,
  formatFoundingAmount,
  foundingOfferState,
  foundingSeatsLine,
  type FoundingBatch,
  type FoundingOfferState,
} from "@/lib/billing/foundingOfferLogic";

/**
 * Founding member seats: the Stripe and database half (the rules are in `foundingOfferLogic.ts`).
 *
 * Three Stripe prices, all on one "Founding member" product whose `metadata.tier` is `pro`:
 *   - STRIPE_PRICE_FOUNDING_1 / _2: the one-off payments, $399 and $499 AUD.
 *   - STRIPE_PRICE_FOUNDING_SEAT: a $0 yearly price. The webhook puts each founder on a
 *     subscription to it once their payment clears, and that subscription IS the seat.
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
 * production). `FOUNDING_OFFER_TEST_NOW` moves the clock so the offer can be driven before
 * 1 October or after it closes; `FOUNDING_OFFER_TEST_BATCH_SEATS` shrinks every batch so the
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

/** What the founding band prints. Every amount is already formatted. */
export type FoundingOfferView = {
  /** The price of the batch on sale, e.g. "$399". */
  amount: string;
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

/** The band's content, or null when nothing is on sale (not yet open, sold out, closed, off). */
export async function getFoundingOfferView(): Promise<FoundingOfferView | null> {
  const state = await getFoundingOfferState();
  if (state.status !== "open") return null;

  // The comparison is five years at Race Engineer's LIVE yearly price, so it can never drift from
  // what the plan actually costs. A failed read drops the comparison rather than guessing.
  let compareCents: number | null = null;
  try {
    const plans = await getPricePlansWithAmounts();
    const annual = plans.find((p) => p.tier === "pro" && p.interval === "year");
    if (annual?.unitAmount != null && annual.currency?.toLowerCase() === "aud") {
      compareCents = annual.unitAmount * FOUNDING_COMPARE_YEARS;
    }
  } catch {
    compareCents = null;
  }
  const showCompare = compareCents != null && compareCents > state.batch.amountCents;

  const view: Omit<FoundingOfferView, "seatsLine"> = {
    amount: formatFoundingAmount(state.batch.amountCents),
    compareLabel: showCompare ? `${FOUNDING_COMPARE_YEARS} years of ${TIER_LABELS.pro}` : null,
    compareAmount: showCompare && compareCents != null ? formatFoundingAmount(compareCents) : null,
    seatsLeft: state.showCount ? state.seatsLeft : null,
    batchSeats: state.batch.seats,
    isFirstBatch: state.batch.batch === 1,
    nextAmount: state.nextBatch ? formatFoundingAmount(state.nextBatch.amountCents) : null,
    nextBatchSeats: state.nextBatch?.seats ?? null,
    lastDay: FOUNDING_LAST_DAY_LABEL,
  };
  return { ...view, seatsLine: foundingSeatsLine(view) };
}
