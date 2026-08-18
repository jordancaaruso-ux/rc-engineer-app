import { test } from "node:test";
import assert from "node:assert/strict";
import { findCarNameClash, normalizeCarName } from "./carName";

const GARAGE = [
  { id: "a", name: "A800RR" },
  { id: "b", name: "My MTC3" },
];

test("the same name typed again is taken", () => {
  assert.equal(findCarNameClash(GARAGE, "A800RR")?.id, "a");
});

test("case and stray spaces are the same car to a human, so they clash", () => {
  assert.equal(findCarNameClash(GARAGE, "  a800rr ")?.id, "a");
  assert.equal(findCarNameClash(GARAGE, "my   mtc3")?.id, "b");
});

test("a genuinely different name is free", () => {
  assert.equal(findCarNameClash(GARAGE, "A800RR spare"), null);
  assert.equal(findCarNameClash(GARAGE, ""), null);
});

test("renaming a car does not collide with itself", () => {
  assert.equal(findCarNameClash(GARAGE, "A800RR", "a"), null);
  // ...but renaming it onto the other car still does.
  assert.equal(findCarNameClash(GARAGE, "My MTC3", "a")?.id, "b");
});

test("normalising is trim + collapse + lowercase, nothing cleverer", () => {
  assert.equal(normalizeCarName(" My  MTC3 "), "my mtc3");
});
