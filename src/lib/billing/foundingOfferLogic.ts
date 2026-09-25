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
 *   - On sale from midnight 1 October to the end of 31 October, Sydney time.
 *   - The seats-left count shows only once fewer than ten remain in the batch: a counter stuck
 *     at "23 of 25 left" tells every visitor nobody is buying.
 *   - No seat numbers ("#7 of 50") for now: if someone is #1 days after launch they know nobody
 *     else bought. Add them later if the offer is popular.
 *
 * The seat itself is a $0 yearly Stripe subscription on its own product (`metadata.tier` = pro),
 * so every surface that reads the Subscription row (sign-in, entitlement, the run window, teams)
 * treats a founder as Race Engineer with no special case. `foundingOffer.ts` holds the Stripe and
 * database half.
 */

/** Stamped into `metadata.offer` on the checkout session, its payment and the seat subscription. */
export const FOUNDING_OFFER = "founding";

/**
 * Midnight at the start of 1 October 2026 in Sydney. NSW is still on AEST (UTC+10) that day;
 * daylight saving starts on Sunday 4 October.
 */
export const FOUNDING_OPENS_AT = new Date("2026-09-30T14:00:00.000Z");

/** Midnight at the end of 31 October 2026 in Sydney, on AEDT (UTC+11). */
export const FOUNDING_CLOSES_AT = new Date("2026-10-31T13:00:00.000Z");

/** The last day on sale, as a driver reads it. Keep it in step with `FOUNDING_CLOSES_AT`. */
export const FOUNDING_LAST_DAY_LABEL = "31 October";

export type FoundingBatch = {
  batch: number;
  seats: number;
  /** AUD cents, charged once. */
  amountCents: number;
};

export const FOUNDING_BATCHES: readonly FoundingBatch[] = [
  { batch: 1, seats: 25, amountCents: 39_900 },
  { batch: 2, seats: 25, amountCents: 49_900 },
];

/** The count appears once FEWER than this many seats remain in the batch on sale. */
export const FOUNDING_SHOW_COUNT_BELOW = 10;

/**
 * The struck-through comparison: this many years of Race Engineer at its yearly price. A bare
 * "was $999" would be a price the seat never sold at; this is a real price, labelled.
 */
export const FOUNDING_COMPARE_YEARS = 5;

export type FoundingOfferState =
  | { status: "not-open" }
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
  opensAt?: Date;
  closesAt?: Date;
}): FoundingOfferState {
  const batches = input.batches ?? FOUNDING_BATCHES;
  const opensAt = input.opensAt ?? FOUNDING_OPENS_AT;
  const closesAt = input.closesAt ?? FOUNDING_CLOSES_AT;
  if (input.unavailable) return { status: "closed" };
  const t = input.now.getTime();
  if (t < opensAt.getTime()) return { status: "not-open" };
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
    case "not-open":
      return "Founding seats go on sale on 1 October.";
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

/** Cents to "$399" or "$999.50": whole dollars drop the cents, as the price cards do. */
export function formatFoundingAmount(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
