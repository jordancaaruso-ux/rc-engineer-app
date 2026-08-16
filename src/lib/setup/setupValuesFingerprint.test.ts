import test from "node:test";
import assert from "node:assert/strict";
import { changedSetupKeys, setupValuesFingerprint } from "./setupValuesFingerprint";

const same = (a: unknown, b: unknown) =>
  setupValuesFingerprint(a) === setupValuesFingerprint(b);

test("the same setup handed back is not a change", () => {
  const opened = { camber_front: -1.5, ride_height_rear: 5.5, tire: "Sweep 40R" };
  assert.equal(same(opened, { ...opened }), true);
  assert.deepEqual(changedSetupKeys(opened, { ...opened }), []);
});

test("key order and unfilled boxes carry no meaning", () => {
  assert.equal(
    same(
      { b: "2", a: "1" },
      { a: "1", b: "2", spring_front: "", droop_front: null, notes: undefined, screws: [] }
    ),
    true
  );
});

test("a number typed back in the way it was already stored is not a change", () => {
  // The grid editor commits on blur whatever happened, so this is the stray-tap case.
  assert.equal(same({ ride_height_rear: 5.5 }, { ride_height_rear: "5.50" }), true);
  assert.equal(same({ ride_height_rear: 5.5 }, { ride_height_rear: " 5.5 " }), true);
});

test("a tick going on and back off lands where it started", () => {
  assert.equal(same({ droop_screw: "1" }, { droop_screw: true }), true);
  assert.equal(same({ droop_screw: "" }, { droop_screw: false }), true);
  assert.equal(same({ droop_screw: "1" }, { droop_screw: "" }), false);
});

test("a real edit is a change, and it names the box", () => {
  const opened = { camber_front: -1.5, ride_height_rear: 5.5 };
  const edited = { camber_front: -2, ride_height_rear: 5.5 };
  assert.equal(same(opened, edited), false);
  assert.deepEqual(changedSetupKeys(opened, edited), ["camber_front"]);
});

test("filling a box that was empty, and emptying one that was filled, both count", () => {
  assert.deepEqual(changedSetupKeys({ toe_rear: "" }, { toe_rear: "3" }), ["toe_rear"]);
  assert.deepEqual(changedSetupKeys({ toe_rear: "3" }, {}), ["toe_rear"]);
});

test("text keeps its case, because rewriting a tyre name really would be written", () => {
  assert.equal(same({ tire: "sweep 40r" }, { tire: "Sweep 40R" }), false);
});

test("screw lists compare in order, since their order is the answer", () => {
  assert.equal(same({ top_deck_screws: ["a", "b"] }, { top_deck_screws: ["a", "b"] }), true);
  assert.equal(same({ top_deck_screws: ["a", "b"] }, { top_deck_screws: ["b", "a"] }), false);
});

test("nested preset values compare by what they resolve to", () => {
  assert.equal(
    same(
      { spring_front: { preset: "c127s", other: "" } },
      { spring_front: { other: null, preset: "c127s" } }
    ),
    true
  );
  assert.equal(
    same({ spring_front: { preset: "c127s" } }, { spring_front: { preset: "c127b" } }),
    false
  );
});

test("several edits count several times", () => {
  assert.equal(
    changedSetupKeys(
      { camber_front: -1.5, ride_height_rear: 5.5, diff_oil: 7000 },
      { camber_front: -2, ride_height_rear: 6, diff_oil: 7000 }
    ).length,
    2
  );
});
