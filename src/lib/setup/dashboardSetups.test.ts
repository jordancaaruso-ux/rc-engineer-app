import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSetupCar,
  pickCurrentSetup,
  type CurrentSetupCandidate,
} from "@/lib/setup/dashboardSetups";

const CAR = { id: "car1", name: "Mugen MTC3", chassisName: "Mugen MTC3", supportsUpload: false };

function setup(id: string, name: string | null, createdAt: string): CurrentSetupCandidate {
  return { id, name, createdAt: new Date(createdAt) };
}

/** Newest first, the order the loader reads them in. */
const LIBRARY = [
  setup("s3", "Astro high bite", "2026-06-28T00:00:00Z"),
  setup("s2", "Bunbury R3", "2026-05-14T00:00:00Z"),
  setup("s1", "Kit baseline", "2026-04-02T00:00:00Z"),
];

test("the baseline the last run used wins over the newest saved one", () => {
  assert.equal(pickCurrentSetup({ lastRunBaselineId: "s2", librarySetups: LIBRARY })?.id, "s2");
});

test("no run baseline falls back to the newest saved setup", () => {
  assert.equal(pickCurrentSetup({ lastRunBaselineId: null, librarySetups: LIBRARY })?.id, "s3");
});

test("a deleted baseline falls back rather than reading as no setup", () => {
  assert.equal(pickCurrentSetup({ lastRunBaselineId: "gone", librarySetups: LIBRARY })?.id, "s3");
});

test("a car with no saved setups has no current setup", () => {
  assert.equal(pickCurrentSetup({ lastRunBaselineId: "s2", librarySetups: [] }), null);
});

test("the row carries the setup name and date, and keeps the car's upload door", () => {
  const row = buildDashboardSetupCar({
    car: { ...CAR, supportsUpload: true },
    lastRunBaselineId: "s2",
    librarySetups: LIBRARY,
    formatDate: (at) => at.toISOString().slice(0, 10),
  });
  assert.deepEqual(row.current, { id: "s2", name: "Bunbury R3", dateLabel: "2026-05-14" });
  assert.equal(row.supportsUpload, true);
  assert.equal(row.name, "Mugen MTC3");
});

test("an unnamed baseline still renders a label", () => {
  const row = buildDashboardSetupCar({
    car: CAR,
    lastRunBaselineId: null,
    librarySetups: [setup("s1", null, "2026-04-02T00:00:00Z")],
    formatDate: () => "2 Apr",
  });
  assert.equal(row.current?.name, "Untitled setup");
});

test("a car with nothing saved reports null so the card can offer to create one", () => {
  const row = buildDashboardSetupCar({
    car: CAR,
    lastRunBaselineId: null,
    librarySetups: [],
    formatDate: () => "",
  });
  assert.equal(row.current, null);
});
