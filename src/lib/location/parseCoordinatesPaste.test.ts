/**
 * Run: npx tsx src/lib/location/parseCoordinatesPaste.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCoordinatesPaste } from "@/lib/location/parseCoordinatesPaste";

test("parses comma-separated Google Maps paste", () => {
  const r = parseCoordinatesPaste("-37.75347382840569, 145.13890763862912");
  assert.ok(!("error" in r));
  assert.ok(Math.abs(r.latitude - -37.75347382840569) < 1e-6);
  assert.ok(Math.abs(r.longitude - 145.13890763862912) < 1e-6);
});

test("parses parentheses", () => {
  const r = parseCoordinatesPaste("(-37.75, 145.13)");
  assert.ok(!("error" in r));
});

test("rejects empty", () => {
  const r = parseCoordinatesPaste("  ");
  assert.ok("error" in r);
});
