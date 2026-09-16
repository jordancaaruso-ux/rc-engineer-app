/**
 * Run: `npm run test:engineer-history`.
 *
 * The field figures are the numbers the driver races on, so the rank and the sign of every
 * gap must be right: positive = you slower, 0.00 = you were the fastest.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldPaceFromStats } from "@/lib/engineer/fieldPace";
import type { ImportedSessionFieldStatsV1 } from "@/lib/lapImport/computeImportedSessionFieldStats";

function sheet(drivers: Array<[string, number | null, number | null]>): ImportedSessionFieldStatsV1 {
  return {
    version: 1,
    computedAtIso: "2026-09-14T00:00:00Z",
    driverCount: drivers.length,
    drivers: drivers.map(([name, best, top5], i) => ({
      driverId: `d${i}`,
      driverName: name,
      normalizedName: name.toLowerCase(),
      lapCount: 20,
      bestLapSeconds: best,
      avgTop5Seconds: top5,
      avgTop10Seconds: null,
      avgTop15Seconds: null,
      rankByBest: null,
    })),
    field: {
      medianBestSeconds: null,
      medianAvgTop5Seconds: null,
      medianAvgTop10Seconds: null,
      minBestSeconds: null,
      meanBestSeconds: null,
      meanAvgTop5Seconds: null,
      meanAvgTop10Seconds: null,
      meanAvgTop15Seconds: null,
    },
  };
}

test("rank and gaps are measured against the fastest driver and the field median, signed you-minus-them", () => {
  const s = sheet([
    ["Jordan Caruso", 17.50, 17.70],
    ["Fast Driver", 17.20, 17.40],
    ["Mid Driver", 17.80, 18.00],
    ["Slow Driver", 18.30, null],
  ]);
  const p = fieldPaceFromStats(s, ["jordan caruso"], []);
  assert.ok(p);
  assert.equal(p.n, 4);
  assert.equal(p.rank, 2);
  assert.equal(p.gapBestToP1?.toFixed(2), "0.30");
  assert.equal(p.gapTop5ToP1?.toFixed(2), "0.30");
  // median best of 17.2, 17.5, 17.8, 18.3 = 17.65 → -0.15; median top5 of 17.4, 17.7, 18.0 = 17.70 → 0.00
  assert.equal(p.gapBestToMean?.toFixed(2), "-0.15");
  assert.equal(p.gapTop5ToMean?.toFixed(2), "0.00");
});

test("a cut lap is not P1, and a one-lap straggler cannot drag the middle of the field", () => {
  const s = sheet([
    ["Me", 15.86, 15.90],
    ["Cutter", 12.66, 15.80], // a 12.66 in a 15.9 field: not a lap
    ["Other", 15.79, 15.87],
    ["Straggler", 61.0, 62.0], // believable against itself, but the median ignores it
  ]);
  const p = fieldPaceFromStats(s, ["me"], []);
  assert.ok(p);
  assert.equal(p.n, 3, "the cutter's best is dropped");
  assert.equal(p.rank, 2);
  assert.equal(p.gapBestToP1?.toFixed(2), "0.07");
  assert.equal(p.gapBestToMean?.toFixed(2), "0.00", "median of 15.79, 15.86, 61.0 is 15.86");
  assert.deepEqual(
    p.entrants.map((e) => [e.name, e.isMe, e.cut]),
    [["Me", true, false], ["Cutter", false, true], ["Other", false, false], ["Straggler", false, false]],
    "every entrant is kept for the rival comparison, with the cut flagged"
  );
});

test("the fastest driver reads 0.00 to P1 and rank 1", () => {
  const p = fieldPaceFromStats(sheet([["Me", 17.0, 17.2], ["Other", 17.4, 17.6]]), ["me"], []);
  assert.equal(p?.rank, 1);
  assert.equal(p?.gapBestToP1, 0);
});

test("with no name saved, the parser's first driver is you; a one-driver sheet is no field", () => {
  const p = fieldPaceFromStats(sheet([["Someone", 17.0, 17.2], ["Other", 17.4, 17.6]]), [], []);
  assert.equal(p?.rank, 1);
  assert.equal(fieldPaceFromStats(sheet([["Someone", 17.0, 17.2]]), [], []), null);
  assert.equal(fieldPaceFromStats(sheet([["A", 17.0, null], ["B", null, null]]), [], []), null, "one timed entrant");
});

test("guessFirstDriver: false — no name to go on means no field, never the first driver's", () => {
  // The first stored driver is often the heat winner, not you (6 of 51 of the founder's heats).
  const s = sheet([["Heat Winner", 17.0, 17.2], ["Other", 17.4, 17.6]]);
  assert.equal(fieldPaceFromStats(s, [], [], undefined, { guessFirstDriver: false }), null);
  assert.equal(fieldPaceFromStats(s, ["nobody here"], [], undefined, { guessFirstDriver: false }), null);
  assert.equal(fieldPaceFromStats(s, ["other"], [], undefined, { guessFirstDriver: false })?.rank, 2);
});
