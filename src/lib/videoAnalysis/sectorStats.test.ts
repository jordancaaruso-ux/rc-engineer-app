import { applyMotIdCorrections, computeSectorMatrix } from "./sectorStats";
import type { VideoAnalysisResultV1 } from "./types";

const sample: VideoAnalysisResultV1 = {
  version: 1,
  sectorLines: [
    { id: "sf", label: "SF", x1: 0, y1: 0, x2: 1, y2: 0 },
    { id: "s1", label: "S1", x1: 0, y1: 0, x2: 1, y2: 0 },
  ],
  tracks: [
    {
      motTrackId: 1,
      lapCount: 2,
      bestLapSec: 12.0,
      laps: [
        { lapIndex: 1, lapTimeSec: 12.1, startSec: 0, endSec: 12.1, sectorTimesSec: { s1: 4.0 } },
        { lapIndex: 2, lapTimeSec: 12.0, startSec: 12.1, endSec: 24.1, sectorTimesSec: { s1: 3.8 } },
      ],
    },
    {
      motTrackId: 2,
      lapCount: 1,
      bestLapSec: 12.5,
      laps: [
        { lapIndex: 1, lapTimeSec: 12.5, startSec: 0, endSec: 12.5, sectorTimesSec: { s1: 4.2 } },
      ],
    },
  ],
};

const corrected = applyMotIdCorrections(sample.tracks, [
  { fromId: 2, toId: 99, startSec: 0, endSec: 100 },
]);
if (!corrected.some((t) => t.motTrackId === 99)) {
  throw new Error("correction merge failed");
}

const matrix = computeSectorMatrix(sample);
const s1 = matrix.find((r) => r.sectorId === "s1");
if (!s1 || s1.fastestMotTrackId !== 1) {
  throw new Error(`expected car 1 fastest in s1, got ${JSON.stringify(s1)}`);
}

console.log("videoAnalysis sectorStats.test.ts OK");
