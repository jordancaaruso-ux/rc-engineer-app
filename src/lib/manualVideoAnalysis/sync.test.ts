import {
  predictSfEndTime,
  predictSfStartTime,
  buildSfPredictions,
  visibleCrossings,
} from "./sync";
import {
  defaultDriverKeys,
  applyTop3LapSelection,
  setLapIncluded,
  pickBestNLapNumbers,
  namespaceSessionDriverKeys,
} from "./timing";
import { emptyManualSession, newTimingSessionId } from "./types";
import type { ManualDriver, ManualTimingSession } from "./types";
import { getLapAlignmentPreview, getLapAlignSteps } from "./predictSectors";
import { getCompareSfAlignment, hasMarkedLap, videoTimeAtLapSf } from "./sessionModel";
import type { ManualVideoSessionV2 } from "./types";

const me: ManualDriver = {
  key: "me",
  driverName: "Me",
  normalizedName: "me",
  role: "me",
  laps: [
    { lapNumber: 1, lapTimeSec: 12.5 },
    { lapNumber: 2, lapTimeSec: 12.3 },
    { lapNumber: 3, lapTimeSec: 12.4 },
  ],
};

const comp: ManualDriver = {
  key: "c",
  driverName: "Rival",
  normalizedName: "rival",
  role: "competitor",
  laps: [
    { lapNumber: 1, lapTimeSec: 12.2 },
    { lapNumber: 2, lapTimeSec: 12.1 },
    { lapNumber: 3, lapTimeSec: 12.0 },
  ],
};

const timingSession: ManualTimingSession = {
  sessionId: "test",
  label: "Test",
  isOnVideo: true,
  drivers: [me, comp],
  sync: {
    anchor: {
      videoTimeSec: 100,
      lapNumber: 2,
      driverRole: "me",
      anchorKind: "sf_finish",
    },
  },
};

const t3me = predictSfEndTime(me, 3, timingSession);
if (t3me == null || Math.abs(t3me - 112.4) > 0.01) {
  throw new Error(`expected lap 3 me at 112.4, got ${t3me}`);
}

// The rival is placed from the tone, not from the anchor lap: the anchor is the end of my lap 2
// (100 = tone + 12.5 + 12.3), so the tone is 75.2 and the rival's lap 3 ends at
// 75.2 + 12.2 + 12.1 + 12.0 = 111.5 — the same answer the off-video path gives further down.
// The old shortcut said 112 ("everyone ends lap 2 together"), which is only true of lap 1's start.
const t3comp = predictSfEndTime(comp, 3, timingSession);
if (t3comp == null || Math.abs(t3comp - 111.5) > 0.01) {
  throw new Error(`expected comp lap 3 at 111.5 (tone + comp laps 1..3), got ${t3comp}`);
}

const preds = buildSfPredictions(timingSession, [
  { role: "me", lapNumber: 2 },
  { role: "me", lapNumber: 3 },
  { role: "competitor", lapNumber: 3 },
]);
if (preds.length < 3) throw new Error("predictions missing");

const allComp: ManualDriver[] = [
  { key: "a", driverName: "A", normalizedName: "a", role: "competitor", laps: [] },
  { key: "b", driverName: "B", normalizedName: "b", role: "competitor", laps: [] },
];
const keys = defaultDriverKeys(allComp);
if (keys.meKey !== "a" || keys.competitorKey !== "b") {
  throw new Error(`expected a/b keys, got ${keys.meKey}/${keys.competitorKey}`);
}

const sessionId = newTimingSessionId();
let session = applyTop3LapSelection({
  ...emptyManualSession(),
  timingSessions: [{ ...timingSession, sessionId, drivers: [me, comp] }],
});
const meTop = pickBestNLapNumbers(me.laps, 3);
if (
  session.selectedLaps.me.join() !== meTop.join() ||
  session.selectedLaps.me.length !== 3
) {
  throw new Error("expected top 3 fastest laps selected");
}
session = setLapIncluded(session, sessionId, "me", 2, false);
if (session.selectedLaps.me.includes(2)) {
  throw new Error("discarded lap 2 should leave top 3");
}
if (!session.selectedLaps.me.includes(3)) {
  throw new Error("lap 3 should refill top 3 after discarding lap 2");
}

const lines = [
  { lineKey: "s1", label: "S1", sortOrder: 0 },
  { lineKey: "s2", label: "S2", sortOrder: 1 },
  { lineKey: "sf", label: "SF", sortOrder: 2 },
];
const sess = applyTop3LapSelection({
  ...emptyManualSession(),
  timingSessions: [
    {
      ...timingSession,
      sessionId: "align",
      drivers: [me, comp],
      sync: {
        anchor: {
          videoTimeSec: 100,
          lapNumber: 2,
          driverRole: "me",
          anchorKind: "sf_finish",
        },
      },
    },
  ],
});
const prev = getLapAlignmentPreview(sess, lines, "align", "me", 3);
if (!prev?.lapEndSec || prev.lapEndSec < 112) {
  throw new Error(`lap 3 end should be ~112.4, got ${prev?.lapEndSec}`);
}
const steps = getLapAlignSteps(prev!);
if (!steps[0]?.isLapStart || steps[0].videoTimeSec !== prev!.lapStartSec) {
  throw new Error("first step should be exact lap start at SF");
}
if (!steps[steps.length - 1]?.isLapFinish) {
  throw new Error("last step should be lap finish SF");
}

