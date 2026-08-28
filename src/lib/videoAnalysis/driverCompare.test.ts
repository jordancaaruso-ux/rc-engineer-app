/**
 * Driver-vs-driver sector compare: segments from lines, top-5 average vs best, the quarter-off
 * artefact rule, and the story a matrix row tells.
 */
import {
  baseLapTotal,
  baseValues,
  bestLap,
  displayName,
  ghostClip,
  lapRows,
  sectorLeaders,
  segmentDefs,
  segmentStats,
  storyCards,
  valueOn,
  type CompareDriver,
  type DriverLap,
} from "./driverCompare";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const LINES = [
  { lineKey: "s2", label: "S2", sortOrder: 2 },
  { lineKey: "sf", label: "Start / Finish", sortOrder: 0 },
  { lineKey: "s1", label: "S1", sortOrder: 1 },
];

// Segments run start line → S1 → S2 → start line, in track order whatever order the lines came in.
{
  const segs = segmentDefs(LINES);
  assert(segs.map((s) => s.name).join() === "S1,S2,S3", `three segments: ${segs.map((s) => s.name).join()}`);
  assert(segs[0]!.fromKey === "start" && segs[0]!.toKey === "s1", "S1 runs from the start line to S1");
  assert(segs[2]!.fromKey === "s2" && segs[2]!.toKey === "end", "the last runs from S2 to the line");
  assert(segs[0]!.fromLabel === "SF" && segs[2]!.toLabel === "SF", "the start line reads SF");
  assert(segmentDefs([LINES[1]!]).length === 0, "no corners, no segments");
}

/** A lap with the given S1/S2 cumulative splits (seconds after the start), `start` on the video clock. */
function lap(lapNumber: number, start: number, s1: number, s2: number, lapTimeSec: number): DriverLap {
  return { lapNumber, lapTimeSec, startSec: start, endSec: start + lapTimeSec, splits: { s1, s2 } };
}

// Me: S1 steady at ~3.0s, one lap with a crash in S1 (5.0s); S2 steady at ~4.0s; the rest ~10.5.
const me: CompareDriver = {
  key: "me",
  name: "You",
  role: "me",
  trust: "confirmed",
  laps: [
    lap(2, 100, 3.0, 7.0, 17.5),
    lap(3, 117.5, 3.1, 7.1, 17.6),
    lap(4, 135.1, 2.9, 6.9, 17.4),
    lap(5, 152.5, 5.0, 9.0, 19.5), // crash in S1
    lap(6, 172.0, 3.0, 7.0, 17.5),
    lap(7, 189.5, 3.2, 7.2, 17.7),
    lap(8, 207.2, 3.05, 7.05, 17.55),
  ],
};
// Sandy: quicker through S1 (~2.8), slower through S2 (~4.3), and a lap missing its S2 crossing.
const sandy: CompareDriver = {
  key: "sandy",
  name: "Sandy Iavazzo",
  trust: "assigned",
  laps: [
    lap(2, 101, 2.8, 7.1, 17.4),
    lap(3, 118.4, 2.85, 7.15, 17.5),
    { lapNumber: 4, lapTimeSec: 17.3, startSec: 135.9, endSec: 153.2, splits: { s1: 2.75 } },
    lap(5, 153.2, 2.8, 7.1, 17.4),
  ],
};

{
  const segs = segmentDefs(LINES);
  const s1 = segmentStats(me, segs[0]!);
  assert(s1.times.length === 7, `every lap has an S1 time: ${s1.times.length}`);
  const crash = s1.times.find((t) => t.lapNumber === 5);
  assert(crash?.suspect === true, "5.0s against a 3.0s median is a crash, not a lap");
  assert(s1.clean.length === 6, `six clean laps: ${s1.clean.length}`);
  assert(s1.best?.lapNumber === 4 && Math.abs(s1.best.sec - 2.9) < 1e-9, `best is lap 4: ${JSON.stringify(s1.best)}`);
  // Top-5 = mean of the five fastest clean: 2.9, 3.0, 3.0, 3.05, 3.1.
  assert(s1.top5 != null && Math.abs(s1.top5 - 3.01) < 1e-9, `top-5 mean: ${s1.top5}`);
  assert(valueOn(s1, "best") === 2.9 && Math.abs(valueOn(s1, "top5")! - 3.01) < 1e-9, "basis picks the figure");
  // The window is the lap's own crossings on the video clock.
  const w = s1.times.find((t) => t.lapNumber === 2)!.window;
  assert(w.startSec === 100 && w.endSec === 103, `S1 window on lap 2: ${JSON.stringify(w)}`);
  // S3 (S2 → line) uses the lap time as the end split.
  const s3 = segmentStats(me, segs[2]!);
  assert(Math.abs(s3.times[0]!.sec - 10.5) < 1e-9, `S3 on lap 2 is 17.5 − 7.0: ${s3.times[0]!.sec}`);
  // Sandy's lap without an S2 crossing has an S1 time but no S2 or S3.
  assert(segmentStats(sandy, segs[0]!).times.length === 4, "Sandy's S1 on four laps");
  assert(segmentStats(sandy, segs[1]!).times.length === 3, "Sandy's S2 on three — lap 4 has no S2 crossing");
  // Nothing at all: honest empties.
  const none = segmentStats({ ...sandy, laps: [] }, segs[0]!);
  assert(none.top5 === null && none.best === null && none.times.length === 0, "no laps, no figures");
}

