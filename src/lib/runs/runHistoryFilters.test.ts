/**
 * Run: `npx tsx src/lib/runs/runHistoryFilters.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRunHistoryPostFilters,
  applyRunHistoryPostFiltersWithReasons,
  computeChangedKeysByRun,
  filtersToSearchParams,
  parseRunHistoryFilters,
  runHistoryFiltersActive,
  sortRunsForHistory,
} from "@/lib/runs/runHistoryFilters";

/** Minimal run row for matcher tests. */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "r1",
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
    ...overrides,
  } as Parameters<typeof applyRunHistoryPostFilters>[0][number] & { id: string };
}

test("parseRunHistoryFilters round-trips multi-select ids", () => {
  const parsed = parseRunHistoryFilters({
    carIds: "a,b",
    trackIds: "t1,t2",
    tireTypes: encodeURIComponent("Sweep 36") + "," + encodeURIComponent("Vaulk, D36"),
    q: "tftr",
    sort: "best_lap_asc",
    layout: "flat",
  });
  assert.deepEqual(parsed.carIds, ["a", "b"]);
  assert.deepEqual(parsed.trackIds, ["t1", "t2"]);
  // Identities are URI-encoded per item so commas in names survive.
  assert.deepEqual(parsed.tireTypes, ["Sweep 36", "Vaulk, D36"]);
  assert.equal(parsed.q, "tftr");
  assert.equal(parsed.sort, "best_lap_asc");
  assert.equal(parsed.layout, "flat");

  const sp = filtersToSearchParams(parsed);
  assert.equal(sp.get("carIds"), "a,b");
  assert.equal(sp.get("trackIds"), "t1,t2");
  assert.deepEqual(parseRunHistoryFilters({ tireTypes: sp.get("tireTypes") ?? "" }).tireTypes, [
    "Sweep 36",
    "Vaulk, D36",
  ]);
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

test("multi-token query is AND across fields (order-independent)", () => {
  const runs = [
    makeRun({ id: "a", car: { name: "Corolla" }, notes: "very wet session" }),
    makeRun({ id: "b", car: { name: "Corolla" }, notes: "bone dry" }),
    makeRun({ id: "c", car: { name: "Civic" }, notes: "wet and cold" }),
  ];
  // Old contiguous-substring search would fail this; tokenized AND passes.
  const out = applyRunHistoryPostFilters(runs, parseRunHistoryFilters({ q: "wet corolla" }), "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["a"]
  );
});

test("synonyms expand the query (rain → wet)", () => {
  const runs = [makeRun({ id: "a", notes: "track was damp all day" })];
  const out = applyRunHistoryPostFilters(runs, parseRunHistoryFilters({ q: "rain" }), "UTC");
  assert.equal(out.length, 1);
});

test("typo tolerance matches a single-character slip", () => {
  const runs = [makeRun({ id: "a", car: { name: "Corolla" } })];
  const out = applyRunHistoryPostFilters(runs, parseRunHistoryFilters({ q: "corola" }), "UTC");
  assert.equal(out.length, 1);
});

test("text search reaches into setup values (label + value)", () => {
  const runs = [
    makeRun({ id: "a", setupSnapshot: { data: { spring_rear: "4.0" } } }),
    makeRun({ id: "b", setupSnapshot: { data: { spring_rear: "3.5" } } }),
  ];
  const out = applyRunHistoryPostFilters(runs, parseRunHistoryFilters({ q: "spring 4.0" }), "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["a"]
  );
});

test("text search ignores setup-sheet header fields (track/race/date)", () => {
  // A Bayside run whose setup sheet was carried over from TFTR must NOT match
  // a "tftr" query — only real run-level data or setup parameters count.
  const runs = [
    makeRun({
      id: "carried-over",
      track: { name: "Bayside" },
      setupSnapshot: { data: { track: "TFTR", race: "TFTR Testing", spring_rear: "4.0" } },
    }),
    makeRun({ id: "at-tftr", track: { name: "TFTR" } }),
  ];
  const out = applyRunHistoryPostFilters(runs, parseRunHistoryFilters({ q: "tftr" }), "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["at-tftr"]
  );
});

test("setupField + setupValue filter matches on setup parameter", () => {
  const runs = [
    makeRun({ id: "a", setupSnapshot: { data: { spring_rear: "4.0" } } }),
    makeRun({ id: "b", setupSnapshot: { data: { spring_rear: "3.5" } } }),
  ];
  const filters = parseRunHistoryFilters({ setupField: "spring_rear", setupValue: "4.0" });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["a"]
  );
});

test("setupValue is dropped without a setupField anchor", () => {
  const parsed = parseRunHistoryFilters({ setupValue: "4.0" });
  assert.equal(parsed.setupValue, null);
  assert.equal(runHistoryFiltersActive(parsed), false);
});

test("setup threshold gte parses numbers out of stored strings", () => {
  const runs = [
    makeRun({ id: "thick", setupSnapshot: { data: { shock_oil_front: "500cst" } } }),
    makeRun({ id: "thin", setupSnapshot: { data: { shock_oil_front: "400" } } }),
    makeRun({ id: "text", setupSnapshot: { data: { shock_oil_front: "Orange" } } }),
  ];
  const filters = parseRunHistoryFilters({
    setupField: "shock_oil_front",
    setupOp: "gte",
    setupValue: "450",
  });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  // "500cst" parses to 500 ≥ 450; "Orange" has no number → skipped.
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["thick"]
  );
});

