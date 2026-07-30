/**
 * Run: `npx tsx src/lib/tires/deriveTireStint.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTireCountChip,
  deriveTireStintForCompound,
  isTireStintUnanswered,
} from "@/lib/tires/deriveTireStint";
import {
  expandedTireCountChips,
  TIRE_COUNT_CHIPS,
  type TireCountChip,
} from "@/lib/tires/tireAgeReadout";
import type { LastRunTires, TireStintValue } from "@/lib/tires/tireStintValue";

const chip = (key: string): TireCountChip => {
  const found = TIRE_COUNT_CHIPS.find((c) => c.key === key);
  assert.ok(found, `no chip ${key}`);
  return found;
};

const last = (over: Partial<LastRunTires> = {}): LastRunTires => ({
  tireTypeId: "sweep-32r",
  tireRunNumber: 2,
  tireAgeKnown: true,
  tireStintId: "stint-1",
  ...over,
});

const v = (
  runsCompleted: number,
  ageKnown = true,
  stintId: string | null = null
): TireStintValue => ({ runsCompleted, ageKnown, stintId });

test("same compound as the last run carries its stint and adds a run", () => {
  const out = deriveTireStintForCompound(last(), "sweep-32r");
  assert.equal(out.source, "carried");
  assert.deepEqual(out.value, { runsCompleted: 2, ageKnown: true, stintId: "stint-1" });
  // runsCompleted is runs BEFORE this one, so the saved run number is 3.
  assert.equal(out.value.runsCompleted + 1, 3);
});

test("a different compound is a fresh set, not the old set's age", () => {
  const out = deriveTireStintForCompound(last(), "volante-s3");
  assert.equal(out.source, "assumedFresh");
  assert.deepEqual(out.value, { runsCompleted: 0, ageKnown: true, stintId: null });
});

test("no previous run at all is also a fresh set", () => {
  const out = deriveTireStintForCompound(null, "sweep-32r");
  assert.equal(out.source, "assumedFresh");
  assert.deepEqual(out.value, { runsCompleted: 0, ageKnown: true, stintId: null });
});

test("no compound picked decides nothing — the readout must stay a question", () => {
  const out = deriveTireStintForCompound(last(), "");
  assert.equal(out.source, null);
  assert.deepEqual(out.value, { runsCompleted: 0, ageKnown: true, stintId: null });
});

test("an unknown age carries as unknown rather than becoming a number", () => {
  const out = deriveTireStintForCompound(
    last({ tireAgeKnown: false, tireRunNumber: 3, tireStintId: "stint-x" }),
    "sweep-32r"
  );
  assert.equal(out.source, "carried");
  assert.deepEqual(out.value, { runsCompleted: 3, ageKnown: false, stintId: "stint-x" });
});

test("carrying a last run that never had a stint still carries the count", () => {
  const out = deriveTireStintForCompound(last({ tireStintId: null }), "sweep-32r");
  assert.equal(out.source, "carried");
  assert.equal(out.value.runsCompleted, 2);
  assert.equal(out.value.stintId, null, "server mints one on save");
});

test("STINT FORK: correcting the count drops the stint", () => {
  const out = applyTireCountChip(chip("new"), v(2, true, "stint-1"), last(), "carried");
  assert.deepEqual(out.value, { runsCompleted: 0, ageKnown: true, stintId: null });
  assert.equal(out.source, "manual");
});

test("STINT FORK: tapping the carried value back is a confirmation, not a change", () => {
  const out = applyTireCountChip(chip("2"), v(2, true, "stint-1"), last(), "carried");
  assert.equal(out.value.stintId, "stint-1", "same rubber — the wear chain must not break");
  assert.equal(out.source, "carried");
});

test("STINT FORK: a count tap on an assumed-fresh set never revives a stint", () => {
  const out = applyTireCountChip(chip("3"), v(0), last(), "assumedFresh");
  assert.equal(out.value.stintId, null);
  assert.equal(out.source, "manual");
});

test("STINT FORK: naming a number for an unknown-age set forks it", () => {
  const l = last({ tireAgeKnown: false, tireRunNumber: 3, tireStintId: "stint-x" });
  const out = applyTireCountChip(chip("3"), v(3, false, "stint-x"), l, "carried");
  assert.equal(out.value.ageKnown, true);
  assert.equal(out.value.stintId, null, "can't tell 'I counted them' from 'I fitted a used set'");
});

test("STINT FORK: 'not sure' on a carried known-age set forks it", () => {
  const out = applyTireCountChip(chip("unsure"), v(2, true, "stint-1"), last(), "carried");
  assert.deepEqual(out.value, { runsCompleted: 0, ageKnown: false, stintId: null });
});

test("'not sure' matching a carried unknown-age set is a confirmation", () => {
  const l = last({ tireAgeKnown: false, tireRunNumber: 0, tireStintId: "stint-x" });
  const out = applyTireCountChip(chip("unsure"), v(0, false, "stint-x"), l, "carried");
  assert.equal(out.value.stintId, "stint-x");
  assert.equal(out.source, "carried");
});

test("4+ expands the row and never reduces an existing answer", () => {
  const low = applyTireCountChip(chip("more"), v(0), null, "assumedFresh");
  assert.equal(low.value.runsCompleted, 4);
  assert.equal(low.expand, true);

  const high = applyTireCountChip(chip("more"), v(9), null, "manual");
  assert.equal(high.value.runsCompleted, 9, "9 must not fall back to the floor of 4");
  assert.equal(high.expand, true);
});

test("4+ landing on the carried value keeps the stint", () => {
  const l = last({ tireRunNumber: 7 });
  const out = applyTireCountChip(chip("more"), v(7, true, "stint-1"), l, "carried");
  assert.equal(out.value.runsCompleted, 7);
  assert.equal(out.value.stintId, "stint-1");
});

test("only chips expand the row — a plain count tap doesn't force it open", () => {
  assert.equal(applyTireCountChip(chip("2"), v(0), null, "assumedFresh").expand, false);
  assert.equal(applyTireCountChip(chip("unsure"), v(0), null, "assumedFresh").expand, false);
});

test("the expanded row always contains the value on the car", () => {
  const keys = expandedTireCountChips(23).map((c) => c.key);
  assert.ok(keys.includes("23"), "a two-day club set can be well past the default top");
  assert.equal(keys[0], "new");
  assert.equal(keys[keys.length - 1], "unsure");
  // Default top when the value is low.
  assert.deepEqual(expandedTireCountChips(0).map((c) => c.label).slice(-3), ["15", "16", "Not sure"]);
});

test("auto-derivation only overwrites a form nobody has touched", () => {
  assert.equal(isTireStintUnanswered(v(0)), true);
  assert.equal(isTireStintUnanswered(v(0, true, "stint-1")), false, "a saved/replicated run");
  assert.equal(isTireStintUnanswered(v(3)), false, "a hand-set count");
  assert.equal(isTireStintUnanswered(v(0, false)), false, "an explicit 'not sure'");
});
