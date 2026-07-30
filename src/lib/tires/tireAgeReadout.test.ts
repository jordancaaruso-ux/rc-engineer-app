/**
 * Run: `npx tsx src/lib/tires/tireAgeReadout.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeTireCountChip,
  expandedTireCountChips,
  tireAgeHint,
  tireAgeReadout,
  TIRE_COUNT_CHIPS,
} from "@/lib/tires/tireAgeReadout";
import type { LastRunTires, TireStintValue } from "@/lib/tires/tireStintValue";

const v = (runsCompleted: number, ageKnown = true, stintId: string | null = null): TireStintValue => ({
  runsCompleted,
  ageKnown,
  stintId,
});

const last = (over: Partial<LastRunTires> = {}): LastRunTires => ({
  tireTypeId: "sweep-32r",
  tireRunNumber: 2,
  tireAgeKnown: true,
  tireStintId: "stint-1",
  ...over,
});

test("a fresh set never renders a number — the whole point of the rework", () => {
  const r = tireAgeReadout("assumedFresh", v(0));
  assert.equal(r.title, "New tires");
  assert.match(r.sub, /^no runs on them yet/);
  assert.equal(/\b1\b/.test(r.title), false);
  // How the value was reached never changes how it reads.
  assert.deepEqual(tireAgeReadout("manual", v(0)), r);
});

test("a carried set counts runs done and promises the run number", () => {
  const r = tireAgeReadout("carried", v(2, true, "stint-1"));
  assert.equal(r.title, "2 runs on these");
  assert.equal(r.sub, "this will be run 3");
  assert.equal(r.unresolved, false);
  assert.equal(tireAgeReadout("manual", v(1)).title, "1 run on these");
});

test("no compound picked asks instead of inventing run 1", () => {
  const r = tireAgeReadout(null, v(0));
  assert.equal(r.title, "Not set yet");
  assert.equal(r.sub, "Pick a compound above");
  assert.equal(r.unresolved, true);
});

test("unknown age claims no count", () => {
  assert.equal(tireAgeReadout("manual", v(0, false)).title, "Age unknown");
  assert.equal(tireAgeReadout("manual", v(0, false)).sub, "first run since you got them");
  assert.equal(tireAgeReadout("carried", v(3, false)).sub, "3 runs since you got them");
});

test("the hint names where a guessed number came from", () => {
  assert.equal(tireAgeHint("carried", last()), "Carried on from your last run");
  assert.equal(
    tireAgeHint("carried", last({ tireAgeKnown: false })),
    "Carried on from your last run — age still unknown"
  );
  assert.equal(
    tireAgeHint("assumedFresh", last()),
    "Different compound to your last run, so assumed a fresh set"
  );
  assert.equal(
    tireAgeHint("assumedFresh", null),
    "No previous run on this car, so assumed a fresh set"
  );
});

test("the hint goes quiet once the driver has answered for themselves", () => {
  assert.equal(tireAgeHint("manual", last()), null);
  assert.equal(tireAgeHint(null, last()), null);
});

test("the count row offers new, 1-3, a hand-off past 3 and an honest opt-out", () => {
  assert.deepEqual(
    TIRE_COUNT_CHIPS.map((c) => c.label),
    ["New", "1", "2", "3", "4+", "Not sure"]
  );
  const unsure = TIRE_COUNT_CHIPS.find((c) => c.key === "unsure")!;
  assert.equal(unsure.ageKnown, false, "'not sure' must never claim a known count");
  assert.equal(TIRE_COUNT_CHIPS.find((c) => c.key === "more")!.expands, true);
});

test("the expanded row keeps counting rather than handing off to a stepper", () => {
  const labels = expandedTireCountChips(0).map((c) => c.label);
  assert.deepEqual(labels.slice(0, 5), ["New", "1", "2", "3", "4"]);
  assert.equal(labels.includes("4+"), false, "no hand-off chip once the row is open");
  assert.equal(labels[labels.length - 1], "Not sure");
});

test("the lit chip follows the value, and nothing is lit before a compound", () => {
  assert.equal(activeTireCountChip(null, v(0)), null, "no compound lights nothing");
  assert.equal(activeTireCountChip("assumedFresh", v(0)), "new");
  assert.equal(activeTireCountChip("carried", v(2, true, "stint-1")), "2");
  assert.equal(activeTireCountChip("manual", v(9)), "more", "collapsed: past 3 sits under 4+");
  assert.equal(activeTireCountChip("manual", v(9), true), "9", "expanded: lights its own number");
  assert.equal(activeTireCountChip("manual", v(0, false)), "unsure", "unknown age beats the count");
});
