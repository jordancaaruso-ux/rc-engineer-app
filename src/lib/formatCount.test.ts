import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount } from "@/lib/formatCount";

test("a comma every three digits, whatever the device's language", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1070), "1,070");
  assert.equal(formatCount(1234567), "1,234,567");
  assert.equal(formatCount(-4200), "-4,200");
});

test("whole numbers only, and no number for no number", () => {
  assert.equal(formatCount(1069.6), "1,070");
  assert.equal(formatCount(Number.NaN), "—");
});
