/**
 * Run: `npx tsx --test src/lib/teams/teamFeedModel.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFeedEntry,
  computeAlsoMoved,
  computeSetupChangedRows,
  formatPaceDelta,
  pickPreviousComparableRun,
  type TeamFeedRunInput,
} from "@/lib/teams/teamFeedModel";

const TZ = "Australia/Sydney";

function run(over: Partial<TeamFeedRunInput> & { id: string }): TeamFeedRunInput {
  return {
    userId: "dave",
    carId: "car-1",
    trackId: "track-1",
    eventId: null,
    sortAt: "2026-07-25T04:00:00.000Z",
    occurredAt: "2026-07-25T04:00:00.000Z",
    shareWithTeam: true,
    loggingComplete: true,
    bestLapSeconds: null,
    setupData: {},
    conditionsAirTempC: null,
    conditionsTrackTempC: null,
    tireStintId: null,
    tireTypeId: null,
    tireTypeLabel: null,
    tireRunNumber: 1,
    tireAgeKnown: true,
    trackLayoutId: null,
    trackDirection: null,
    ...over,
  };
}

// --- baseline selection -----------------------------------------------------

test("baseline is the same driver's earlier run on the same car and track that day", () => {
  const runs = [
    run({ id: "q2", occurredAt: "2026-07-25T05:00:00.000Z" }),
    run({ id: "q1", occurredAt: "2026-07-25T02:00:00.000Z" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ)?.id, "q1");
});

test("a run at the same track last month is NOT a baseline", () => {
  const runs = [
    run({ id: "today", occurredAt: "2026-07-25T05:00:00.000Z" }),
    run({ id: "last-month", occurredAt: "2026-06-20T05:00:00.000Z" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ), null);
});

test("same event spanning two days still counts as comparable", () => {
  const runs = [
    run({ id: "sunday", eventId: "ev-4", occurredAt: "2026-07-26T01:00:00.000Z" }),
    run({ id: "saturday", eventId: "ev-4", occurredAt: "2026-07-25T01:00:00.000Z" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ)?.id, "saturday");
});

test("different car or different track is not comparable", () => {
  const otherCar = [
    run({ id: "a" }),
    run({ id: "b", carId: "car-2" }),
  ];
  assert.equal(pickPreviousComparableRun(otherCar, 0, TZ), null);

  const otherTrack = [
    run({ id: "a" }),
    run({ id: "b", trackId: "track-2" }),
  ];
  assert.equal(pickPreviousComparableRun(otherTrack, 0, TZ), null);
});

test("a null car or track can never be a baseline anchor", () => {
  const runs = [run({ id: "a", carId: null }), run({ id: "b", carId: null })];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ), null);
});

test("baseline skips a run the owner hid from the team", () => {
  const runs = [
    run({ id: "q3" }),
    run({ id: "q2-hidden", shareWithTeam: false }),
    run({ id: "q1" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ)?.id, "q1");
});

test("baseline skips drafts", () => {
  const runs = [
    run({ id: "q3" }),
    run({ id: "q2-draft", loggingComplete: false }),
    run({ id: "q1" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ)?.id, "q1");
});

test("baseline never crosses drivers", () => {
  const runs = [
    run({ id: "dave-q2", userId: "dave" }),
    run({ id: "kirra-q1", userId: "kirra" }),
  ];
  assert.equal(pickPreviousComparableRun(runs, 0, TZ), null);
});

// --- setup diff -------------------------------------------------------------

test("setup diff drops sheet header metadata", () => {
  const rows = computeSetupChangedRows(
    { ride_height_rear: "4.0", date: "2026-07-25", name: "Dave", race: "A main", class: "TC Mod" },
    { ride_height_rear: "5.0", date: "2026-07-20", name: "Dave M", race: "Q2", class: "TC Stock" }
  );
  const keys = rows.map((r) => r.key);
  assert.ok(keys.includes("ride_height_rear"), "expected the real tuning change");
  for (const header of ["date", "name", "race", "class"]) {
    assert.ok(!keys.includes(header), `${header} is sheet header, not a setup change`);
  }
});

test("setup diff drops the conditions captured on the sheet — those are reported as context", () => {
  const rows = computeSetupChangedRows(
    { air_temp: "32", track_temp: "38" },
    { air_temp: "28", track_temp: "31" }
  );
  assert.deepEqual(rows, []);
});

test("setup diff treats 5 and 5.0 mm as unchanged", () => {
  const rows = computeSetupChangedRows({ ride_height_rear: "5" }, { ride_height_rear: "5.0 mm" });
  assert.equal(rows.length, 0);
});

test("setup diff reports before and after with a labelled unit", () => {
  const rows = computeSetupChangedRows({ ride_height_rear: "4" }, { ride_height_rear: "5" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "ride_height_rear");
  assert.equal(rows[0].label, "Ride Height (Rear) (mm)");
  assert.equal(rows[0].previousValue, "5");
  assert.equal(rows[0].value, "4");
});

// --- also moved -------------------------------------------------------------

test("temperature rows appear only when both runs have the reading", () => {
  const withBoth = computeAlsoMoved(
    run({ id: "a", conditionsTrackTempC: 32 }),
    run({ id: "b", conditionsTrackTempC: 28 })
  );
  assert.equal(withBoth.filter((r) => r.kind === "trackTemp").length, 1);

  const missingOne = computeAlsoMoved(
    run({ id: "a", conditionsTrackTempC: 32 }),
    run({ id: "b", conditionsTrackTempC: null })
  );
  assert.equal(missingOne.filter((r) => r.kind === "trackTemp").length, 0);
});

test("units: a teammate's temperature move reads in the viewer's unit", () => {
  const baseline = run({ id: "b", conditionsTrackTempC: 20, conditionsAirTempC: 18 });
  const now = run({ id: "a", conditionsTrackTempC: 25, conditionsAirTempC: 18 });
  assert.equal(
    computeAlsoMoved(now, baseline).find((r) => r.kind === "trackTemp")?.detail,
    "20 → 25 °C (+5)"
  );
  // The difference is taken after converting: +5 °C is +9 °F, not +41.
  assert.equal(
    computeAlsoMoved(now, baseline, "imperial").find((r) => r.kind === "trackTemp")?.detail,
    "68 → 77 °F (+9)"
  );
});

test("new tyres only when both stints are known and differ", () => {
  const changed = computeAlsoMoved(
    run({ id: "a", tireStintId: "s2" }),
    run({ id: "b", tireStintId: "s1" })
  );
  assert.equal(changed.find((r) => r.kind === "tires")?.detail, "New set");

  const legacy = computeAlsoMoved(
    run({ id: "a", tireStintId: null }),
    run({ id: "b", tireStintId: null })
  );
  assert.equal(legacy.filter((r) => r.kind === "tires").length, 0);
});

test("tyre run-count step is suppressed when the age is not known", () => {
  const known = computeAlsoMoved(
    run({ id: "a", tireStintId: "s1", tireRunNumber: 5 }),
    run({ id: "b", tireStintId: "s1", tireRunNumber: 3 })
  );
  assert.equal(known.find((r) => r.kind === "tires")?.detail, "Run 3 → 5");

  const unknown = computeAlsoMoved(
    run({ id: "a", tireStintId: "s1", tireRunNumber: 5, tireAgeKnown: false }),
    run({ id: "b", tireStintId: "s1", tireRunNumber: 3 })
  );
  assert.equal(unknown.filter((r) => r.kind === "tires").length, 0);
});

test("a compound change outranks the run-count step", () => {
  const rows = computeAlsoMoved(
    run({ id: "a", tireStintId: "s2", tireTypeId: "t2", tireTypeLabel: "Sweep 32R" }),
    run({ id: "b", tireStintId: "s1", tireTypeId: "t1", tireTypeLabel: "Sweep 36R" })
  );
  assert.equal(rows.find((r) => r.kind === "tires")?.detail, "Sweep 36R → Sweep 32R");
});

test("nothing moved yields no rows at all", () => {
  const rows = computeAlsoMoved(run({ id: "a" }), run({ id: "b" }));
  assert.deepEqual(rows, []);
});

// --- entry ------------------------------------------------------------------

test("no baseline means no delta and no diff, not a fabricated one", () => {
  const runs = [run({ id: "only", bestLapSeconds: 12.84, setupData: { ride_height_rear: "4" } })];
  const entry = buildFeedEntry(runs, 0, TZ);
  assert.equal(entry.baselineRunId, null);
  assert.equal(entry.paceDeltaSeconds, null);
  assert.deepEqual(entry.changed, []);
  assert.deepEqual(entry.alsoMoved, []);
  assert.equal(entry.bestLapSeconds, 12.84);
});

test("entry carries the pace delta and the setup delta together", () => {
  const runs = [
    run({
      id: "q2",
      occurredAt: "2026-07-25T05:00:00.000Z",
      bestLapSeconds: 12.84,
      setupData: { ride_height_rear: "4" },
      conditionsTrackTempC: 32,
    }),
    run({
      id: "q1",
      occurredAt: "2026-07-25T02:00:00.000Z",
      bestLapSeconds: 13.15,
      setupData: { ride_height_rear: "5" },
      conditionsTrackTempC: 28,
    }),
  ];
  const entry = buildFeedEntry(runs, 0, TZ);
  assert.equal(entry.baselineRunId, "q1");
  assert.equal(formatPaceDelta(entry.paceDeltaSeconds), "−0.31");
  assert.equal(entry.changed.length, 1);
  assert.equal(entry.alsoMoved.length, 1);
});

test("changed rows are capped with an overflow count", () => {
  const keys = [
    "camber_front",
    "camber_rear",
    "toe_front",
    "toe_rear",
    "ride_height_front",
    "ride_height_rear",
    "shock_oil_front",
    "shock_oil_rear",
    "diff",
  ];
  const current: Record<string, string> = {};
  const previous: Record<string, string> = {};
  for (const key of keys) {
    current[key] = "4";
    previous[key] = "5";
  }
  const runs = [
    run({ id: "b", occurredAt: "2026-07-25T05:00:00.000Z", setupData: current }),
    run({ id: "a", occurredAt: "2026-07-25T02:00:00.000Z", setupData: previous }),
  ];
  const entry = buildFeedEntry(runs, 0, TZ);
  assert.equal(entry.changed.length, 4);
  assert.equal(entry.changedOverflow, 5);
});

test("formatPaceDelta always signs the number", () => {
  assert.equal(formatPaceDelta(-0.31), "−0.31");
  assert.equal(formatPaceDelta(0.08), "+0.08");
  assert.equal(formatPaceDelta(0), "±0.00");
  assert.equal(formatPaceDelta(null), null);
});

/**
 * The feed states what changed and what else moved; it never rules on whether the
 * change caused the gain. This guards that decision against a well-meaning later edit.
 */
