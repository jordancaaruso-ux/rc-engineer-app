import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVENT_DIGEST_RUNS,
  shapeEventAnchorDigest,
  shapeEventDigestRunLines,
  summarizeSetupChangeBetweenRuns,
  type EventDigestRunInput,
} from "./eventAnchorDigestShape";

function runInput(id: string, over: Partial<EventDigestRunInput> = {}): EventDigestRunInput {
  return {
    id,
    whenLabel: "Sat 10:00 am",
    sessionLabel: "Q1",
    carId: "car_x4",
    carName: "Xray X4",
    lapCount: 20,
    bestLapSeconds: 14.2,
    avgTop5Seconds: 14.4,
    tireLabel: "CR2",
    carRating: 7,
    snapshotData: { front_camber: "2", front_spring: "gold" },
    ...over,
  };
}

test("setup change summary names movers and counts the rest", () => {
  const summary = summarizeSetupChangeBetweenRuns(
    {
      carId: "a",
      snapshotData: { front_camber: "2.5", front_spring: "silver", rear_camber: "1", ride_height: "5.2" },
    },
    { carId: "a", snapshotData: { front_camber: "2", front_spring: "gold", rear_camber: "1.5", ride_height: "5" } }
  );
  assert.ok(summary?.startsWith("4 keys vs previous run — "), summary ?? "");
  assert.ok(summary?.includes("(+1 more)"), summary ?? "");
});

test("setup change summary is null across different cars and when unchanged", () => {
  const data = { front_camber: "2" };
  assert.equal(
    summarizeSetupChangeBetweenRuns({ carId: "a", snapshotData: data }, { carId: "b", snapshotData: data }),
    null
  );
  assert.equal(
    summarizeSetupChangeBetweenRuns({ carId: "a", snapshotData: data }, { carId: "a", snapshotData: data }),
    null
  );
  assert.equal(summarizeSetupChangeBetweenRuns({ carId: "a", snapshotData: data }, null), null);
});

test("run lines pair each run with the previous run on the SAME car (multi-car meeting)", () => {
  const { lines } = shapeEventDigestRunLines([
    runInput("x4-q1", { carId: "x4", snapshotData: { s: "1" } }),
    runInput("mi9-q1", { carId: "mi9", snapshotData: { s: "9" } }),
    runInput("x4-q2", { carId: "x4", snapshotData: { s: "2" } }),
  ]);
  assert.equal(lines[0].setupChangeSummary, null);
  assert.equal(lines[1].setupChangeSummary, null);
  // x4-q2 diffs against x4-q1, not the interleaved mi9 run.
  assert.ok(lines[2].setupChangeSummary?.includes("1 key"), lines[2].setupChangeSummary ?? "");
});

test("digest keeps the newest runs when over the cap and flags truncation", () => {
  const runs = Array.from({ length: MAX_EVENT_DIGEST_RUNS + 6 }, (_, i) =>
    runInput(`r${i}`, { snapshotData: { s: String(i) } })
  );
  const digest = shapeEventAnchorDigest({
    eventId: "e1",
    name: "State Round 4",
    trackName: "Keilor",
    dateRangeLabel: "25 Jul 2026",
    runsChronological: runs,
    importedFieldStats: [],
  });
  assert.equal(digest.yourRuns.length, MAX_EVENT_DIGEST_RUNS);
  assert.equal(digest.yourRuns[digest.yourRuns.length - 1].runId, `r${runs.length - 1}`);
  assert.equal(digest.truncated, true);
  assert.equal(digest.note, null);
});

test("empty meeting carries an honest note", () => {
  const empty = shapeEventAnchorDigest({
    eventId: "e1",
    name: "Meeting",
    trackName: null,
    dateRangeLabel: "1 Jul 2026",
    runsChronological: [],
    importedFieldStats: [],
  });
  assert.equal(empty.note, "No logged runs or imported timing at this meeting.");
  const timingOnly = shapeEventAnchorDigest({
    eventId: "e1",
    name: "Meeting",
    trackName: null,
    dateRangeLabel: "1 Jul 2026",
    runsChronological: [],
    importedFieldStats: [
      { sessionLabel: "Q1", driverCount: 12, yourRank: 4, gapBestVsFieldMeanSeconds: -0.3 },
    ],
  });
  assert.equal(timingOnly.note, "No logged runs at this meeting — imported timing only.");
});
