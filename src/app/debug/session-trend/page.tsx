"use client";

import { notFound } from "next/navigation";
import { SessionsBrowser } from "@/components/runs/SessionsBrowser";
import type { AnalysisTrendModel, AnalysisTrendRun } from "@/lib/analysis/analysisHomeModel";
import type { WorkbenchGroup, WorkbenchRunRow } from "@/lib/runs/sessionWorkbenchModel";

/** Scratch preview for the session-card compaction + chart→list focus. Delete after review. */

const BESTS = [16.32, 16.11, 16.18, 15.94, 15.802];

function trendRun(index: number): AnalysisTrendRun {
  const best = BESTS[index]!;
  const changed = index % 2 === 0;
  return {
    id: `r${index + 1}`,
    carId: "car_1",
    carName: "A800 RR",
    shortLabel: `R${index + 1}`,
    sessionName: `Run ${index + 1}`,
    createdAtIso: "2026-07-19T04:00:00.000Z",
    metrics: {
      best,
      avgTop5: best + 0.3,
      avgTop10: best + 0.51,
      median: best + 0.68,
      cleanLapCount: 18,
      consistencyScore: 97.2,
      mistakeCount: 1,
    },
    distribution: {
      best,
      p25: best + 0.22,
      median: best + 0.68,
      p75: best + 0.94,
      slowestClean: best + 1.4,
      mistakes: [best + 2.6],
    },
    tireIndicator: {
      tireLabel: "Sweep D32 32R",
      runNumber: 4,
      ageKnown: true,
      changed,
      previousTireLabel: changed ? "Sweep D30 30R" : null,
    },
    setupChange: changed ? { changedFieldLabels: ["Front camber", "Rear ride height"] } : null,
  };
}

const TREND: AnalysisTrendModel = {
  scopeLabel: "TFTR · 19 Jul 2026",
  scopeKind: "day",
  runs: BESTS.map((_, index) => trendRun(index)),
  carOptions: [{ carId: "car_1", carName: "A800 RR" }],
  defaultCarId: "car_1",
};

/** Rail order is newest-first; the chart is chronological. */
const ROWS: WorkbenchRunRow[] = BESTS.map((best, index) => ({
  id: `r${index + 1}`,
  label: `R${index + 1}`,
  carName: "A800 RR",
  best,
  // 18 laps, so both averages exist — the row builder nulls them below 5 and 10.
  avgTop5: best + 0.19,
  avgTop10: best + 0.33,
  median: best + 0.68,
  lapCount: 18,
  isGroupBest: best === Math.min(...BESTS),
  needsLapImport: false,
})).reverse();

const GROUP: WorkbenchGroup = {
  id: "grp_1",
  title: "Test day",
  type: "Testing",
  trackName: "TFTR",
  dateLabel: "19 Jul 2026",
  runs: ROWS,
  trend: TREND,
  headline: { best: 15.802, runCount: 5, lapCount: 91, priorLabel: "5 Jul 2026", priorDelta: -0.43 },
  drivers: null,
  teamDay: null,
  totalRuns: null,
};

export default function SessionTrendPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <SessionsBrowser
      groups={[GROUP]}
      runs={[]}
      pickerRuns={[]}
      runListSource="my_runs"
      displayTimeZone="Australia/Sydney"
      userDisplayName="Jordan"
      memberDisplayByUserId={{}}
      viewerUserId="usr_jordan"
      teamMode={false}
      teamTitle={null}
      initialGroupId="grp_1"
    />
  );
}
