import { predictSfEndTime, predictSfStartTime, buildSfPredictions } from "./sync";
import {
  defaultDriverKeys,
  applyTop3LapSelection,
  setLapIncluded,
  pickBestNLapNumbers,
} from "./timing";
import { emptyManualSession } from "./types";
import type { ManualDriver, ManualSyncState } from "./types";
import { getLapAlignmentPreview, getLapAlignSteps } from "./predictSectors";

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

const sync: ManualSyncState = {
  anchor: { videoTimeSec: 100, lapNumber: 2, driverRole: "me" },
};

const drivers = [me, comp];
const t3me = predictSfEndTime(me, 3, sync, drivers);
if (t3me == null || Math.abs(t3me - 112.4) > 0.01) {
  throw new Error(`expected lap 3 me at 112.4, got ${t3me}`);
}

const t3comp = predictSfEndTime(comp, 3, sync, drivers);
if (t3comp == null || Math.abs(t3comp - 112) > 0.01) {
  throw new Error(`expected comp lap 3 at 112 (anchor + comp lap 3), got ${t3comp}`);
}

const preds = buildSfPredictions(drivers, sync, { me: [2, 3], competitor: [3] });
if (preds.length < 3) throw new Error("predictions missing");

const allComp: ManualDriver[] = [
  { key: "a", driverName: "A", normalizedName: "a", role: "competitor", laps: [] },
  { key: "b", driverName: "B", normalizedName: "b", role: "competitor", laps: [] },
];
const keys = defaultDriverKeys(allComp);
if (keys.meKey !== "a" || keys.competitorKey !== "b") {
  throw new Error(`expected a/b keys, got ${keys.meKey}/${keys.competitorKey}`);
}

let session = applyTop3LapSelection({
  ...emptyManualSession(),
  drivers: [me, comp],
});
const meTop = pickBestNLapNumbers(me.laps, 3);
if (
  session.selectedLaps.me.join() !== meTop.join() ||
  session.selectedLaps.me.length !== 3
) {
  throw new Error("expected top 3 fastest laps selected");
}
session = setLapIncluded(session, "me", 2, false);
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
  drivers: [me, comp],
  sync: { anchor: { videoTimeSec: 100, lapNumber: 2, driverRole: "me" } },
});
const prev = getLapAlignmentPreview(sess, lines, "me", 3);
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

const anchorL1 = {
  anchor: { videoTimeSec: 50, lapNumber: 1, driverRole: "me" as const },
};
const tEnd1 = predictSfEndTime(me, 1, anchorL1, [me]);
const tStart1 = predictSfStartTime(me, 1, anchorL1, [me]);
if (tEnd1 !== 50 || tStart1 == null || Math.abs(tStart1 - (50 - 12.5)) > 0.01) {
  throw new Error(`lap 1 start should be finish - lap time, got start=${tStart1} end=${tEnd1}`);
}

console.log("manualVideoAnalysis sync.test.ts OK");
