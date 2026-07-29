import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSetupCar,
  pickCurrentSetup,
  type CurrentSetupCandidate,
  type LastRunSetupRef,
} from "@/lib/setup/dashboardSetups";

const CAR = { id: "car1", name: "Mugen MTC3", chassisName: "Mugen MTC3", supportsUpload: false };

function setup(id: string, name: string | null, createdAt: string): CurrentSetupCandidate {
  return { id, name, createdAt: new Date(createdAt) };
}

function lastRun(setupSnapshotId: string, sessionLabel: string, at: string): LastRunSetupRef {
  return { setupSnapshotId, sessionLabel, at: new Date(at) };
}

/** Newest first, the order the loader reads them in. */
const LIBRARY = [
  setup("s3", "Astro high bite", "2026-06-28T00:00:00Z"),
  setup("s2", "Bunbury R3", "2026-05-14T00:00:00Z"),
  setup("s1", "Kit baseline", "2026-04-02T00:00:00Z"),
];

test("the last run's own snapshot wins — even when saved baselines exist", () => {
  // The run drifted from any baseline; what was on the car is the run's snapshot, not s3.
  const current = pickCurrentSetup({
    lastRun: lastRun("run-snap", "Race · TFTR · Whale", "2026-07-26T00:00:00Z"),
    librarySetups: LIBRARY,
  });
  assert.equal(current?.id, "run-snap");
  assert.equal(current?.name, "Race · TFTR · Whale");
  assert.equal(current?.fromRun, true);
});

test("a car never run falls back to the newest saved baseline", () => {
  const current = pickCurrentSetup({ lastRun: null, librarySetups: LIBRARY });
  assert.equal(current?.id, "s3");
  assert.equal(current?.fromRun, false);
});

test("a car with no runs and nothing saved has no current setup", () => {
  assert.equal(pickCurrentSetup({ lastRun: null, librarySetups: [] }), null);
});

test("the row carries the run label and date, and keeps the car's upload door", () => {
  const row = buildDashboardSetupCar({
    car: { ...CAR, supportsUpload: true },
    lastRun: lastRun("run-snap", "Race · TFTR · Whale", "2026-07-26T00:00:00Z"),
    librarySetups: LIBRARY,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  assert.deepEqual(row.current, {
    id: "run-snap",
    name: "Race · TFTR · Whale",
    dateLabel: "2026-07-26",
    fromRun: true,
  });
  assert.equal(row.supportsUpload, true);
  assert.equal(row.name, "Mugen MTC3");
});

test("a run with no session/track facts still renders a label", () => {
  const row = buildDashboardSetupCar({
    car: CAR,
    lastRun: lastRun("run-snap", "", "2026-07-26T00:00:00Z"),
    librarySetups: [],
    formatDate: () => "26 Jul",
  });
  assert.equal(row.current?.name, "Last run's setup");
});

test("an unnamed baseline fallback still renders a label", () => {
  const row = buildDashboardSetupCar({
    car: CAR,
    lastRun: null,
    librarySetups: [setup("s1", null, "2026-04-02T00:00:00Z")],
    formatDate: () => "2 Apr",
  });
  assert.equal(row.current?.name, "Untitled setup");
  assert.equal(row.current?.fromRun, false);
});

test("a car with nothing at all reports null so the card can offer to create one", () => {
  const row = buildDashboardSetupCar({
    car: CAR,
    lastRun: null,
    librarySetups: [],
    formatDate: () => "",
  });
  assert.equal(row.current, null);
});
