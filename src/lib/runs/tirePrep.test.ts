/**
 * Run: `npx tsx src/lib/runs/tirePrep.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeTirePrep,
  tirePrepFromLegacy,
  derivedWarmerTimingMinutes,
  pruneTirePrepForSave,
  tirePrepHasContent,
  formatTirePrepLine,
  emptyTirePrepStep,
  newTirePrepStep,
  TIRE_PREP_DEFAULT_MINUTES,
  TIRE_PREP_DEFAULT_TEMP_C,
  MAX_TIRE_PREP_STEPS,
  type TirePrepStep,
} from "@/lib/runs/tirePrep";

const step = (p: Partial<TirePrepStep> = {}): TirePrepStep => ({
  ...emptyTirePrepStep(),
  ...p,
});

test("normalizeTirePrep coerces strings, defaults appliedAdditive, caps at max", () => {
  const raw = [
    { appliedAdditive: true, minutes: "20", warmers: false },
    { minutes: 10, warmers: true, towels: true, temperatureC: "55" },
    { minutes: 5, warmers: false },
    { minutes: 5, warmers: false }, // 4th — dropped by the cap
  ];
  const out = normalizeTirePrep(raw);
  assert.equal(out.length, MAX_TIRE_PREP_STEPS);
  assert.deepEqual(out[0], {
    appliedAdditive: true,
    minutes: 20,
    warmers: false,
    towels: false,
    temperatureC: null,
  });
  assert.deepEqual(out[1], {
    appliedAdditive: true, // missing → defaults true
    minutes: 10,
    warmers: true,
    towels: true,
    temperatureC: 55,
  });
});

test("normalizeTirePrep clears towels/temperature on bench steps", () => {
  const out = normalizeTirePrep([
    { minutes: 12, warmers: false, towels: true, temperatureC: 60 },
  ]);
  assert.equal(out[0].towels, false);
  assert.equal(out[0].temperatureC, null);
});

test("normalizeTirePrep tolerates junk", () => {
  assert.deepEqual(normalizeTirePrep(null), []);
  assert.deepEqual(normalizeTirePrep("nope"), []);
  assert.deepEqual(normalizeTirePrep([1, "x", null]), []);
});

test("tirePrepFromLegacy synthesizes a single warmer step; empty for null/0", () => {
  assert.deepEqual(tirePrepFromLegacy(30, true), [
    { appliedAdditive: true, minutes: 30, warmers: true, towels: false, temperatureC: null },
  ]);
  assert.deepEqual(tirePrepFromLegacy(15, false)[0].appliedAdditive, false);
  assert.deepEqual(tirePrepFromLegacy(null, true), []);
  assert.deepEqual(tirePrepFromLegacy(0, true), []);
});

test("derivedWarmerTimingMinutes sums warmer steps only; null when none in warmers", () => {
  assert.equal(
    derivedWarmerTimingMinutes([
      step({ minutes: 20, warmers: false }),
      step({ minutes: 10, warmers: true }),
      step({ minutes: 5, warmers: true }),
    ]),
    15
  );
  assert.equal(
    derivedWarmerTimingMinutes([step({ minutes: 20, warmers: false })]),
    null
  );
  assert.equal(derivedWarmerTimingMinutes([]), null);
});

test("newTirePrepStep pre-fills defaults and carries prev on/off choices", () => {
  // First step: fixed defaults, bench (temp irrelevant until warmers on).
  assert.deepEqual(newTirePrepStep(), {
    appliedAdditive: true,
    minutes: TIRE_PREP_DEFAULT_MINUTES,
    warmers: false,
    towels: false,
    temperatureC: null,
  });
  // From a bench step: minutes reset to the default, no temp.
  assert.deepEqual(newTirePrepStep(step({ minutes: 8, warmers: false, appliedAdditive: false })), {
    appliedAdditive: false,
    minutes: TIRE_PREP_DEFAULT_MINUTES,
    warmers: false,
    towels: false,
    temperatureC: null,
  });
  // From a warmer step: carry warmers/towels, default the temp box.
  assert.deepEqual(newTirePrepStep(step({ minutes: 12, warmers: true, towels: true, temperatureC: 60 })), {
    appliedAdditive: true,
    minutes: TIRE_PREP_DEFAULT_MINUTES,
    warmers: true,
    towels: true,
    temperatureC: TIRE_PREP_DEFAULT_TEMP_C,
  });
});

test("pruneTirePrepForSave drops blank rows but keeps warmer/timed steps", () => {
  const pruned = pruneTirePrepForSave([
    step({ minutes: 20, warmers: false }),
    step({ minutes: null, warmers: false }), // blank — dropped
    step({ minutes: null, warmers: true }), // warmer, no time — kept
  ]);
  assert.equal(pruned.length, 2);
  assert.equal(pruned[0].minutes, 20);
  assert.equal(pruned[1].warmers, true);
});

test("tirePrepHasContent reflects prunable content", () => {
  assert.equal(tirePrepHasContent([]), false);
  assert.equal(tirePrepHasContent([step({ minutes: null, warmers: false })]), false);
  assert.equal(tirePrepHasContent([step({ minutes: 5, warmers: false })]), true);
  assert.equal(tirePrepHasContent([step({ minutes: null, warmers: true })]), true);
});

test("formatTirePrepLine reads as a human sequence", () => {
  const steps: TirePrepStep[] = [
    step({ minutes: 20, warmers: false }),
    step({ minutes: 10, warmers: true, towels: true, temperatureC: 55 }),
  ];
  assert.equal(
    formatTirePrepLine(steps, "VP"),
    "VP · 20m bench + 10m warmers 55°C (towels)"
  );
  assert.equal(
    formatTirePrepLine([step({ minutes: 10, warmers: true, appliedAdditive: false })], "VP"),
    "VP · 10m warmers · no sauce"
  );
  assert.equal(formatTirePrepLine([], "VP"), "VP");
  assert.equal(formatTirePrepLine([], null), null);
});