const anchorL1Session: ManualTimingSession = {
  sessionId: "l1",
  label: "L1",
  isOnVideo: true,
  drivers: [me],
  sync: {
    anchor: {
      videoTimeSec: 50,
      lapNumber: 1,
      driverRole: "me",
      anchorKind: "sf_finish",
    },
  },
};
const tEnd1 = predictSfEndTime(me, 1, anchorL1Session);
const tStart1 = predictSfStartTime(me, 1, anchorL1Session);
if (tEnd1 !== 50 || tStart1 == null || Math.abs(tStart1 - (50 - 12.5)) > 0.01) {
  throw new Error(`lap 1 start should be finish - lap time, got start=${tStart1} end=${tEnd1}`);
}

const practiceDupes = namespaceSessionDriverKeys("sess_a", [
  { key: "liverc_practice_session", driverName: "A", normalizedName: "a", role: "me", laps: [] },
]);
const practiceDupesB = namespaceSessionDriverKeys("sess_b", [
  { key: "liverc_practice_session", driverName: "B", normalizedName: "b", role: "competitor", laps: [] },
]);
const merged = [...practiceDupes, ...practiceDupesB];
const dupKeys = defaultDriverKeys(merged);
if (dupKeys.meKey === dupKeys.competitorKey) {
  throw new Error("practice session drivers must have distinct keys after namespacing");
}

const offVideoSession: ManualVideoSessionV2 = {
  version: 2,
  timingSource: "url",
  timingSessions: [
    {
      sessionId: "on_vid",
      label: "My practice",
      isOnVideo: true,
      drivers: [me],
      sync: {
        anchor: {
          videoTimeSec: 100,
          lapNumber: 2,
          driverRole: "me",
          anchorKind: "sf_finish",
        },
      },
    },
    {
      sessionId: "off_vid",
      label: "Rival practice",
      isOnVideo: false,
      drivers: [comp],
      sync: {},
    },
  ],
  compare: { my: null, competitor: null, alignAt: "sf_finish" },
  selectedLaps: { me: [], competitor: [] },
  marks: [],
};
const rivalL3 = videoTimeAtLapSf(offVideoSession, "off_vid", "competitor", 3, "sf_finish");
if (rivalL3 == null || Math.abs(rivalL3 - 111.5) > 0.01) {
  throw new Error(`off-video lap 3 should map to ~111.5s, got ${rivalL3}`);
}
const myL3 = videoTimeAtLapSf(offVideoSession, "on_vid", "me", 3, "sf_finish");
if (myL3 == null || Math.abs(myL3 - 112.4) > 0.01) {
  throw new Error(`on-video lap 3 should be ~112.4s, got ${myL3}`);
}

const align = getCompareSfAlignment(offVideoSession, {
  my: { sessionId: "on_vid", role: "me", lapNumber: 2 },
  competitor: { sessionId: "off_vid", role: "competitor", lapNumber: 3 },
  alignAt: "sf_finish",
});
if (!align || Math.abs(align.offsetSec - (111.5 - 100)) > 0.5) {
  throw new Error(`compare offset should be ghost-bottom, got ${align?.offsetSec}`);
}

const anchoredCompSession: ManualTimingSession = {
  sessionId: "heat",
  label: "Heat",
  isOnVideo: true,
  drivers: [me, comp],
  sync: {
    anchor: {
      videoTimeSec: 100,
      lapNumber: 2,
      driverRole: "competitor",
      anchorKind: "sf_start",
    },
    perLapSfStart: {
      "me:2": 118,
    },
  },
};
const meStartOverride = predictSfStartTime(me, 2, anchoredCompSession);
if (meStartOverride !== 118) {
  throw new Error(`perLapSfStart should override same-heat walk, got ${meStartOverride}`);
}
const compStartFromAnchor = predictSfStartTime(comp, 2, anchoredCompSession);
if (compStartFromAnchor !== 100) {
  throw new Error(`anchor driver lap should stay at anchor video time, got ${compStartFromAnchor}`);
}