// The story: Sandy takes S1, you take S2, S3 is close to even — biggest first.
{
  const segs = segmentDefs(LINES);
  const cards = storyCards(me, [sandy], segs, "top5");
  assert(cards.length === 3, `one card per segment: ${cards.length}`);
  assert(cards[0]!.segment.name === "S2" && cards[0]!.deltaSec < 0, `S2 is the biggest edge and it is yours: ${JSON.stringify(cards[0])}`);
  assert(/^You take 0\.\d{3}s a lap out of Sandy Iavazzo through S2$/.test(cards[0]!.sentence), cards[0]!.sentence);
  const s1 = cards.find((c) => c.segment.name === "S1")!;
  assert(s1.deltaSec > 0 && /^Sandy Iavazzo takes/.test(s1.sentence), s1.sentence);
  const best = storyCards(me, [sandy], segs, "best");
  assert(!/a lap/.test(best[0]!.sentence), "best-lap basis does not say 'a lap'");
}

// The stint sheet: rows per lap, the base, the ghost, and the leaderboard line.
{
  const segs = segmentDefs(LINES);
  const meStats = segs.map((s) => segmentStats(me, s));
  const rows = lapRows(me, meStats);
  assert(rows.length === 7 && rows[0]!.lapNumber === 2, `a row per lap in lap order: ${rows.map((r) => r.lapNumber).join()}`);
  assert(rows.every((r) => r.cells.length === 3), "a cell per segment");
  const crash = rows.find((r) => r.lapNumber === 5)!;
  assert(!crash.clean && crash.cells[0]!.suspect, "the crash lap is not clean");
  assert(rows.find((r) => r.lapNumber === 2)!.window.startSec === 100, "the row's window is the whole lap");
  // Best lap = the quickest CLEAN lap: lap 4 at 17.4.
  const best = bestLap(rows);
  assert(best?.lapNumber === 4, `best lap is 4: ${best?.lapNumber}`);
  // Sandy's lap without an S2 crossing is a row with a hole, not a missing row.
  const sRows = lapRows(sandy, segs.map((s) => segmentStats(sandy, s)));
  assert(sRows.length === 4 && sRows[2]!.cells[1] == null && !sRows[2]!.clean, "a missing crossing is a hole in the row");

  // Base values: the average, the best lap's own times, or the same lap number.
  const avg = baseValues("top5", meStats, rows, null);
  assert(Math.abs(avg[0]! - 3.01) < 1e-9, `top-5 base for S1: ${avg[0]}`);
  const bst = baseValues("best", meStats, rows, null);
  assert(Math.abs(bst[0]! - 2.9) < 1e-9 && Math.abs(bst[1]! - 4.0) < 1e-9, `best-lap base is lap 4's own times: ${bst.join()}`);
  const same = baseValues("same", meStats, rows, 3);
  assert(Math.abs(same[0]! - 3.1) < 1e-9, `same-lap base for lap 3: ${same[0]}`);
  assert(baseValues("same", meStats, rows, 99).every((v) => v == null), "no such lap, no base");
  assert(baseLapTotal("best", meStats, rows, null) === 17.4, "best-lap total is the lap time");
  assert(Math.abs(baseLapTotal("top5", meStats, rows, null)! - (3.01 + 4.0 + 10.5)) < 1e-6, `average lap total: ${baseLapTotal("top5", meStats, rows, null)}`);

  // The ghost: a single lap is itself; an average plays the clean lap closest to it.
  const gBest = ghostClip("best", meStats, rows, "lap", null);
  assert(gBest?.lapNumber === 4 && gBest.window.startSec === 135.1, `best-lap ghost is lap 4 whole: ${JSON.stringify(gBest)}`);
  const gSame = ghostClip("same", meStats, rows, 0, 6);
  assert(gSame?.lapNumber === 6 && Math.abs(gSame.sec - 3.0) < 1e-9, `same-lap ghost is lap 6's S1: ${JSON.stringify(gSame)}`);
  const gAvg = ghostClip("top5", meStats, rows, 0, null);
  // S1 top-5 = 3.01; the closest clean S1 is 3.0 (laps 2 and 6 tie — the first wins).
  assert(gAvg?.lapNumber === 2 && Math.abs(gAvg.sec - 3.0) < 1e-9, `average ghost is the closest clean S1: ${JSON.stringify(gAvg)}`);
  const gAvgLap = ghostClip("top5", meStats, rows, "lap", null);
  // Average lap = 17.51; the closest clean lap time is 17.5 (lap 2, before lap 6 on the tie).
  assert(gAvgLap?.lapNumber === 2 && gAvgLap.sec === 17.5, `average whole-lap ghost: ${JSON.stringify(gAvgLap)}`);
  assert(ghostClip("same", meStats, rows, "lap", 99) === null, "no such lap, no ghost");

  // Leaders: Sandy holds S1 (~2.8 vs 3.0) and S3 (10.3 vs 10.5), you hold S2 (4.0 vs 4.3).
  const stat = (d: CompareDriver, s: (typeof segs)[number]) => segmentStats(d, s);
  const leaders = sectorLeaders([me, sandy], segs, stat);
  assert(leaders[0]?.driver.key === "sandy" && leaders[1]?.driver.key === "me" && leaders[2]?.driver.key === "sandy", `leaders: ${leaders.map((l) => l?.driver.key).join()}`);
  assert(sectorLeaders([{ ...sandy, laps: [] }], segs, stat).every((l) => l == null), "nobody, no leader");
}

// Names off the timing site.
{
  assert(displayName("SANDY IAVAZZO") === "Sandy Iavazzo", displayName("SANDY IAVAZZO"));
  assert(displayName("[JUSTIN VERGUNST]") === "Justin Vergunst", displayName("[JUSTIN VERGUNST]"));
  assert(displayName("Chris Kalfoglou M") === "Chris Kalfoglou M", "already cased stays");
  assert(displayName("") === "Driver", "empty has a name");
}

console.log("videoAnalysis driverCompare.test.ts OK");