test("setup threshold between keeps values inside the range", () => {
  const runs = [
    makeRun({ id: "in", setupSnapshot: { data: { spring_rear: "4.5" } } }),
    makeRun({ id: "below", setupSnapshot: { data: { spring_rear: "3.5" } } }),
    makeRun({ id: "above", setupSnapshot: { data: { spring_rear: "6.0" } } }),
  ];
  const filters = parseRunHistoryFilters({
    setupField: "spring_rear",
    setupOp: "between",
    setupValue: "4",
    setupValue2: "5",
  });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["in"]
  );
});

test("setup eq keeps contains-text semantics for non-numeric values", () => {
  const runs = [
    makeRun({ id: "orange", setupSnapshot: { data: { spring_rear: "Orange progressive" } } }),
    makeRun({ id: "blue", setupSnapshot: { data: { spring_rear: "Blue" } } }),
  ];
  const filters = parseRunHistoryFilters({ setupField: "spring_rear", setupValue: "orange" });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["orange"]
  );
});

test("setupChangedDir filters by direction of the numeric change", () => {
  const base = {
    carId: "car1",
    createdAt: new Date("2025-01-01T10:00:00Z"),
    sortAt: new Date("2025-01-01T10:00:00Z"),
  };
  const first = makeRun({
    ...base,
    id: "first",
    setupSnapshot: { data: { spring_rear: "4.0" } },
  });
  const stiffer = makeRun({
    ...base,
    id: "stiffer",
    createdAt: new Date("2025-01-02T10:00:00Z"),
    sortAt: new Date("2025-01-02T10:00:00Z"),
    setupSnapshot: { data: { spring_rear: "4.5" } },
  });
  const softer = makeRun({
    ...base,
    id: "softer",
    createdAt: new Date("2025-01-03T10:00:00Z"),
    sortAt: new Date("2025-01-03T10:00:00Z"),
    setupSnapshot: { data: { spring_rear: "3.5" } },
  });
  const runs = [first, stiffer, softer];
  const changed = computeChangedKeysByRun(runs);
  // stiffer: 4.0 → 4.5 (up); softer: 4.5 → 3.5 (down)
  assert.deepEqual(changed.get("stiffer")?.get("spring_rear"), { prev: "4.0", cur: "4.5" });

  const up = applyRunHistoryPostFilters(
    runs,
    parseRunHistoryFilters({ setupChangedField: "spring_rear", setupChangedDir: "up" }),
    "UTC",
    { changedKeysByRunId: changed }
  );
  assert.deepEqual(
    up.map((r) => (r as { id: string }).id),
    ["stiffer"]
  );
  const down = applyRunHistoryPostFilters(
    runs,
    parseRunHistoryFilters({ setupChangedField: "spring_rear", setupChangedDir: "down" }),
    "UTC",
    { changedKeysByRunId: changed }
  );
  assert.deepEqual(
    down.map((r) => (r as { id: string }).id),
    ["softer"]
  );
});

test("computeChangedKeysByRun flags fields changed vs previous run on the same car", () => {
  const older = makeRun({
    id: "old",
    carId: "car1",
    createdAt: new Date("2025-01-01T10:00:00Z"),
    sortAt: new Date("2025-01-01T10:00:00Z"),
    setupSnapshot: { data: { toe_front: "3.0", camber_front: "-1.0" } },
  });
  const newer = makeRun({
    id: "new",
    carId: "car1",
    createdAt: new Date("2025-01-02T10:00:00Z"),
    sortAt: new Date("2025-01-02T10:00:00Z"),
    setupSnapshot: { data: { toe_front: "2.0", camber_front: "-1.0" } },
  });
  const changed = computeChangedKeysByRun([newer, older]);
  assert.ok(changed.get("new")?.has("toe_front"));
  assert.ok(!changed.get("new")?.has("camber_front"));

  const filters = parseRunHistoryFilters({ setupChangedField: "toe_front" });
  const out = applyRunHistoryPostFilters([newer, older], filters, "UTC", {
    changedKeysByRunId: changed,
  });
  assert.deepEqual(
    out.map((r) => (r as { id: string }).id),
    ["new"]
  );
});

test("applyRunHistoryPostFiltersWithReasons explains why a run matched", () => {
  const runs = [makeRun({ id: "a", notes: "car had bad understeer mid-corner" })];
  const { runs: kept, reasonsById } = applyRunHistoryPostFiltersWithReasons(
    runs,
    parseRunHistoryFilters({ q: "understeer" }),
    "UTC"
  );
  assert.equal(kept.length, 1);
  const reasons = reasonsById.get("a");
  assert.ok(reasons && reasons.some((r) => r.kind === "note"));
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
