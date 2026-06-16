/**
 * Run: `npx tsx src/lib/runs/runHistoryFilters.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRunHistoryPostFilters,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  sortRunsForHistory,
} from "@/lib/runs/runHistoryFilters";

test("parseRunHistoryFilters round-trips multi-select ids", () => {
  const parsed = parseRunHistoryFilters({
    carIds: "a,b",
    trackIds: "t1,t2",
    tireSetIds: "ts1",
    q: "tftr",
    sort: "best_lap_asc",
    layout: "flat",
  });
  assert.deepEqual(parsed.carIds, ["a", "b"]);
  assert.deepEqual(parsed.trackIds, ["t1", "t2"]);
  assert.deepEqual(parsed.tireSetIds, ["ts1"]);
  assert.equal(parsed.q, "tftr");
  assert.equal(parsed.sort, "best_lap_asc");
  assert.equal(parsed.layout, "flat");

  const sp = filtersToSearchParams(parsed);
  assert.equal(sp.get("carIds"), "a,b");
  assert.equal(sp.get("trackIds"), "t1,t2");
  assert.equal(sp.get("q"), "tftr");
  assert.equal(sp.get("sort"), "best_lap_asc");
  assert.equal(sp.get("layout"), "flat");
});

test("parseRunHistoryFilters merges legacy single carId/trackId", () => {
  const parsed = parseRunHistoryFilters({ carId: "c1", trackId: "t1" });
  assert.deepEqual(parsed.carIds, ["c1"]);
  assert.deepEqual(parsed.trackIds, ["t1"]);
});

test("runHistoryFiltersActive ignores sort and layout only", () => {
  assert.equal(runHistoryFiltersActive({ ...parseRunHistoryFilters({ sort: "best_lap_asc" }) }), false);
  assert.equal(runHistoryFiltersActive({ ...parseRunHistoryFilters({ layout: "flat" }) }), false);
  assert.equal(runHistoryFiltersActive({ ...parseRunHistoryFilters({ q: "x" }) }), true);
});

test("applyRunHistoryPostFilters matches tire label in q", () => {
  const runs = [
    {
      createdAt: new Date("2025-01-15T12:00:00Z"),
      sessionCompletedAt: null,
      loggingCompletedAt: null,
      sortAt: null,
      bestLapSeconds: 15.5,
      lapTimes: null,
      sessionLabel: null,
      raceClass: null,
      notes: null,
      driverNotes: null,
      handlingProblems: null,
      carNameSnapshot: null,
      trackNameSnapshot: null,
      tireSet: { label: "Vaulk", setNumber: 2 },
    },
    {
      createdAt: new Date("2025-01-15T12:00:00Z"),
      sessionCompletedAt: null,
      loggingCompletedAt: null,
      sortAt: null,
      bestLapSeconds: 16.0,
      lapTimes: null,
      sessionLabel: null,
      raceClass: null,
      notes: null,
      driverNotes: null,
      handlingProblems: null,
      carNameSnapshot: null,
      trackNameSnapshot: null,
      tireSet: { label: "Sweep", setNumber: 1 },
    },
  ];
  const filters = parseRunHistoryFilters({ q: "vaulk" });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.tireSet?.label, "Vaulk");
});

test("applyRunHistoryPostFilters enforces lap bounds", () => {
  const runs = [
    {
      createdAt: new Date("2025-01-15T12:00:00Z"),
      sessionCompletedAt: null,
      loggingCompletedAt: null,
      sortAt: null,
      bestLapSeconds: 15.4,
      lapTimes: null,
      sessionLabel: null,
      raceClass: null,
      notes: null,
      driverNotes: null,
      handlingProblems: null,
      carNameSnapshot: null,
      trackNameSnapshot: null,
    },
    {
      createdAt: new Date("2025-01-15T12:00:00Z"),
      sessionCompletedAt: null,
      loggingCompletedAt: null,
      sortAt: null,
      bestLapSeconds: 15.6,
      lapTimes: null,
      sessionLabel: null,
      raceClass: null,
      notes: null,
      driverNotes: null,
      handlingProblems: null,
      carNameSnapshot: null,
      trackNameSnapshot: null,
    },
    {
      createdAt: new Date("2025-01-15T12:00:00Z"),
      sessionCompletedAt: null,
      loggingCompletedAt: null,
      sortAt: null,
      bestLapSeconds: 16.2,
      lapTimes: null,
      sessionLabel: null,
      raceClass: null,
      notes: null,
      driverNotes: null,
      handlingProblems: null,
      carNameSnapshot: null,
      trackNameSnapshot: null,
    },
  ];
  const filters = parseRunHistoryFilters({ bestLapMin: "15.4", bestLapMax: "15.6" });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.equal(out.length, 2);
});

test("sortRunsForHistory defaults to completed_desc", () => {
  const older = {
    createdAt: new Date("2025-01-01T12:00:00Z"),
    sessionCompletedAt: null,
    loggingCompletedAt: null,
    sortAt: new Date("2025-01-01T12:00:00Z"),
    bestLapSeconds: null,
    lapTimes: null,
    sessionLabel: null,
    raceClass: null,
    notes: null,
    driverNotes: null,
    handlingProblems: null,
    carNameSnapshot: null,
    trackNameSnapshot: null,
  };
  const newer = {
    ...older,
    createdAt: new Date("2025-02-01T12:00:00Z"),
    sortAt: new Date("2025-02-01T12:00:00Z"),
  };
  const sorted = sortRunsForHistory([older, newer], "completed_desc");
  assert.equal(sorted[0], newer);
});
