import test from "node:test";
import assert from "node:assert/strict";
import { rcGuardCorrections, rcLeversFromNets, rcMovesBlock } from "./rcDirections";

// The founder-owned words lines as they stand in content/nets/touring (2026-09-01).
const ENTRIES = [
  { parameter: "upper_outer_shims_front", words: { more: "more — roll centre up" } },
  { parameter: "upper_outer_shims_rear", words: { more: "more — roll centre up" } },
  { parameter: "upper_inner_shims_front", words: { more: "more — roll centre down" } },
  { parameter: "upper_inner_shims_rear", words: { more: "more — roll centre down" } },
  { parameter: "under_lower_arm_shims_front", words: { more: "more — roll centre up" } },
  { parameter: "under_lower_arm_shims_rear", words: { more: "more — roll centre up" } },
  { parameter: "under_hub_shims_front", words: { more: "more — roll centre up" } },
  { parameter: "under_hub_shims_rear", words: { more: "more — roll centre up" } },
  { parameter: "toe_front", words: { more: "more toe-out" } },
];

const LEVERS = rcLeversFromNets(ENTRIES);

test("levers derive from the words lines, axles collapsed, non-RC nets excluded", () => {
  assert.deepEqual(
    LEVERS.map((l) => `${l.name}:${l.addEffect}`).sort(),
    ["under-hub:up", "under-lower-arm:up", "upper-inner:down", "upper-outer:up"]
  );
});

test("the moves block names every lever on the correct side", () => {
  const block = rcMovesBlock(LEVERS);
  assert.match(block, /RC UP: .*more under-hub shims/);
  assert.match(block, /RC UP: .*more under-lower-arm shims/);
  assert.match(block, /RC UP: .*more upper-outer shims/);
  assert.match(block, /RC UP: .*fewer upper-inner shims/);
  assert.match(block, /SHIM millimetres only/);
});

test("the live failure from 2026-09-01 is caught: both inverted moves and the RC distance", () => {
  const reply =
    "Raise the front roll centre by 0.25 mm with the front upper-outer shims removed or front upper-inner shims added: more bite and a more on-the-track front going in; it most likely adds understeer in the middle.";
  const corrections = rcGuardCorrections(reply, LEVERS);
  assert.equal(corrections.filter((c) => c.includes("upper-outer")).length, 1, corrections.join("\n"));
  assert.equal(corrections.filter((c) => c.includes("upper-inner")).length, 1, corrections.join("\n"));
  assert.equal(corrections.filter((c) => c.includes("shim millimetres")).length, 1, corrections.join("\n"));
});

test("the 2026-08-29 inversion is caught: fewer upper-outer said to raise", () => {
  const reply = "Take out a front upper-outer shim to bring the roll centre up for more bite.";
  const corrections = rcGuardCorrections(reply, LEVERS);
  assert.equal(corrections.length, 1, corrections.join("\n"));
  assert.match(corrections[0], /upper-outer/);
});

test("correct directions pass clean, sized in shim millimetres", () => {
  const clean = [
    "Add a 0.5 mm front upper-outer shim — roll centre up, more bite going in.",
    "Remove 0.5 mm of upper-inner shim to bring that roll centre up.",
    "Add 0.5 mm under the lower arm: under-lower-arm shims raise the roll centre about twice as hard as the upper link.",
    "Lower the rear roll centre: take out 0.5 mm of under-hub shims.",
  ].join("\n");
  assert.deepEqual(rcGuardCorrections(clean, LEVERS), []);
});

test("ambiguity stays silent — no direction words, or both", () => {
  const murky = [
    "The upper-outer shims set the roll centre and camber gain together.",
    "Whether you raise or lower the roll centre with the upper-outer shims depends on the day.",
  ].join("\n");
  assert.deepEqual(rcGuardCorrections(murky, LEVERS), []);
});

test("an RC distance is caught in both phrasings", () => {
  const a = rcGuardCorrections("Lower the roll centre by 1 mm at the rear.", LEVERS);
  assert.equal(a.length, 1);
  const b = rcGuardCorrections("That is about 0.5 mm of roll centre at the front.", LEVERS);
  assert.equal(b.length, 1);
});

test("a move sized in shim millimetres is not an RC distance", () => {
  // Round 05c: sized exactly as ruled, corrected anyway.
  const shim = "- **Raise rear roll centre by 0.5 mm of shim**—for example, remove 0.5 mm from the rear upper-inner shims.";
  assert.deepEqual(rcGuardCorrections(shim, LEVERS), []);
  const rc = rcGuardCorrections("Raise rear roll centre by 0.5 mm: remove 0.5 mm from both rear upper-inner shim stacks.", LEVERS);
  assert.equal(rc.filter((c) => c.includes("shim millimetres")).length, 1, rc.join("\n"));
});

test("round 07's false corrections stay silent: 'less' before a lever, a comparative after one", () => {
  // Both right, both once corrected as "backwards" in front of the driver (2026-09-23).
  const right = [
    "- **Lower the front roll centre with 0.5 mm more upper-inner shim or 0.5 mm less upper-outer shim** — more middle steering, but your earlier all-round upper-inner-shim test was slower, so I would not make that the first move.",
    "- **Lower the front roll centre: remove 0.5 mm from the front under-hub or under-lower-arm shims** — more front grip in the middle, but a calmer, less pointy first input.",
  ].join("\n");
  assert.deepEqual(rcGuardCorrections(right, LEVERS), []);
  // A move in one clause, the car as it stands in the next.
  const twoClauses =
    "For the geometry test, remove 0.5 mm rear upper-inner shim only; if it improves the quick direction changes but hurts the long turns, the current lower rear roll-centre direction was helping the longer corners.";
  assert.deepEqual(rcGuardCorrections(twoClauses, LEVERS), []);
  // …and "less" still counts as a move where it is one.
  const wrong = rcGuardCorrections("Raise the front roll centre with 0.5 mm less upper-outer shim.", LEVERS);
  assert.equal(wrong.length, 1, wrong.join("\n"));
  assert.match(wrong[0], /upper-outer/);
});

test("prose with no roll-centre mention is never touched", () => {
  const reply =
    "Go 50 cSt thinner on the front oil; add 0.25° front camber; remove a rear toe-gain shim.";
  assert.deepEqual(rcGuardCorrections(reply, LEVERS), []);
});
