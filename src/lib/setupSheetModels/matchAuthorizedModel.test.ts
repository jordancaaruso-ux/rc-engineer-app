/**
 * Run: `npx tsx src/lib/setupSheetModels/matchAuthorizedModel.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickAuthorizedModelIdForChassisText,
  type ChassisMatchModel,
} from "@/lib/setupSheetModels/matchAuthorizedModel";

const CATALOG: ChassisMatchModel[] = [
  { id: "mtc3", name: "Mugen MTC3", isAuthorized: true },
  { id: "mtc2", name: "Mugen MTC2", isAuthorized: true },
  { id: "t4", name: "Xray T4", isAuthorized: true },
  { id: "x4", name: "Xray X4", isAuthorized: true },
  { id: "a800", name: "Awesomatix A800RR", isAuthorized: true },
];

test("exact normalized name links", () => {
  assert.equal(pickAuthorizedModelIdForChassisText("mugen mtc3", CATALOG), "mtc3");
  assert.equal(pickAuthorizedModelIdForChassisText("Mugen MTC3", CATALOG), "mtc3");
});

test("shorthand token-subset links to the unique chassis (the reported bug)", () => {
  // A car named just "MTC3" must land on the full Mugen MTC3 authorized schema.
  assert.equal(pickAuthorizedModelIdForChassisText("MTC3", CATALOG), "mtc3");
  assert.equal(pickAuthorizedModelIdForChassisText("mtc2", CATALOG), "mtc2");
  assert.equal(pickAuthorizedModelIdForChassisText("t4", CATALOG), "t4");
});

test("extra words around a full name still link", () => {
  assert.equal(pickAuthorizedModelIdForChassisText("Mugen MTC3 build 2", CATALOG), "mtc3");
  assert.equal(pickAuthorizedModelIdForChassisText("my awesomatix a800rr", CATALOG), "a800");
});

test("ambiguous text never guesses", () => {
  assert.equal(pickAuthorizedModelIdForChassisText("mugen", CATALOG), null); // MTC3 + MTC2
  assert.equal(pickAuthorizedModelIdForChassisText("xray", CATALOG), null); // T4 + X4
});

test("unknown / empty text stays null", () => {
  assert.equal(pickAuthorizedModelIdForChassisText("Tony Tiger", CATALOG), null);
  assert.equal(pickAuthorizedModelIdForChassisText("", CATALOG), null);
  assert.equal(pickAuthorizedModelIdForChassisText(null, CATALOG), null);
  assert.equal(pickAuthorizedModelIdForChassisText("   ", CATALOG), null);
});

test("unauthorized rows are ignored (never link to a sparse duplicate)", () => {
  const withDupe: ChassisMatchModel[] = [
    ...CATALOG,
    { id: "mtc3-sparse", name: "MTC3", isAuthorized: false },
  ];
  assert.equal(pickAuthorizedModelIdForChassisText("MTC3", withDupe), "mtc3");
});

console.log("matchAuthorizedModel: all tests passed");
