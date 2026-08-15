import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarSetupHistory,
  carSetupCounts,
  type SetupHistoryDocumentInput,
  type SetupHistoryRunInput,
} from "@/lib/setup/carSetupHistory";

const CAR_ID = "car1";

/** A minimal chassis setup. Runs below vary one or two keys off this. */
const BASE_SETUP = { camber_front: -1, toe_rear: 3, rear_hrb_setting: 2.5 };

function run(
  over: Omit<Partial<SetupHistoryRunInput>, "sortAt" | "displayAt"> & {
    id: string;
    /** ISO instant — used for both the ordering axis and the displayed date unless overridden. */
    at: string;
    setup?: Record<string, unknown>;
  }
): SetupHistoryRunInput {
  const { at, setup, ...rest } = over;
  return {
    sessionType: "TESTING",
    meetingSessionType: null,
    meetingSessionCode: null,
    sessionLabel: null,
    setupSnapshotId: `snap-${over.id}`,
    track: { name: "TFTR" },
    event: null,
    ...rest,
    setupSnapshot: rest.setupSnapshot ?? { data: { ...BASE_SETUP, ...(setup ?? {}) } },
    sortAt: new Date(at),
    displayAt: new Date(at),
  };
}

function build(
  runs: SetupHistoryRunInput[],
  documents: SetupHistoryDocumentInput[] = [],
  setupBeforeOldestRun: unknown = null
) {
  return buildCarSetupHistory({
    carId: CAR_ID,
    runs,
    documents,
    setupBeforeOldestRun,
    labelForKey: (k) => `L:${k}`,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
}

// ---- what earns a run row: it differs from the run before it -----------------------------------

test("a run whose setup matches the run before it earns no row", () => {
  const entries = build([
    run({ id: "r2", at: "2026-07-20T06:00:00Z" }),
    run({ id: "r1", at: "2026-07-19T06:00:00Z" }),
  ]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["snap-r1"],
    "the same setup twice is one setup — only the run that introduced it is listed"
  );
});

test("tires, additive and prep moving on their own is not a setup change", () => {
  const entries = build([
    run({
      id: "r2",
      at: "2026-07-20T06:00:00Z",
      setup: {
        tires: { tireTypeId: "t2", tireRunNumber: 1 },
        additive: "XTR",
        additive_time: 10,
        at15_front: 1,
        at15_rear: 1,
      },
    }),
    run({
      id: "r1",
      at: "2026-07-19T06:00:00Z",
      setup: { tires: { tireTypeId: "t1", tireRunNumber: 4 }, additive: "Juice", additive_time: 15 },
    }),
  ]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["snap-r1"]
  );
});

test("the sheet header — date, track, temps — is not a setup change either", () => {
  const entries = build([
    run({
      id: "r2",
      at: "2026-07-20T06:00:00Z",
      setup: { date: "2026-07-20", track: "Boronia", air_temp: 24, track_temp: 31 },
    }),
    run({
      id: "r1",
      at: "2026-07-19T06:00:00Z",
      setup: { date: "2026-07-19", track: "TFTR", air_temp: 18, track_temp: 22 },
    }),
  ]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["snap-r1"]
  );
});

test("a chassis change earns a row with human labels", () => {
  const entries = build([
    run({
      id: "r2",
      at: "2026-07-15T11:44:59Z",
      sessionType: "RACE_MEETING",
      meetingSessionType: "RACE",
      event: { name: "Clubday" },
      track: { name: "Boronia" },
      setup: { toe_rear: 3.5, rear_hrb_setting: 2.75, additive_time: 15 },
    }),
    run({ id: "r1", at: "2026-07-14T11:44:59Z" }),
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "run");
  assert.equal(entries[0].title, "Clubday · Race");
  assert.equal(entries[0].meta, "Boronia");
  assert.deepEqual(entries[0].changedLabels, ["L:rear_hrb_setting", "L:toe_rear"]);
  assert.equal(entries[0].href, `/cars/${CAR_ID}/setups/snap-r2`);
});

test("the first run on a car earns a row, with nothing to compare against", () => {
  const entries = build([run({ id: "r1", at: "2026-06-02T02:00:00Z" })]);
  assert.equal(entries.length, 1);
  assert.deepEqual(
    entries[0].changedLabels,
    [],
    "no earlier run, so no diff — not 'every field changed'"
  );
  assert.equal(entries[0].meta, "TFTR");
});

test("circling back to an earlier setup is still a change from the run before it", () => {
  const entries = build([
    // Three days of tweaking that land back exactly where they started.
    run({ id: "r3", at: "2026-07-21T06:00:00Z", setup: { camber_front: -1 } }),
    run({ id: "r2", at: "2026-07-20T06:00:00Z", setup: { camber_front: -1.5 } }),
    run({ id: "r1", at: "2026-07-19T06:00:00Z", setup: { camber_front: -1 } }),
  ]);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["snap-r3", "snap-r2", "snap-r1"],
    "the list only ever looks back one run, so returning to an old setup is recorded"
  );
  assert.deepEqual(entries[0].changedLabels, ["L:camber_front"]);
});

test("the oldest run in a capped window diffs against the anchor read beyond it", () => {
  const runs = [run({ id: "r61", at: "2026-07-20T06:00:00Z" })];
  // Anchor identical to it: the window ended here, but nothing actually changed.
  assert.equal(build(runs, [], { ...BASE_SETUP }).length, 0);
  // Anchor different: a real change that happens to sit at the edge of the window.
  assert.equal(build(runs, [], { ...BASE_SETUP, toe_rear: 2 }).length, 1);
});

test("a sheet that created a setup is one row pointing at the setup", () => {
  const entries = build(
    [],
    [
      {
        id: "doc1",
        originalFilename: "A800RR_Caruso_Bayside_QLD_Titles_Starting.pdf",
        createdAt: new Date("2026-07-21T02:44:34Z"),
        parseStatus: "PARSED",
        createdSetupId: "snap-sheet",
      },
    ]
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "sheet");
  assert.equal(entries[0].id, "snap-sheet");
  assert.equal(entries[0].title, "A800RR_Caruso_Bayside_QLD_Titles_Starting");
  assert.equal(entries[0].meta, "Uploaded sheet");
  assert.equal(entries[0].href, `/cars/${CAR_ID}/setups/snap-sheet`);
});

test("a sheet with no setup still shows, pointing at the document", () => {
  const entries = build(
    [],
    [
      {
        id: "doc1",
        originalFilename: "x4-26-wnh0c.pdf",
        createdAt: new Date("2026-07-20T02:00:00Z"),
        parseStatus: "PARTIAL",
        createdSetupId: null,
      },
    ]
  );
  assert.equal(entries[0].href, "/setup-documents/doc1");
  assert.match(entries[0].meta, /needs review/);
});

// ---- saving marks the row it is on; it never adds a second one --------------------------------

test("a saved run is one row with its bookmark filled, not two", () => {
  const entries = build([
    run({
      id: "r1",
      at: "2026-07-15T11:44:59Z",
      setupSnapshot: { data: BASE_SETUP, isLibrary: true, name: "Bayside qualifier" },
    }),
  ]);
  assert.equal(entries.length, 1, "marking must not mint a second row");
  assert.equal(entries[0].kind, "run", "where it came from never changes");
  assert.equal(entries[0].saved, true);
  assert.equal(entries[0].saveAction, "mark");
  assert.equal(entries[0].title, "Bayside qualifier", "the name the driver gave it wins");
  assert.equal(entries[0].usedByRuns, 1, "a run points at it, so it is rename-only");
});

test("an unsaved run keeps its session title and an empty bookmark", () => {
  const entries = build([
    run({ id: "r1", at: "2026-07-15T11:44:59Z", event: { name: "Clubday" } }),
  ]);
  assert.equal(entries[0].saved, false);
  assert.equal(entries[0].title, "Clubday · Testing run");
});

test("a sheet whose values could not be read has nothing to save", () => {
  const entries = build(
    [],
    [
      {
        id: "doc1",
        originalFilename: "x4.pdf",
        createdAt: new Date("2026-07-20T02:00:00Z"),
        parseStatus: "FAILED",
        createdSetupId: null,
      },
    ]
  );
  assert.equal(entries[0].saveAction, "none");
  assert.equal(entries[0].saved, false);
});

test("a baseline opens read-only against the car, can only be copied, and is never 'saved'", () => {
  const entries = buildCarSetupHistory({
    carId: CAR_ID,
    runs: [],
    documents: [],
    baselines: [
      {
        id: "b1",
        name: "Kit setup",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        kindLabel: "Kit",
        contextLabel: "Asphalt · medium grip",
        valueCount: 42,
        notes: "Straight out of the box.",
      },
    ],
    labelForKey: (k) => k,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  assert.equal(entries[0].kind, "baseline");
  assert.equal(entries[0].saveAction, "copy");
  assert.equal(entries[0].saved, false, "a global row is nobody's saved setup");
  assert.equal(
    entries[0].href,
    `/cars/${CAR_ID}/baselines/b1`,
    "a baseline reads on the car's own sheet — it is the copy, not the row, that is editable"
  );
  assert.equal(entries[0].baselineId, "b1");
});

test("a saved setup with no run and no sheet behind it gets its own kind", () => {
  const entries = buildCarSetupHistory({
    carId: CAR_ID,
    runs: [],
    documents: [],
    librarySetups: [
      {
        id: "lib1",
        name: "Cold morning base",
        createdAt: new Date("2026-06-10T00:00:00Z"),
        valueCount: 31,
        runCount: 0,
      },
    ],
    labelForKey: (k) => k,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  assert.equal(entries[0].kind, "saved");
  assert.equal(entries[0].saved, true);
  assert.equal(entries[0].meta, "31 values");
  assert.equal(entries[0].href, `/cars/${CAR_ID}/setups/lib1`);
});

test("a forked setup says where its numbers started", () => {
  const entries = buildCarSetupHistory({
    carId: CAR_ID,
    runs: [],
    documents: [],
    librarySetups: [
      {
        id: "lib1",
        name: "Round 3 rear",
        createdAt: new Date("2026-06-10T00:00:00Z"),
        valueCount: 31,
        runCount: 0,
        editedFrom: "Cold morning base",
      },
      {
        id: "lib2",
        name: "Kit, tweaked",
        createdAt: new Date("2026-06-09T00:00:00Z"),
        valueCount: 42,
        runCount: 0,
        // A baseline copy that was then forked again reads as the copy: the published row is the
        // more useful answer to "where did this come from".
        editedFrom: "Round 3 rear",
        copiedFrom: "Kit setup",
      },
    ],
    labelForKey: (k) => k,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  assert.equal(entries[0].meta, "31 values · Edited from Cold morning base");
  assert.equal(entries[1].meta, "42 values · Copied from Kit setup");
});

// ---- the chips ---------------------------------------------------------------------------------

test("chip counts read kind for origin and the flag for saved", () => {
  const entries = buildCarSetupHistory({
    carId: CAR_ID,
    runs: [
      run({
        id: "r2",
        at: "2026-07-16T00:00:00Z",
        // Camber is stored signed; `normalizeSetupData` forces it negative, so a positive fixture
        // would normalize straight back onto the previous run's value and drop the row.
        setupSnapshot: {
          data: { ...BASE_SETUP, camber_front: -1.5 },
          isLibrary: true,
          name: "Kept one",
        },
      }),
      run({ id: "r1", at: "2026-07-15T00:00:00Z" }),
    ],
    documents: [
      {
        id: "doc1",
        originalFilename: "sheet.pdf",
        createdAt: new Date("2026-07-17T00:00:00Z"),
        parseStatus: "PARSED",
        createdSetupId: "snap-sheet",
        createdSetup: { isLibrary: false, name: null, runCount: 0 },
      },
    ],
    librarySetups: [
      { id: "lib1", name: "Base", createdAt: new Date("2026-06-10T00:00:00Z"), valueCount: 3, runCount: 0 },
    ],
    baselines: [
      {
        id: "b1",
        name: "Kit",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        kindLabel: "Kit",
        contextLabel: null,
        valueCount: 40,
        notes: null,
      },
    ],
    labelForKey: (k) => k,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  const counts = carSetupCounts(entries);
  assert.equal(counts.all, 5);
  assert.equal(counts.run, 2);
  assert.equal(counts.sheet, 1);
  assert.equal(counts.baseline, 1);
  // The saved run and the standalone saved setup — a saved run counts under BOTH Runs and Saved.
  assert.equal(counts.saved, 2);
});

test("runs and sheets interleave newest first", () => {
  const entries = build(
    [
      run({ id: "r2", at: "2026-07-22T11:44:59Z", setup: { camber_front: -1.5 } }),
      run({ id: "r1", at: "2026-07-15T11:44:59Z" }),
    ],
    [
      {
        id: "doc1",
        originalFilename: "sheet.pdf",
        createdAt: new Date("2026-07-21T02:44:34Z"),
        parseStatus: "PARSED",
        createdSetupId: "snap-sheet",
      },
    ]
  );
  assert.deepEqual(
    entries.map((e) => e.id),
    ["snap-r2", "snap-sheet", "snap-r1"]
  );
});
