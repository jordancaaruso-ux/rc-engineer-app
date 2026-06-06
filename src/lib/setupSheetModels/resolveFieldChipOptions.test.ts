/**
 * Run: `npx tsx src/lib/setupSheetModels/resolveFieldChipOptions.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFieldChipOptionsForKey } from "@/lib/setupSheetModels/resolveFieldChipOptions";

test("model schema scope does not fall back to Awesomatix spring chips", () => {
  const opts = resolveFieldChipOptionsForKey("spring_front", {});
  assert.equal(opts, null);
});

test("model schema returns stored chip options", () => {
  const opts = resolveFieldChipOptionsForKey("arb_rear", {
    arb_rear: { options: ["1.1", "1.2"], optionValues: ["f_1_1", "f_1_2"], multi: false },
  });
  assert.deepEqual(opts, {
    options: ["1.1", "1.2"],
    optionValues: ["f_1_1", "f_1_2"],
    multi: false,
  });
});

test("legacy templates keep Awesomatix catalog fallback", () => {
  const opts = resolveFieldChipOptionsForKey("spring_front", null);
  assert.deepEqual(opts, { options: ["STD", "S"], multi: false });
});
