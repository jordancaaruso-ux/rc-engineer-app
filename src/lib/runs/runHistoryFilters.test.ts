/**
 * Run: `npx tsx src/lib/runs/runHistoryFilters.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRunHistoryPostFilters,
  applyRunHistoryPostFiltersWithReasons,
  buildRunHistoryPrismaWhere,
  computeChangedKeysByRun,
  countActiveRunHistoryFilters,
  describeRunHistoryFilters,
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

test("countActiveRunHistoryFilters counts groups, not values, and ignores q/sort/layout", () => {
  assert.equal(
    countActiveRunHistoryFilters(
      parseRunHistoryFilters({ q: "wet", sort: "best_lap_asc", layout: "flat" })
    ),
    0
  );
  // Three cars is one filter, not three.
  assert.equal(countActiveRunHistoryFilters(parseRunHistoryFilters({ carIds: "a,b,c" })), 1);
  assert.equal(
    countActiveRunHistoryFilters(
      parseRunHistoryFilters({ carIds: "a", ratingBands: "good", status: "draft" })
    ),
    3
  );
});

test("parseRunHistoryFilters round-trips rating bands and drops unknown slugs", () => {
  const parsed = parseRunHistoryFilters({ ratingBands: "dialled,nonsense,good" });
  // Normalized back to band order regardless of how the URL listed them.
  assert.deepEqual(parsed.ratingBands, ["good", "dialled"]);
  assert.equal(filtersToSearchParams(parsed).get("ratingBands"), "good,dialled");

  assert.deepEqual(parseRunHistoryFilters({ ratingBands: "nonsense" }).ratingBands, []);
  assert.equal(filtersToSearchParams(parseRunHistoryFilters({})).get("ratingBands"), null);
});

test("parseRunHistoryFilters round-trips driverIds", () => {
  const parsed = parseRunHistoryFilters({ driverIds: "u1,u2,u1" });
  assert.deepEqual(parsed.driverIds, ["u1", "u2"]);
  assert.equal(filtersToSearchParams(parsed).get("driverIds"), "u1,u2");
});

test("buildRunHistoryPrismaWhere turns rating bands into carRating clauses", () => {
  const banded = buildRunHistoryPrismaWhere(
    parseRunHistoryFilters({ ratingBands: "good,dialled" }),
    {}
  );
  assert.deepEqual(banded.AND, [{ carRating: { in: [7, 8, 9, 10] } }]);

  const unrated = buildRunHistoryPrismaWhere(parseRunHistoryFilters({ ratingBands: "unrated" }), {});
  assert.deepEqual(unrated.AND, [{ carRating: null }]);

  // Mixed: rated band OR no rating at all.
  const mixed = buildRunHistoryPrismaWhere(parseRunHistoryFilters({ ratingBands: "bad,unrated" }), {});
  assert.deepEqual(mixed.AND, [
    { OR: [{ carRating: { in: [1, 2, 3] } }, { carRating: null }] },
  ]);
});

test("buildRunHistoryPrismaWhere composes with an existing AND instead of clobbering it", () => {
  const where = buildRunHistoryPrismaWhere(
    parseRunHistoryFilters({ ratingBands: "dialled", tireTypes: encodeURIComponent("Sweep 36") }),
    { AND: [{ shareWithTeam: true }] }
  );
  const clauses = where.AND as unknown[];
  assert.equal(clauses.length, 3);
  assert.deepEqual(clauses[0], { shareWithTeam: true });
  assert.deepEqual(clauses[2], { carRating: { in: [9, 10] } });
});

test("buildRunHistoryPrismaWhere never sets userId from filters", () => {
  const where = buildRunHistoryPrismaWhere(parseRunHistoryFilters({ driverIds: "u1,u2" }), {
    userId: { in: ["roster1"] },
  });
  // Scope is the caller's to decide — driverIds is intersected with the roster in the page.
  assert.deepEqual(where.userId, { in: ["roster1"] });
  assert.equal(where.AND, undefined);
});

test("free-text search matches a teammate's name when member labels are supplied", () => {
  const runs = [
    makeRun({ id: "mine", userId: "u1" }),
    makeRun({ id: "theirs", userId: "u2" }),
  ];
  const filters = parseRunHistoryFilters({ q: "Priya" });
  const result = applyRunHistoryPostFiltersWithReasons(runs, filters, "UTC", {
    memberLabelByUserId: { u1: "You (Dave)", u2: "Priya" },
  });
  assert.deepEqual(result.runs.map((r) => r.id), ["theirs"]);
  assert.deepEqual(result.reasonsById.get("theirs"), [{ kind: "driver", text: "Priya" }]);

  // Without labels (solo scope) the same query matches nothing.
  assert.equal(applyRunHistoryPostFilters(runs, filters, "UTC").length, 0);
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
      tireType: { displayName: "Vaulk" },
      tireRunNumber: 2,
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
      tireType: { displayName: "Sweep" },
      tireRunNumber: 1,
    },
  ];
  const filters = parseRunHistoryFilters({ q: "vaulk" });
  const out = applyRunHistoryPostFilters(runs, filters, "UTC");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.tireType?.displayName, "Vaulk");
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

test("describeRunHistoryFilters names the filters in play", () => {
  const none = parseRunHistoryFilters({});
  assert.deepEqual(describeRunHistoryFilters(none), []);
  // sort/layout change the view, not which runs are in it — same as the filter count.
  assert.deepEqual(
    describeRunHistoryFilters(parseRunHistoryFilters({ sort: "best_lap_asc", layout: "flat" })),
    []
  );

  // Tire-type values ARE the identity string, so they need no option lookup.
  assert.deepEqual(
    describeRunHistoryFilters(
      parseRunHistoryFilters({ tireTypes: encodeURIComponent("Blue compound") })
    ),
    ["Blue compound"]
  );

  // Ids resolve through the option lists; several of one kind collapse to a count.
  assert.deepEqual(
    describeRunHistoryFilters(parseRunHistoryFilters({ carIds: "c1" }), {
      cars: [{ id: "c1", label: "A800RR" }],
    }),
    ["A800RR"]
  );
  assert.deepEqual(
    describeRunHistoryFilters(parseRunHistoryFilters({ carIds: "c1,c2" }), {
      cars: [{ id: "c1", label: "A800RR" }],
    }),
    ["2 cars"]
  );
  // An id with no matching option still reports *something* — a label you can't
  // read beats a filter that silently isn't mentioned.
  assert.deepEqual(describeRunHistoryFilters(parseRunHistoryFilters({ carIds: "c9" })), ["c9"]);

  // Setup value and setup-change filters carry their condition.
  assert.deepEqual(
    describeRunHistoryFilters(
      parseRunHistoryFilters({ setupField: "camber_front", setupOp: "gte", setupValue: "1.5" })
    ),
    ["Camber (Front) (°) ≥ 1.5"]
  );
  assert.deepEqual(
    describeRunHistoryFilters(
      parseRunHistoryFilters({ setupChangedField: "camber_front", setupChangedDir: "down" })
    ),
    ["Camber (Front) (°) decreased"]
  );

  // Every filter the count knows about produces a label, so the ribbon can never
  // claim fewer reasons than the "Filters · N" button does.
  const all = parseRunHistoryFilters({
    q: "wet",
    carIds: "c1",
    trackIds: "t1",
    tireTypes: encodeURIComponent("Blue"),
    eventId: "e1",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    sessionType: "TESTING",
    meetingSessionType: "QUALIFYING",
    ratingBands: "dialled",
    bestLapMin: "15",
    bestLapMax: "16",
    raceClass: "Modified",
    setupField: "camber_front",
    setupChangedField: "toe_front",
    status: "draft",
  });
  const labels = describeRunHistoryFilters(all);
  // 15 counted filters → 14 labels, and the difference is entirely accounted for:
  // the two date bounds read as one range, the two lap bounds as one span, and `q`
  // adds a label the count deliberately excludes. Adding a filter without a label
  // here breaks this, which is the point.
  assert.equal(countActiveRunHistoryFilters(all), 15);
  assert.equal(labels.length, 14);
  assert.ok(labels.includes("“wet”"));
  // Same month, so the range compacts rather than saying "Jul 2026" twice.
  assert.ok(labels.includes("1 – 31 Jul 2026"), labels.join(" | "));
  assert.ok(
    describeRunHistoryFilters(
      parseRunHistoryFilters({ dateFrom: "2026-06-28", dateTo: "2026-07-01" })
    ).includes("28 Jun 2026 – 1 Jul 2026")
  );
  assert.ok(labels.includes("Best 15–16s"));
});
