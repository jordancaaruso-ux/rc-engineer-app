/**
 * Run: `npm run test:founding`
 *
 * Proves the founding-seat rules (docs/MONETISATION_NORTH_STAR.md, "Founding seats"): when the
 * offer opens and closes in Sydney time, which batch is on sale, when the count shows, and the
 * words the band and the landing page print. The stakes: a wrong boundary sells a $499 seat for
 * $399, or keeps selling after the offer was announced as closed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOUNDING_BATCHES,
  FOUNDING_CLOSES_AT,
  FOUNDING_SHOW_COUNT_BELOW,
  formatFoundingAmount,
  foundingClosedMessage,
  foundingOfferState,
  foundingSeatsLine,
  pickFoundingCurrency,
} from "@/lib/billing/foundingOfferLogic";

const DURING = new Date("2026-10-15T00:00:00.000Z");

test("closes at the end of 31 October, Sydney time", () => {
  // Sydney is on daylight saving (UTC+11) by 31 October.
  assert.equal(FOUNDING_CLOSES_AT.toISOString(), "2026-10-31T13:00:00.000Z");
  const sydney = (d: Date) =>
    d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: false });
  assert.match(sydney(FOUNDING_CLOSES_AT), /^01\/11\/2026, (00|24):00:00$/);
});

test("on sale now, before launch, and until the moment it closes (no start date)", () => {
  // Switched on 2026-09-26, five days before the 1 October launch (founder call).
  const beforeLaunch = new Date("2026-09-26T02:00:00.000Z");
  assert.equal(foundingOfferState({ sold: 0, now: beforeLaunch }).status, "open");
  const lastMoment = new Date(FOUNDING_CLOSES_AT.getTime() - 1);
  assert.equal(foundingOfferState({ sold: 0, now: lastMoment }).status, "open");
  assert.equal(foundingOfferState({ sold: 0, now: FOUNDING_CLOSES_AT }).status, "closed");
});

test("the kill switch closes it whatever the date", () => {
  assert.equal(foundingOfferState({ sold: 0, now: DURING, unavailable: true }).status, "closed");
});

test("25 at $399, then 25 at $499, then sold out", () => {
  const first = foundingOfferState({ sold: 0, now: DURING });
  assert.equal(first.status, "open");
  if (first.status !== "open") return;
  assert.equal(first.batch.amountCents, 39_900);
  assert.equal(first.seatsLeft, 25);
  assert.equal(first.nextBatch?.amountCents, 49_900);

  const lastOfFirst = foundingOfferState({ sold: 24, now: DURING });
  assert.ok(lastOfFirst.status === "open" && lastOfFirst.batch.batch === 1);
  assert.ok(lastOfFirst.status === "open" && lastOfFirst.seatsLeft === 1);

  const second = foundingOfferState({ sold: 25, now: DURING });
  assert.ok(second.status === "open" && second.batch.batch === 2);
  assert.ok(second.status === "open" && second.batch.amountCents === 49_900);
  assert.ok(second.status === "open" && second.seatsLeft === 25);
  assert.ok(second.status === "open" && second.nextBatch === null);

  assert.equal(foundingOfferState({ sold: 50, now: DURING }).status, "sold-out");
  // Two buyers racing for the last seat can overshoot; still sold out, never negative.
  assert.equal(foundingOfferState({ sold: 51, now: DURING }).status, "sold-out");
});

test("the count shows only once fewer than ten remain in the batch", () => {
  assert.equal(FOUNDING_SHOW_COUNT_BELOW, 10);
  const at = (sold: number) => {
    const s = foundingOfferState({ sold, now: DURING });
    return s.status === "open" ? s.showCount : null;
  };
  assert.equal(at(0), false); // 25 left
  assert.equal(at(15), false); // 10 left
  assert.equal(at(16), true); // 9 left
  assert.equal(at(25), false); // second batch, 25 left again
  assert.equal(at(41), true); // 9 left in the second
});

test("batches are announced up front, cheapest first", () => {
  assert.deepEqual(
    FOUNDING_BATCHES.map((b) => [b.seats, b.amountCents]),
    [
      [25, 39_900],
      [25, 49_900],
    ],
  );
});

test("the seats line, in every state the band can be in", () => {
  const base = { batchSeats: 25, lastDay: "31 October" };
  assert.equal(
    foundingSeatsLine({ ...base, isFirstBatch: true, seatsLeft: null, nextAmount: "$499", nextBatchSeats: 25 }),
    "The first 25 seats, then 25 more at $499. Until 31 October.",
  );
  assert.equal(
    foundingSeatsLine({ ...base, isFirstBatch: true, seatsLeft: 7, nextAmount: "$499", nextBatchSeats: 25 }),
    "7 of the first 25 seats left, then 25 more at $499. Until 31 October.",
  );
  assert.equal(
    foundingSeatsLine({ ...base, isFirstBatch: false, seatsLeft: null, nextAmount: null, nextBatchSeats: null }),
    "The first batch sold out. The last 25 seats, until 31 October.",
  );
  assert.equal(
    foundingSeatsLine({ ...base, isFirstBatch: false, seatsLeft: 1, nextAmount: null, nextBatchSeats: null }),
    "The first batch sold out. 1 seat left, until 31 October.",
  );
});

test("amounts read like the price cards, in any of the three currencies", () => {
  assert.equal(formatFoundingAmount(39_900), "$399");
  assert.equal(formatFoundingAmount(99_950), "$999.50");
  assert.equal(formatFoundingAmount(25_900, "usd"), "$259");
  assert.equal(formatFoundingAmount(64_950, "usd"), "$649.50");
  assert.equal(formatFoundingAmount(23_900, "eur"), "€239");
  assert.equal(formatFoundingAmount(59_950, "eur"), "€599.50");
});

test("US$ and € seats follow the A$ rule: just under 2 and 2.5 years of the yearly price, ending in 9", () => {
  const yearly = { aud: 19_990, usd: 12_990, eur: 11_990 };
  const years = [2, 2.5];
  FOUNDING_BATCHES.forEach((b, i) => {
    const amounts = { aud: b.amountCents, usd: b.currencyAmounts.usd, eur: b.currencyAmounts.eur };
    for (const c of ["aud", "usd", "eur"] as const) {
      const ceiling = yearly[c] * years[i];
      assert.ok(amounts[c] < ceiling, `${c} batch ${b.batch} under ${years[i]} years`);
      assert.ok(ceiling - amounts[c] < 1_000, `${c} batch ${b.batch} the nearest such amount`);
      assert.equal(amounts[c] % 1_000, 900, `${c} batch ${b.batch} ends in 9`);
    }
  });
});

test("the seat is in the plans' currency only when its prices carry it too", () => {
  const carriesAll = () => true;
  const carriesNone = () => false;
  assert.equal(pickFoundingCurrency("usd", carriesAll), "usd");
  assert.equal(pickFoundingCurrency("eur", carriesAll), "eur");
  // Plans still in A$ (their US$ amounts not written yet): the seat stays A$ even if it has US$.
  assert.equal(pickFoundingCurrency("aud", carriesAll), "aud");
  // Plans in US$ but the seat's prices lack it: A$, never a figure checkout can't charge.
  assert.equal(pickFoundingCurrency("usd", carriesNone), "aud");
  assert.equal(pickFoundingCurrency(null, carriesAll), "aud");
  assert.equal(pickFoundingCurrency("gbp", carriesAll), "aud");
});

test("a refused checkout says why", () => {
  assert.equal(foundingClosedMessage({ status: "sold-out" }), "Every founding seat is taken.");
  assert.equal(foundingClosedMessage({ status: "closed" }), "The founding offer has closed.");
  assert.equal(foundingClosedMessage(foundingOfferState({ sold: 0, now: DURING })), null);
});
