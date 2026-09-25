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
  FOUNDING_OPENS_AT,
  FOUNDING_SHOW_COUNT_BELOW,
  formatFoundingAmount,
  foundingClosedMessage,
  foundingOfferState,
  foundingSeatsLine,
} from "@/lib/billing/foundingOfferLogic";

const DURING = new Date("2026-10-15T00:00:00.000Z");

test("opens at midnight 1 October and closes at the end of 31 October, Sydney time", () => {
  // Sydney is UTC+10 on 1 October (daylight saving starts 4 October), UTC+11 by 31 October.
  assert.equal(FOUNDING_OPENS_AT.toISOString(), "2026-09-30T14:00:00.000Z");
  assert.equal(FOUNDING_CLOSES_AT.toISOString(), "2026-10-31T13:00:00.000Z");
  const sydney = (d: Date) =>
    d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: false });
  assert.match(sydney(FOUNDING_OPENS_AT), /^01\/10\/2026, (00|24):00:00$/);
  assert.match(sydney(FOUNDING_CLOSES_AT), /^01\/11\/2026, (00|24):00:00$/);
});

test("nothing on sale before it opens, or from the moment it closes", () => {
  const justBefore = new Date(FOUNDING_OPENS_AT.getTime() - 1);
  assert.equal(foundingOfferState({ sold: 0, now: justBefore }).status, "not-open");
  assert.equal(foundingOfferState({ sold: 0, now: FOUNDING_OPENS_AT }).status, "open");
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

test("amounts read like the price cards", () => {
  assert.equal(formatFoundingAmount(39_900), "$399");
  assert.equal(formatFoundingAmount(99_950), "$999.50");
});

test("a refused checkout says why", () => {
  assert.equal(foundingClosedMessage({ status: "not-open" }), "Founding seats go on sale on 1 October.");
  assert.equal(foundingClosedMessage({ status: "sold-out" }), "Every founding seat is taken.");
  assert.equal(foundingClosedMessage({ status: "closed" }), "The founding offer has closed.");
  assert.equal(foundingClosedMessage(foundingOfferState({ sold: 0, now: DURING })), null);
});
