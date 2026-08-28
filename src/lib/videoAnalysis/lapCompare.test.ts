import {
  buildCompareSummary,
  collectCompareCars,
  compareLaps,
  defaultLapPair,
  formatSignedDeltaSec,
  type CompareLap,
} from "./lapCompare";
import type { VideoAnalysisResultV1 } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

const LINES = [
  { id: "s1", label: "Sweeper" },
  { id: "s2", label: "S2" },
];

function lap(overrides: Partial<CompareLap>): CompareLap {
  return {
    carId: 1,
    carLabel: "Car 1",
    lapIndex: 1,
    lapTimeSec: 17.4,
    startSec: 100,
    endSec: 117.4,
    splits: { s1: 5.0, s2: 11.0 },
    ...overrides,
  };
}

// --- segment math: boundaries, deltas sum to total, absolute windows ---
{
  const a = lap({ lapIndex: 12, lapTimeSec: 17.4, startSec: 200, splits: { s1: 5.0, s2: 11.0 } });
  const b = lap({ lapIndex: 8, lapTimeSec: 17.7, startSec: 100, splits: { s1: 5.2, s2: 11.4 } });
  const rep = compareLaps(a, b, LINES);

  assert(rep.segments.length === 3, `expected 3 segments, got ${rep.segments.length}`);
  const [g1, g2, g3] = rep.segments;
  assert(close(g1!.deltaSec, 5.0 - 5.2), `S1 delta wrong: ${g1!.deltaSec}`);
  assert(close(g2!.deltaSec, 6.0 - 6.2), `S2 delta wrong: ${g2!.deltaSec}`);
  assert(close(g3!.deltaSec, 6.4 - 6.3), `S3 delta wrong: ${g3!.deltaSec}`);
  const sum = rep.segments.reduce((s, x) => s + x.deltaSec, 0);
  assert(close(sum, rep.totalDeltaSec), `segment deltas ${sum} != total ${rep.totalDeltaSec}`);
  assert(close(rep.totalDeltaSec, -0.3), `total delta wrong: ${rep.totalDeltaSec}`);

  // Absolute clip windows: lap start offset applied per lap.
  assert(close(g1!.aWindow.startSec, 200) && close(g1!.aWindow.endSec, 205), "S1 aWindow wrong");
  assert(close(g1!.bWindow.startSec, 100) && close(g1!.bWindow.endSec, 105.2), "S1 bWindow wrong");
  assert(close(g3!.aWindow.endSec, 217.4), "final aWindow must end at lap end");

  // Labels: segment 1 ends at the Sweeper line; final segment ends at start/finish.
  assert(g1!.toLabel === "Sweeper", `expected Sweeper toLabel, got ${g1!.toLabel}`);
  assert(g1!.fromLabel === "Start/finish", `expected SF fromLabel, got ${g1!.fromLabel}`);
  assert(g3!.toLabel === "Start/finish", `expected SF final toLabel, got ${g3!.toLabel}`);

  // share: largest |delta| = 1.
  const maxShare = Math.max(...rep.segments.map((s) => s.share));
  assert(close(maxShare, 1), `max share should be 1, got ${maxShare}`);
}

// --- missing split on one lap → line dropped, segments merge, sum still exact ---
{
  const a = lap({ lapTimeSec: 17.4, splits: { s1: 5.0, s2: 11.0 } });
  const b = lap({ lapTimeSec: 17.6, splits: { s1: 5.1 } }); // s2 missed (occlusion)
  const rep = compareLaps(a, b, LINES);
  assert(rep.segments.length === 2, `expected 2 segments, got ${rep.segments.length}`);
  const sum = rep.segments.reduce((s, x) => s + x.deltaSec, 0);
  assert(close(sum, rep.totalDeltaSec), "merged segments must still sum to total");
}

// --- non-monotonic B split (id-swap glitch) → line dropped ---
{
  const a = lap({ splits: { s1: 5.0, s2: 11.0 } });
  const b = lap({ lapTimeSec: 17.6, splits: { s1: 12.0, s2: 11.0 } }); // s2 before s1 in B
  const rep = compareLaps(a, b, LINES);
  // s1 kept (b split 12.0), s2 dropped (b 11.0 <= 12.0 not monotonic after s1)
  assert(rep.segments.length === 2, `expected 2 segments after drop, got ${rep.segments.length}`);
  const sum = rep.segments.reduce((s, x) => s + x.deltaSec, 0);
  assert(close(sum, rep.totalDeltaSec), "sum must hold after monotonic drop");
}

// --- no common lines → single full-lap segment ---
{
  const a = lap({ splits: {} });
  const b = lap({ lapTimeSec: 17.6, splits: {} });
  const rep = compareLaps(a, b, LINES);
  assert(rep.segments.length === 1, "expected single full-lap segment");
  assert(rep.segments[0]!.name === "Full lap", `got ${rep.segments[0]!.name}`);
  assert(rep.summary.includes("whole-lap"), `summary should flag whole-lap: ${rep.summary}`);
}