test("a feed entry carries no attribution verdict", () => {
  const runs = [
    run({ id: "b", occurredAt: "2026-07-25T05:00:00.000Z", bestLapSeconds: 12.8 }),
    run({ id: "a", occurredAt: "2026-07-25T02:00:00.000Z", bestLapSeconds: 13.0 }),
  ];
  const entry = buildFeedEntry(runs, 0, TZ);
  for (const banned of ["verdict", "confounded", "confidence", "score", "attribution"]) {
    assert.ok(!(banned in entry), `TeamFeedEntry must not expose "${banned}"`);
  }
});

test("a front/rear run says which end moved — the two ends are separate sets", () => {
  const front = { frontTireTypeId: "f1", frontTireTypeLabel: "AKA Array Clay", frontTireAgeKnown: true };
  // New fronts only; the rears are the same set, one run older.
  const rows = computeAlsoMoved(
    run({ id: "a", tireStintId: "r1", tireRunNumber: 3, ...front, frontTireStintId: "f-new", frontTireRunNumber: 1 }),
    run({ id: "b", tireStintId: "r1", tireRunNumber: 2, ...front, frontTireStintId: "f-old", frontTireRunNumber: 6 })
  );
  assert.equal(rows.find((r) => r.kind === "tires")?.detail, "Front: New set · Rear: Run 2 → 3");

  // Only the front compound changed, and the rear count is unknown-aged: just the front is said.
  const compound = computeAlsoMoved(
    run({ id: "a", tireStintId: "r1", tireAgeKnown: false, frontTireTypeId: "f2", frontTireTypeLabel: "Dirt Webs", frontTireStintId: "f2s" }),
    run({ id: "b", tireStintId: "r1", tireAgeKnown: false, ...front, frontTireStintId: "f1s" })
  );
  assert.equal(compound.find((r) => r.kind === "tires")?.detail, "Front: AKA Array Clay → Dirt Webs");

  // Nothing moved on either end: no row at all.
  const same = computeAlsoMoved(
    run({ id: "a", tireStintId: "r1", tireRunNumber: 2, ...front, frontTireStintId: "f1s", frontTireRunNumber: 4 }),
    run({ id: "b", tireStintId: "r1", tireRunNumber: 2, ...front, frontTireStintId: "f1s", frontTireRunNumber: 4 })
  );
  assert.equal(same.filter((r) => r.kind === "tires").length, 0);
});
