/**
 * Run: `npx tsx src/lib/dashboardHeroSeries.test.ts`
 *
 * The first test is the one that matters: it is the bug this module was written to make
 * impossible. If it ever goes green with a foreign track in the output, the hero is back
 * to plotting two circuits on one axis.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickHeroSeries, type HeroSeriesRun } from "@/lib/dashboardHeroSeries";

const run = (
  id: string,
  trackId: string | null,
  bestLapSeconds: number | null,
): HeroSeriesRun => ({ id, trackId, bestLapSeconds, label: id.toUpperCase() });

const laps = (...times: number[]) =>
  times.map((lapTimeSeconds, i) => ({ lapNumber: i + 1, lapTimeSeconds }));

/** A mixed history: two venues with very different lap lengths, interleaved by date. */
const MIXED: HeroSeriesRun[] = [
  run("a1", "silverstone", 15.34),
  run("b1", "cotswold", 18.44),
  run("a2", "silverstone", 15.21),
  run("b2", "cotswold", 18.21),
  run("a3", "silverstone", 15.04),
];

test("sessions: only the anchor track's runs, never another venue", () => {
  const s = pickHeroSeries({
    anchorRunId: "a3",
    anchorTrackId: "silverstone",
    history: MIXED,
    anchorLaps: laps(15.6, 15.2, 15.04),
  });

  assert.equal(s.kind, "sessions");
  assert.deepEqual(
    s.points.map((p) => p.runId),
    ["a1", "a2", "a3"],
  );
  // The whole point: an 18-second lap can never reach this chart from a 15-second track.
  assert.ok(s.points.every((p) => p.best < 16));
});

test("sessions: oldest first, and capped at the chart's width", () => {
  const many = Array.from({ length: 12 }, (_, i) => run(`r${i}`, "t", 15 - i * 0.01));
  const s = pickHeroSeries({
    anchorRunId: "r11",
    anchorTrackId: "t",
    history: many,
    anchorLaps: [],
  });

  assert.equal(s.points.length, 8);
  // The last eight, still in order — the newest run has to be the final point.
  assert.equal(s.points[0].runId, "r4");
  assert.equal(s.points[7].runId, "r11");
});

test("sessions: runs with no best lap are not points", () => {
  const s = pickHeroSeries({
    anchorRunId: "a3",
    anchorTrackId: "silverstone",
    history: [run("a1", "silverstone", 15.3), run("a2", "silverstone", null), run("a3", "silverstone", 15.0)],
    anchorLaps: [],
  });

  assert.deepEqual(
    s.points.map((p) => p.runId),
    ["a1", "a3"],
  );
});

test("laps: a first visit falls through to the laps inside that run", () => {
  const s = pickHeroSeries({
    anchorRunId: "b1",
    anchorTrackId: "cotswold",
    // Plenty of history — all of it somewhere else.
    history: [run("a1", "silverstone", 15.3), run("a2", "silverstone", 15.1), run("b1", "cotswold", 18.44)],
    anchorLaps: laps(18.9, 18.6, 18.44, 18.7),
  });

  assert.equal(s.kind, "laps");
  assert.deepEqual(
    s.points.map((p) => p.label),
    ["L1", "L2", "L3", "L4"],
  );
  // Lap point ids stay unique per run so React keys can't collide across renders.
  assert.equal(s.points[0].runId, "b1:lap-1");
  assert.equal(new Set(s.points.map((p) => p.runId)).size, 4);
});

test("laps: a run with no track has no venue to scope to, so it plots its own laps", () => {
  const s = pickHeroSeries({
    anchorRunId: "x1",
    anchorTrackId: null,
    history: [run("a1", "silverstone", 15.3), run("a2", "silverstone", 15.1)],
    anchorLaps: laps(14.2, 14.0, 14.4),
  });

  assert.equal(s.kind, "laps");
  assert.equal(s.points.length, 3);
});

test("neither: one session and too few laps hands back the thin session series", () => {
  const s = pickHeroSeries({
    anchorRunId: "b1",
    anchorTrackId: "cotswold",
    history: [run("a1", "silverstone", 15.3), run("b1", "cotswold", 18.44)],
    anchorLaps: laps(18.44),
  });

  // Kind stays "sessions" so the chart shows the empty state that NAMES the track,
  // which tells the driver more than a one-lap chart would.
  assert.equal(s.kind, "sessions");
  assert.equal(s.points.length, 1);
});

test("neither: no runs at all is an empty session series, not a crash", () => {
  const s = pickHeroSeries({
    anchorRunId: null,
    anchorTrackId: null,
    history: [],
    anchorLaps: [],
  });

  assert.equal(s.kind, "sessions");
  assert.deepEqual(s.points, []);
});