// --- collectCompareCars: corrections applied, primary car (most laps) first ---
{
  const result: VideoAnalysisResultV1 = {
    version: 1,
    sectorLines: [{ id: "s1", label: "S1", x1: 0, y1: 0, x2: 1, y2: 0 }],
    tracks: [
      {
        motTrackId: 2,
        lapCount: 1,
        bestLapSec: 18.0,
        laps: [
          { lapIndex: 1, lapTimeSec: 18.0, startSec: 0, endSec: 18, sectorTimesSec: { s1: 6 } },
        ],
      },
      {
        motTrackId: 1,
        lapCount: 3,
        bestLapSec: 17.0,
        laps: [
          { lapIndex: 1, lapTimeSec: 17.5, startSec: 0, endSec: 17.5, sectorTimesSec: { s1: 5.6 } },
          { lapIndex: 2, lapTimeSec: 17.0, startSec: 17.5, endSec: 34.5, sectorTimesSec: { s1: 5.4 } },
          { lapIndex: 3, lapTimeSec: 17.2, startSec: 34.5, endSec: 51.7, sectorTimesSec: { s1: 5.5 } },
        ],
      },
    ],
  };
  const cars = collectCompareCars(result, [{ fromId: 2, toId: 9, startSec: 0, endSec: 100 }]);
  assert(cars[0]!.carId === 1, "primary car (most laps) must sort first");
  assert(cars.some((c) => c.carId === 9), "id correction must be applied");

  const pair = defaultLapPair(cars[0]!);
  assert(pair !== null, "default pair expected");
  assert(pair!.a.lapIndex === 2 && pair!.b.lapIndex === 3, "best vs 2nd-best selection wrong");

  const single = cars.find((c) => c.carId === 9)!;
  assert(defaultLapPair(single) === null, "single-lap car has no default pair");
}

// --- summary template branches ---
{
  const seg = (deltaSec: number, name: string, toLabel = name): Parameters<typeof buildCompareSummary>[0][number] => ({
    key: name,
    name,
    fromLabel: "Start/finish",
    toLabel,
    aSec: 5,
    bSec: 5 - deltaSec,
    deltaSec,
    share: 1,
    aWindow: { startSec: 0, endSec: 5 },
    bWindow: { startSec: 0, endSec: 5 },
  });

  const even = buildCompareSummary([seg(0.005, "S1"), seg(-0.01, "S2")], 1);
  assert(even.startsWith("Dead even"), `even branch: ${even}`);

  const concentrated = buildCompareSummary([seg(-0.25, "S3", "Sweeper"), seg(-0.05, "S1")], 2);
  assert(
    concentrated === "Almost all of it came in Sweeper.",
    `concentrated branch: ${concentrated}`
  );

  const topTwo = buildCompareSummary([seg(-0.12, "S3"), seg(-0.11, "S4"), seg(-0.06, "S1")], 3);
  assert(topTwo.includes("S3 and S4"), `top-two branch: ${topTwo}`);

  const spread = buildCompareSummary(
    [seg(-0.05, "S1"), seg(-0.05, "S2"), seg(-0.05, "S3"), seg(-0.05, "S4"), seg(-0.05, "S5")],
    5
  );
  assert(spread.startsWith("Spread across the lap"), `spread branch: ${spread}`);

  const mixed = buildCompareSummary([seg(-0.2, "S3", "Sweeper"), seg(0.12, "S1")], 2);
  assert(
    mixed === "Gained 0.20s in Sweeper, gave 0.12s back in S1.",
    `mixed branch: ${mixed}`
  );

  const lost = buildCompareSummary([seg(0.2, "S2")], 2);
  assert(lost === "Almost all of it went in S2.", `lost branch: ${lost}`);
}

// --- formatting ---
{
  assert(formatSignedDeltaSec(-0.254) === "−0.254", "negative format");
  assert(formatSignedDeltaSec(0.04) === "+0.040", "positive format");
  assert(formatSignedDeltaSec(-0.2543, 2) === "−0.25", "decimals param");
}

// --- the default pair prefers laps that carry sector splits ---
{
  const lap = (lapIndex: number, lapTimeSec: number, splits: Record<string, number>): CompareLap => ({
    carId: 1, carLabel: "You", lapIndex, lapTimeSec,
    startSec: 100 + lapIndex * 20, endSec: 100 + lapIndex * 20 + lapTimeSec, splits,
  });
  // The quickest lap has nothing marked on it: it can only say "whole-lap delta only".
  const car = { carId: 1, carLabel: "You", lapCount: 4, bestLapSec: 17.0,
    laps: [lap(2, 17.0, {}), lap(3, 17.4, { s1: 4.1 }), lap(4, 17.2, { s1: 4.0 }), lap(5, 17.9, {})] };
  const pair = defaultLapPair(car);
  assert(pair && pair.a.lapIndex === 4 && pair.b.lapIndex === 3, "the two quickest laps WITH splits are the default pair");
  const bare = { ...car, lapCount: 2, laps: [lap(2, 17.0, {}), lap(3, 17.4, {})] };
  const p2 = defaultLapPair(bare);
  assert(p2 && p2.a.lapIndex === 2 && p2.b.lapIndex === 3, "with no splits anywhere, time alone decides");
}

console.log("videoAnalysis lapCompare.test.ts OK");
