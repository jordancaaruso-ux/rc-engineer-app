/**
 * Run: `npx tsx src/lib/speedhive/speedhiveTransponder.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classificationRowMatchesTransponder,
  normalizeSpeedhiveTransponderNumber,
  parseSpeedhiveTransponderNumbersSetting,
  transponderNumberFromClassificationRow,
} from "./speedhiveTransponder";
import { classificationRowMatchesUser } from "./speedhiveClassificationMatch";

test("normalizeSpeedhiveTransponderNumber strips non-digits", () => {
  assert.equal(normalizeSpeedhiveTransponderNumber("  #1234567 "), "1234567");
});

test("parseSpeedhiveTransponderNumbersSetting from comma list", () => {
  assert.deepEqual(parseSpeedhiveTransponderNumbersSetting("123, 456"), [123, 456]);
});

test("parseSpeedhiveTransponderNumbersSetting from JSON array", () => {
  assert.deepEqual(parseSpeedhiveTransponderNumbersSetting("[7890123]"), [7890123]);
});

test("transponderNumberFromClassificationRow reads common fields", () => {
  assert.equal(
    transponderNumberFromClassificationRow({
      position: 1,
      name: "Test",
      transponder: 1234567,
    }),
    "1234567"
  );
  assert.equal(
    transponderNumberFromClassificationRow({
      position: 2,
      name: "Other",
      competitor: { chipNumber: "9876543" },
    }),
    "9876543"
  );
});

test("classificationRowMatchesTransponder", () => {
  const row = { position: 1, name: "A", transponderId: 555 };
  assert.equal(classificationRowMatchesTransponder(row, [555]), true);
  assert.equal(classificationRowMatchesTransponder(row, [556]), false);
});

test("classificationRowMatchesUser prefers transponder when configured", () => {
  const row = { position: 1, name: "Wrong Name", transponder: 111 };
  assert.equal(
    classificationRowMatchesUser({
      row,
      userTransponders: [111],
      driverNorms: [],
      raceClassFilter: null,
    }),
    true
  );
});

test("classificationRowMatchesUser falls back to driver name", () => {
  const row = { position: 1, name: "Jordan Smith" };
  assert.equal(
    classificationRowMatchesUser({
      row,
      userTransponders: [],
      driverNorms: ["jordan smith"],
      raceClassFilter: null,
    }),
    true
  );
});

test("any stored spelling matches — the club that types it differently still lands", () => {
  const row = { position: 1, name: "J Smith" };
  assert.equal(
    classificationRowMatchesUser({
      row,
      userTransponders: [],
      driverNorms: ["jordan smith"],
      raceClassFilter: null,
    }),
    false,
    "one spelling alone doesn't reach the short form"
  );
  assert.equal(
    classificationRowMatchesUser({
      row,
      userTransponders: [],
      driverNorms: ["jordan smith", "j smith"],
      raceClassFilter: null,
    }),
    true
  );
});

test("a chip that misses still lets a name match — sessions without transponder fields", () => {
  const row = { position: 1, name: "Jordan Smith" };
  assert.equal(
    classificationRowMatchesUser({
      row,
      userTransponders: [999],
      driverNorms: ["jordan smith"],
      raceClassFilter: null,
    }),
    true
  );
});
