/**
 * Run: `npx tsx src/lib/setupSheetModels/chipOptionMatching.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayLabelForStoredChipValue,
  selectedChipLabelForStoredValue,
  storedValueForChipLabel,
} from "@/lib/setupSheetModels/chipOptionMatching";

test("selectedChipLabelForStoredValue matches wizard stored token", () => {
  const labels = ["1.1", "1.2", "1.3"];
  const values = ["f_1_1", "f_1_2", "f_1_3"];
  assert.equal(selectedChipLabelForStoredValue("f_1_1", labels, values), "1.1");
  assert.equal(selectedChipLabelForStoredValue("1.2", labels, values), "1.2");
});

test("storedValueForChipLabel writes stable token for Mugen-style labels", () => {
  const labels = ["1.1", "1.2"];
  const values = ["f_1_1", "f_1_2"];
  assert.equal(storedValueForChipLabel("1.1", labels, values), "f_1_1");
});

test("displayLabelForStoredChipValue shows label not token", () => {
  const labels = ["2.0", "2.5"];
  const values = ["f_2_0", "f_2_5"];
  assert.equal(displayLabelForStoredChipValue("f_2_5", labels, values), "2.5");
});
