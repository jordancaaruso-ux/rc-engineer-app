"use client";

import { notFound } from "next/navigation";
import { SessionsBrowser } from "@/components/runs/SessionsBrowser";
import type { AnalysisTrendModel, AnalysisTrendRun } from "@/lib/analysis/analysisHomeModel";
import type { WorkbenchGroup, WorkbenchRunRow } from "@/lib/runs/sessionWorkbenchModel";
import type { Run } from "@/components/runs/RunDetailPanel";

/** Scratch preview for the session-card compaction + chart→list focus. Delete after review. */

const BESTS = [16.32, 16.11, 16.18, 15.94, 15.802];
/** Chronological, one run an hour across a test day — the clock the rows read on. */
const TIMES = ["9:15 AM", "10:15 AM", "11:15 AM", "12:15 PM", "1:15 PM"];
/** One from each band, so the readout numeral shows the whole `--color-rating-*` ramp. */
const RATINGS = [5, 7, 6, 8, 9];

function trendRun(index: number): AnalysisTrendRun {
  const best = BESTS[index]!;
  const changed = index % 2 === 0;
  return {
    id: `r${index + 1}`,
    carId: "car_1",
    carName: "A800 RR",
    shortLabel: `R${index + 1}`,
    sessionName: `Run ${index + 1}`,
    timeLabel: TIMES[index]!,
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
    // A day that warms up and a car that comes to it — so the readout's two extra figures
    // have something to say as the chart walks itself.
    carRating: RATINGS[index]!,
    airTempC: 21 + index * 1.5,
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
  title: "Practice · A800 RR",
  timeLabel: TIMES[index]!,
  whereLabel: "TFTR",
  whenLabel: `19 Jul, ${TIMES[index]!}`,
  carName: "A800 RR",
  best,
  // 18 laps, so both averages exist — the row builder nulls them below 5 and 10.
  avgTop5: best + 0.19,
  avgTop10: best + 0.33,
  median: best + 0.68,
  lapCount: 18,
  isGroupBest: best === Math.min(...BESTS),
  needsLapImport: false,
  // Alternating, so the preview shows both faces of the expansion: a run that
  // changed the car, and one that went back out as it came in.
  setupDiff:
    index % 2 === 0
      ? {
          mode: "diff" as const,
          previousLabel: `R${index}`,
          rows: [
            {
              key: "camber_front",
              label: "Front camber (deg)",
              value: "-1.5",
              previousValue: "-1.0",
            },
            {
              key: "ride_height_rear",
              label: "Rear ride height (mm)",
              value: "6.0",
              previousValue: "5.5",
            },
          ],
        }
      : { mode: "diff" as const, previousLabel: `R${index}`, rows: [] },
})).reverse();

/**
 * Full records for the rows, so a row here actually opens (`RunFaces`)
 * rather than falling back to the "no record loaded" door.
 */
const RUNS: Run[] = BESTS.map((best, index) => ({
  id: `r${index + 1}`,
  userId: "usr_jordan",
  createdAt: new Date(`2026-07-19T0${index}:00:00.000Z`),
  carId: "car_1",
  eventId: null,
  sessionType: "Practice",
  carNameSnapshot: "A800 RR",
  trackNameSnapshot: "TFTR",
  tireRunNumber: index + 1,
  // Plain seconds — the shape `normalizeLapTimes` reads.
  lapTimes: Array.from({ length: 18 }, (_, lap) =>
    // A warm-up lap, then the run settling onto pace with one scruffy lap in it.
    lap === 0 ? best + 0.9 : lap === 11 ? best + 0.62 : best + (lap % 5) * 0.06 + 0.02
  ),
  bestLapSeconds: best,
  notes:
    index === 3 ? "Stiffer front took most of the entry push out. Still steps out on power." : null,
  carRating: 6 + (index % 3),
  // Same shape the app writes (version 6) — see any real run.
  handlingAssessmentJson: {
    version: 6,
    balanceByPhase: { entry: -2, mid: 0, exit: 1 },
    onPower: -2,
  },
}));

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
      runs={RUNS}
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