// A race: lap 1 is the tone-to-loop fragment, so the first time over the line ENDS lap 1 — and
// anchoring on it as "sf_finish L1" puts lap 2's start on that exact frame. Anchoring it as
// "L1 start" (what the old Sync step did) put every lap 1.386s late.
{
  const racer: ManualDriver = {
    key: "r",
    driverName: "Racer",
    normalizedName: "racer",
    role: "me",
    laps: [
      { lapNumber: 1, lapTimeSec: 1.386 },
      { lapNumber: 2, lapTimeSec: 17.2 },
      { lapNumber: 3, lapTimeSec: 17.1 },
      { lapNumber: 4, lapTimeSec: 17.3 },
    ],
  };
  const xs = visibleCrossings(racer);
  if (xs.length !== 4 || xs[0]!.anchorKind !== "sf_finish" || xs[0]!.lapNumber !== 1) {
    throw new Error(`race: first crossing should end L1, got ${JSON.stringify(xs[0])}`);
  }
  if (xs[0]!.startsLap !== 2 || xs[1]!.endsLap !== 2) {
    throw new Error("race: crossing k ends lap k and starts lap k+1");
  }
  const raceSession: ManualTimingSession = {
    sessionId: "race",
    label: "Race",
    isOnVideo: true,
    drivers: [racer],
    sync: {
      anchor: { videoTimeSec: 79.099, lapNumber: 1, driverRole: "me", anchorKind: "sf_finish" },
    },
  };
  const l2 = predictSfStartTime(racer, 2, raceSession);
  if (l2 == null || Math.abs(l2 - 79.099) > 1e-9) {
    throw new Error(`race: lap 2 should start on the first crossing, got ${l2}`);
  }
  const l3 = predictSfStartTime(racer, 3, raceSession);
  if (l3 == null || Math.abs(l3 - (79.099 + 17.2)) > 1e-9) {
    throw new Error(`race: lap 3 start should walk one lap on, got ${l3}`);
  }

  // Practice: lap 1 is timed loop to loop, so the first crossing STARTS the first lap.
  const practiser: ManualDriver = { ...racer, laps: racer.laps.slice(1) };
  const ps = visibleCrossings(practiser);
  if (ps.length !== 4 || ps[0]!.anchorKind !== "sf_start" || ps[0]!.lapNumber !== 2) {
    throw new Error(`practice: first crossing should start the first lap, got ${JSON.stringify(ps[0])}`);
  }
  if (ps[3]!.anchorKind !== "sf_finish" || ps[3]!.lapNumber !== 4 || ps[3]!.startsLap !== null) {
    throw new Error("practice: the last crossing ends the last lap and starts nothing");
  }
}

// A reopened session is "an analysis" once one selected lap of yours is marked over every
// corner line on the on-video session — then the compare opens without the video.
{
  const base: ManualVideoSessionV2 = {
    ...emptyManualSession(),
    timingSessions: [
      { sessionId: "q1", label: "Q1", isOnVideo: true, drivers: [me, comp], sync: {} },
    ],
    selectedLaps: { me: [2, 3], competitor: [3] },
    marks: [],
  };
  const lines = ["sf", "s1", "s2"];
  const mark = (lapNumber: number, lineKey: string, sessionId = "q1") => ({
    sessionId,
    driverRole: "me" as const,
    lapNumber,
    lineKey,
    videoTimeSec: 1,
  });
  if (hasMarkedLap(base, lines)) throw new Error("no marks: nothing to show");
  // Two laps each missing a corner: no lap is whole, so no sector compare yet.
  const halves = { ...base, marks: [mark(2, "s1"), mark(3, "s2")] };
  if (hasMarkedLap(halves, lines)) throw new Error("no whole lap: nothing to show");
  // One whole lap is enough, even with the other lap short a crossing.
  const oneLap = { ...base, marks: [mark(2, "s1"), mark(2, "s2"), mark(3, "s1")] };
  if (!hasMarkedLap(oneLap, lines)) throw new Error("one whole lap: an analysis");
  // SF is never a mark target (lap times give it), so it must not count as a missing line.
  if (!hasMarkedLap(oneLap, ["sf", "s1", "s2"])) throw new Error("sf line must be ignored");
  // Marks on another timing session do not count for this one.
  const elsewhere = { ...base, marks: oneLap.marks.map((m) => ({ ...m, sessionId: "q2" })) };
  if (hasMarkedLap(elsewhere, lines)) throw new Error("marks on q2 do not count for q1");
  // Any lap of yours counts, chosen on the timing step or not — the scan picks its own ten
  // (2026-09-02), so `selectedLaps` no longer decides what an analysis is.
  const unselected = { ...base, marks: [mark(1, "s1"), mark(1, "s2")] };
  if (!hasMarkedLap(unselected, lines)) throw new Error("a whole lap counts whether or not it was ticked");
  // A session with no corner lines has nothing to mark, so it is never an analysis.
  if (hasMarkedLap(oneLap, ["sf"])) throw new Error("no corner lines: nothing to show");
}

console.log("manualVideoAnalysis sync.test.ts OK");
