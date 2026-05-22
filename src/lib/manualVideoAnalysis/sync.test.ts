import { predictSfEndTime, buildSfPredictions } from "./sync";
import type { ManualDriver, ManualSyncState } from "./types";

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
if (t3comp == null || Math.abs(t3comp - 112.4) > 0.01) {
  throw new Error(`expected lap 3 same wave at 112.4, got ${t3comp}`);
}

const preds = buildSfPredictions(drivers, sync, { me: [2, 3], competitor: [3] });
if (preds.length < 3) throw new Error("predictions missing");

console.log("manualVideoAnalysis sync.test.ts OK");
