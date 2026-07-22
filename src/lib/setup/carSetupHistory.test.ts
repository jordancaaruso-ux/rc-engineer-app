import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCarSetupHistory,
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
