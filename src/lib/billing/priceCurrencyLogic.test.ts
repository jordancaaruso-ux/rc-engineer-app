/**
 * Run: `npm run test:price-currency`
 *
 * Proves which currency a visitor is priced in and which amount they see. The stakes: a page that
 * shows US$12.99 while checkout charges A$19.99 (or the reverse) is a price the driver never
 * agreed to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountInCurrency,
  asPriceCurrency,
  formatPlanAmount,
  intervalSuffix,
  priceCurrencyForCountry,
} from "@/lib/billing/priceCurrencyLogic";

test("priceCurrencyForCountry: US and territories pay USD, the euro area EUR, the rest AUD", () => {
  assert.equal(priceCurrencyForCountry("US"), "usd");
  assert.equal(priceCurrencyForCountry("pr"), "usd");
  assert.equal(priceCurrencyForCountry("DE"), "eur");
  assert.equal(priceCurrencyForCountry("BG"), "eur");
  assert.equal(priceCurrencyForCountry("MC"), "eur");
  assert.equal(priceCurrencyForCountry("AU"), "aud");
  // Not in the euro area, so AUD on our pages (Stripe's checkout may convert it).
  assert.equal(priceCurrencyForCountry("GB"), "aud");
  assert.equal(priceCurrencyForCountry("CH"), "aud");
  assert.equal(priceCurrencyForCountry("NZ"), "aud");
  assert.equal(priceCurrencyForCountry(""), "aud");
  assert.equal(priceCurrencyForCountry(null), "aud");
  assert.equal(priceCurrencyForCountry(undefined), "aud");
});

test("asPriceCurrency accepts only the three we price in", () => {
  assert.equal(asPriceCurrency("USD"), "usd");
  assert.equal(asPriceCurrency("eur"), "eur");
  assert.equal(asPriceCurrency("aud"), "aud");
  assert.equal(asPriceCurrency("gbp"), null);
  assert.equal(asPriceCurrency(null), null);
});

const racePrice = {
  currency: "aud",
  unit_amount: 1999,
  currency_options: {
    aud: { unit_amount: 1999 },
    usd: { unit_amount: 1299 },
    eur: { unit_amount: 1199 },
  },
};

test("amountInCurrency picks the price's own amount in that currency", () => {
  assert.deepEqual(amountInCurrency(racePrice, "usd"), { unitAmount: 1299, currency: "usd" });
  assert.deepEqual(amountInCurrency(racePrice, "eur"), { unitAmount: 1199, currency: "eur" });
  assert.deepEqual(amountInCurrency(racePrice, "aud"), { unitAmount: 1999, currency: "aud" });
});

test("amountInCurrency falls back to AUD when the price has no amount in that currency", () => {
  const audOnly = { currency: "aud", unit_amount: 999, currency_options: { aud: { unit_amount: 999 } } };
  assert.deepEqual(amountInCurrency(audOnly, "usd"), { unitAmount: 999, currency: "aud" });
  // Retrieved without the expand: no options at all.
  assert.deepEqual(amountInCurrency({ currency: "AUD", unit_amount: 999 }, "eur"), {
    unitAmount: 999,
    currency: "aud",
  });
});

test("formatPlanAmount keeps the short symbol; intervalSuffix names the currency", () => {
  assert.equal(formatPlanAmount(1299, "usd"), "$12.99");
  assert.equal(formatPlanAmount(1199, "eur"), "€11.99");
  assert.equal(formatPlanAmount(1999, "aud"), "$19.99");
  assert.equal(formatPlanAmount(null, "aud"), null);
  assert.equal(formatPlanAmount(1999, null), null);
  assert.equal(intervalSuffix("usd", "month"), "USD / month");
  assert.equal(intervalSuffix("eur", "year"), "EUR / year");
  assert.equal(intervalSuffix(null, "month"), "AUD / month");
});
