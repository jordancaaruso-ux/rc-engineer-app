import { predictSfEndTime, predictSfStartTime, buildSfPredictions } from "./sync";
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
import { videoTimeAtLapSf } from "./sessionModel";
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

const t3comp = predictSfEndTime(comp, 3, timingSession);
if (t3comp == null || Math.abs(t3comp - 112) > 0.01) {
  throw new Error(`expected comp lap 3 at 112 (anchor + comp lap 3), got ${t3comp}`);
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

console.log("manualVideoAnalysis sync.test.ts OK");
