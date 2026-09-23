import { test } from "node:test";
import assert from "node:assert/strict";
import { againstRunBefore, type DayRunPace } from "@/lib/engineer/againstRunBefore";

function run(p: Partial<DayRunPace> & { id: string }): DayRunPace {
  return {
    clock: null,
    top5: null,
    trackMove: null,
    set: null,
    setLetter: null,
    tyreRun: null,
    splitTyres: false,
    unconfirmed: false,
    cleanAverage: null,
    ...p,
  };
}

// The founder's SA Saturday (2026-09-12), the numbers round 06 asked about: set C's three heats,
// then a new set D. Track moves are the LAPS block's "the other drivers against their own day".
const sa = [
  run({ id: "b1", clock: "10:21", top5: 17.78, trackMove: 0.05, set: "B", setLetter: "B", tyreRun: 1 }),
  run({ id: "c1", clock: "12:15", top5: 17.58, trackMove: -0.1, set: "C", setLetter: "C", tyreRun: 1 }),
  run({ id: "c2", clock: "13:41", top5: 17.92, trackMove: -0.02, set: "C", setLetter: "C", tyreRun: 2 }),
  run({ id: "c3", clock: "15:31", top5: 17.9, trackMove: -0.05, set: "C", setLetter: "C", tyreRun: 3, cleanAverage: 18.13 }),
  run({ id: "d1", clock: "16:53", top5: 17.88, trackMove: 0.03, set: "D", setLetter: "D", tyreRun: 1, cleanAverage: 18.12 }),
  run({ id: "e5", clock: "17:48", top5: 18.0, trackMove: 0.06, set: "E", setLetter: "E", tyreRun: 5 }),
];
const at = (id: string) => sa.find((r) => r.id === id)!;

test("a new set against a third run: the tyres' age comes back out", () => {
  const line = againstRunBefore(at("c3"), at("d1"), sa)!;
  // 17.88 − 17.90 = −0.02; the others 0.08 slower → −0.10; set C lost 0.27 by run 3 (0.32 raw,
  // the track 0.05 slower) → a new set should have found that much, so like for like +0.17.
  assert.equal(
    line,
    "against 15:31, the run before: top5 -0.02; the track 0.08 slower than then, so -0.10 with it taken out; +0.17 with the tyres' age taken out too (set D run 1 against set C run 3; today set C was +0.27 by its run 3, track taken out). Average without slow laps 18.13 → 18.12."
  );
});

test("the same set one run older: never measured on itself", () => {
  const line = againstRunBefore(at("c2"), at("c3"), sa)!;
  assert.match(line, /^against 13:41, the run before: top5 -0\.02; the track 0\.03 quicker than then, so \+0\.01 with it taken out; tyres: set C run 3 against set C run 2 — no other set today went from its run 1 to a run 2\.$/);
});

test("the same set, measured on another set that ran the same ages today", () => {
  const day = [
    run({ id: "a1", clock: "09:00", top5: 18.0, set: "A", setLetter: "A", tyreRun: 1 }),
    run({ id: "a2", clock: "10:00", top5: 18.3, set: "A", setLetter: "A", tyreRun: 2 }),
    run({ id: "b1", clock: "11:00", top5: 17.9, set: "B", setLetter: "B", tyreRun: 1 }),
    run({ id: "b2", clock: "12:00", top5: 18.0, set: "B", setLetter: "B", tyreRun: 2 }),
  ];
  // Practice, no field: raw throughout. B's own drop is the question, so A's +0.30 is the measure:
  // B run 2 was 0.10 slower, and a second run costs 0.30 — the change found 0.20.
  const line = againstRunBefore(day[2], day[3], day)!;
  assert.equal(
    line,
    "against 11:00, the run before: top5 +0.10; -0.20 with the tyres' age taken out too (set B run 2 against set B run 1; today set A was +0.30 by its run 2)."
  );
});

test("two new sets are the same age: nothing to take out", () => {
  const line = againstRunBefore(at("b1"), at("c1"), sa)!;
  assert.equal(line, "against 10:21, the run before: top5 -0.20; the track 0.15 quicker than then, so -0.05 with it taken out; tyres the same age (set C run 1 against set B run 1).");
});

test("a used set from another day: no run 1 today to measure a run 5 from", () => {
  const line = againstRunBefore(at("d1"), at("e5"), sa)!;
  assert.match(line, /tyres: set E run 5 against set D run 1 — no set today went from its run 1 to a run 5\.$/);
});

test("front/rear cars and copied tyres get no tyre step", () => {
  const split = againstRunBefore(at("c3"), { ...at("d1"), splitTyres: true }, sa)!;
  assert.doesNotMatch(split, /tyres/);
  const copied = againstRunBefore(at("c3"), { ...at("d1"), unconfirmed: true }, sa)!;
  assert.doesNotMatch(copied, /tyres/);
  assert.match(copied, /so -0\.10 with it taken out\. Average/);
});

test("a run whose copied tyres sit in a set never measures it", () => {
  const day = [
    run({ id: "c1", clock: "09:00", top5: 18.0, set: "C", setLetter: "C", tyreRun: 1 }),
    run({ id: "c3", clock: "11:00", top5: 18.4, set: "C", setLetter: "C", tyreRun: 3 }),
    run({ id: "g3", clock: "16:00", top5: 18.3, set: "G", setLetter: "G", tyreRun: 3 }),
    run({ id: "h1", clock: "17:00", top5: 18.1, set: "H", setLetter: "H", tyreRun: 1 }),
  ];
  assert.match(againstRunBefore(day[2], day[3], day)!, /today set C was \+0\.40 by its run 3\)\.$/);
  const copied = day.map((r) => (r.id === "c3" ? { ...r, unconfirmed: true } : r));
  assert.match(againstRunBefore(copied[2], copied[3], copied)!, /no set today went from its run 1 to a run 3\.$/);
});

test("no top five either side: no line", () => {
  assert.equal(againstRunBefore(run({ id: "x" }), at("c1"), sa), null);
});
