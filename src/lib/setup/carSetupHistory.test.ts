import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarSetupHistory,
  carSetupCounts,
  type SetupHistoryDocumentInput,
  type SetupHistoryRunInput,
} from "@/lib/setup/carSetupHistory";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";

const CAR_ID = "car1";

function run(
  over: Omit<Partial<SetupHistoryRunInput>, "createdAt"> & { id: string; createdAt: string }
): SetupHistoryRunInput {
  return {
    sessionType: "TESTING",
    meetingSessionType: null,
    meetingSessionCode: null,
    sessionLabel: null,
    setupSnapshotId: `snap-${over.id}`,
    track: { name: "TFTR" },
    event: null,
    setupSnapshot: { setupDeltaJson: {}, baseSetupSnapshotId: "base" },
    ...over,
    createdAt: new Date(over.createdAt),
  };
}

function build(runs: SetupHistoryRunInput[], documents: SetupHistoryDocumentInput[] = []) {
  return buildCarSetupHistory({
    carId: CAR_ID,
    runs,
    documents,
    labelForKey: (k) => `L:${k}`,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
}

test("tire additive and prep keys never count as a setup change", () => {
  assert.deepEqual(
    chassisChangedKeys({
      at15_front: 1,
      at15_rear: 1,
      st205_front: 1,
      st205_rear: 1,
      additive_time: 10,
      additive: "XTR",
      tires: { label: "set 4" },
    }),
    []
  );
});

test("an additive-only run earns no row", () => {
  const entries = build([
    run({
      id: "r1",
      createdAt: "2026-07-19T06:48:41Z",
      setupSnapshot: {
        setupDeltaJson: { at15_front: 1, at15_rear: 1, additive_time: 10 },
        baseSetupSnapshotId: "base",
      },
    }),
  ]);
  assert.equal(entries.length, 0);
});

test("a chassis change earns a row with human labels", () => {
  const entries = build([
    run({
      id: "r1",
      createdAt: "2026-07-15T11:44:59Z",
      sessionType: "RACE_MEETING",
      meetingSessionType: "RACE",
      event: { name: "Clubday" },
      track: { name: "Boronia" },
      setupSnapshot: {
        setupDeltaJson: { toe_rear: 3, rear_hrb_setting: 2.75, at15_front: 1, additive_time: 15 },
        baseSetupSnapshotId: "base",
      },
    }),
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "run");
  assert.equal(entries[0].title, "Clubday · Race");
  assert.equal(entries[0].meta, "Boronia");
  assert.deepEqual(entries[0].changedLabels, ["L:toe_rear", "L:rear_hrb_setting"]);
  assert.equal(entries[0].href, `/cars/${CAR_ID}/setups/snap-r1`);
});

test("a run with no baseline is the first setup on the car, so it earns a row", () => {
  const entries = build([
    run({
      id: "r1",
      createdAt: "2026-06-02T02:00:00Z",
      setupSnapshot: { setupDeltaJson: null, baseSetupSnapshotId: null },
    }),
  ]);
  assert.equal(entries.length, 1);
  assert.match(entries[0].meta, /first setup on this car/);
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
      createdAt: "2026-07-15T11:44:59Z",
      setupSnapshot: {
        setupDeltaJson: { toe_rear: 3 },
        baseSetupSnapshotId: "base",
        isLibrary: true,
        name: "Bayside qualifier",
      },
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
    run({
      id: "r1",
      createdAt: "2026-07-15T11:44:59Z",
      event: { name: "Clubday" },
      setupSnapshot: { setupDeltaJson: { toe_rear: 3 }, baseSetupSnapshotId: "base" },
    }),
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
        id: "r1",
        createdAt: "2026-07-15T00:00:00Z",
        setupSnapshot: { setupDeltaJson: { toe_rear: 3 }, baseSetupSnapshotId: "base" },
      }),
      run({
        id: "r2",
        createdAt: "2026-07-16T00:00:00Z",
        setupSnapshot: {
          setupDeltaJson: { camber_front: 1 },
          baseSetupSnapshotId: "base",
          isLibrary: true,
          name: "Kept one",
        },
      }),
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
      run({
        id: "r1",
        createdAt: "2026-07-15T11:44:59Z",
        setupSnapshot: { setupDeltaJson: { toe_rear: 3 }, baseSetupSnapshotId: "base" },
      }),
      run({
        id: "r2",
        createdAt: "2026-07-22T11:44:59Z",
        setupSnapshot: { setupDeltaJson: { camber_front: 1.5 }, baseSetupSnapshotId: "base" },
      }),
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
