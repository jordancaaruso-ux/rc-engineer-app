/**
 * Run: `npx tsx src/lib/trackConditionSignature.test.ts`  (or `npm run test:condition-signature`)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeTrackConditionSignature,
  withTemperatureBand,
} from "@/lib/trackConditionSignature";

test("base signature has no temperature suffix and is stable", () => {
  const base = encodeTrackConditionSignature(["MEDIUM"], ["TECHNICAL"]);
  assert.ok(base.startsWith("g:"));
  assert.ok(!base.includes("_t:"));
  // Omitting the band === passing null (backward-compatible legacy form).
  assert.equal(encodeTrackConditionSignature(["MEDIUM"], ["TECHNICAL"], null), base);
});

test("encodeTrackConditionSignature appends the temperature band", () => {
  const base = encodeTrackConditionSignature(["MEDIUM"], ["TECHNICAL"]);
  assert.equal(
    encodeTrackConditionSignature(["MEDIUM"], ["TECHNICAL"], "warm"),
    `${base}_t:warm`
  );
});

test("withTemperatureBand appends only when a band is given", () => {
  const base = encodeTrackConditionSignature([], []);
  assert.equal(withTemperatureBand(base, "hot"), `${base}_t:hot`);
  assert.equal(withTemperatureBand(base, null), base);
  assert.equal(withTemperatureBand(base, undefined), base);
  assert.equal(withTemperatureBand(base, ""), base);
});

test("untagged track still produces a valid base bucket", () => {
  const base = encodeTrackConditionSignature([], []);
  assert.equal(base, "g:none_l:none");
  assert.equal(withTemperatureBand(base, "cool"), "g:none_l:none_t:cool");
});

console.log("trackConditionSignature.test.ts: all tests registered");
