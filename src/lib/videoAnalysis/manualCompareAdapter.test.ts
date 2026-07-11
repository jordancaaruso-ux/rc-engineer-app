import { compareCarsFromManualSession } from "./manualCompareAdapter";
import { compareLaps } from "./lapCompare";
import {
  LAP_START_LINE_KEY,
  MANUAL_VIDEO_SESSION_VERSION,
  type ManualFrameMark,
  type ManualVideoSessionV2,
} from "../manualVideoAnalysis/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

const SID = "ts_test";
const LINES = [
  { lineKey: "sf", label: "SF", sortOrder: 0 },
  { lineKey: "s1", label: "Esses", sortOrder: 1 },
];

function mark(
  role: "me" | "competitor",
  lapNumber: number,
  lineKey: string,
  videoTimeSec: number
): ManualFrameMark {
  return { sessionId: SID, driverRole: role, lapNumber, lineKey, videoTimeSec };
}

const session: ManualVideoSessionV2 = {
  version: MANUAL_VIDEO_SESSION_VERSION,
  timingSource: "run",
  timingSessions: [
    {
      sessionId: SID,
      label: "Heat 2",
      isOnVideo: true,
      sync: {},
      drivers: [
        {
          key: "me",
          driverName: "Jordan",
          normalizedName: "jordan",
          role: "me",
          laps: [
            { lapNumber: 1, lapTimeSec: 17.5 },
            { lapNumber: 2, lapTimeSec: 17.3 },
            // No marks of its own — start predicted from lap 2's SF mark.
            { lapNumber: 3, lapTimeSec: 17.9 },
          ],
        },
        {
          key: "comp",
          driverName: "T. Volk",
          normalizedName: "t volk",
          role: "competitor",
          laps: [{ lapNumber: 1, lapTimeSec: 17.2 }],
        },
      ],
    },
  ],
  compare: { my: null, competitor: null, alignAt: "sf_finish" },
  selectedLaps: { me: [1, 2], competitor: [1] },
  marks: [
    mark("me", 1, LAP_START_LINE_KEY, 100.0),
    mark("me", 1, "s1", 104.1),
    mark("me", 1, "sf", 117.5),
    mark("me", 2, LAP_START_LINE_KEY, 117.5),
    mark("me", 2, "s1", 121.4),
    mark("me", 2, "sf", 134.8),
    mark("competitor", 1, LAP_START_LINE_KEY, 102.0),
    mark("competitor", 1, "s1", 106.0),
  ],
};

const cars = compareCarsFromManualSession(session, LINES);

assert(cars.length === 2, `expected 2 cars, got ${cars.length}`);
assert(cars[0]!.carLabel === "You", `"You" must sort first, got ${cars[0]!.carLabel}`);
assert(cars[1]!.carLabel === "T. Volk", `competitor label from driverName, got ${cars[1]!.carLabel}`);

const me = cars[0]!;
assert(
  me.lapCount === 2,
  `unanchored session: unmarked lap 3 must be excluded, got ${me.lapCount}`
);
assert(close(me.bestLapSec, 17.3), `best lap wrong: ${me.bestLapSec}`);

// With an SF anchor set, lap 3's start becomes a real video-time prediction
// (walked from the anchor through transponder lap times) and it joins the pool.
{
  const anchoredSession: ManualVideoSessionV2 = {
    ...session,
    timingSessions: [
      {
        ...session.timingSessions[0]!,
        sync: {
          anchor: { videoTimeSec: 117.5, lapNumber: 1, driverRole: "me", anchorKind: "sf_finish" },
        },
      },
    ],
  };
  const anchoredCars = compareCarsFromManualSession(anchoredSession, LINES);
  const anchoredMe = anchoredCars.find((c) => c.carLabel === "You")!;
  assert(anchoredMe.lapCount === 3, `anchored: lap 3 must be included, got ${anchoredMe.lapCount}`);
  const l3 = anchoredMe.laps.find((l) => l.lapIndex === 3)!;
  assert(close(l3.startSec, 134.8), `anchored predicted start wrong: ${l3.startSec}`);
  assert(Object.keys(l3.splits).length === 0, "unmarked lap must have no splits");
}

const l1 = me.laps.find((l) => l.lapIndex === 1)!;
assert(close(l1.startSec, 100.0), `lap start video time wrong: ${l1.startSec}`);
assert(close(l1.endSec, 117.5), `lap end from sf mark wrong: ${l1.endSec}`);
assert(close(l1.splits.s1!, 4.1), `s1 split must be cumulative: ${l1.splits.s1}`);

// End-to-end through the shared compare: me L2 vs me L1.
const l2 = me.laps.find((l) => l.lapIndex === 2)!;
const rep = compareLaps(l2, l1, [{ id: "s1", label: "Esses" }]);
assert(rep.segments.length === 2, `expected 2 segments, got ${rep.segments.length}`);
assert(close(rep.totalDeltaSec, -0.2, 1e-6), `total delta wrong: ${rep.totalDeltaSec}`);
const sum = rep.segments.reduce((s, x) => s + x.deltaSec, 0);
assert(close(sum, rep.totalDeltaSec, 1e-6), "segments must sum to total");
// Clip window: absolute video times from the manual marks.
assert(close(rep.segments[0]!.aWindow.startSec, 117.5), "aWindow must start at L2's SF mark");
assert(close(rep.segments[0]!.bWindow.endSec, 104.1), "bWindow S1 must end at L1's s1 mark");

// Competitor lap compares cross-car through the same path.
const rival = cars[1]!.laps[0]!;
const cross = compareLaps(me.laps[0]!, rival, [{ id: "s1", label: "Esses" }]);
assert(close(cross.totalDeltaSec, 0.3, 1e-6), `cross-car delta wrong: ${cross.totalDeltaSec}`);

console.log("videoAnalysis manualCompareAdapter.test.ts OK");
