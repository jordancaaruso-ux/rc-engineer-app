/**
 * Dev preview for the two cards the 2026-08-20 phone dashboard pass added.
 *
 * Both are hard to see in the live app: "How you're going" needs two timed sessions at the
 * same track INSIDE the 30-day window (the demo account's season is older than that, so it
 * renders its empty state), and the Ask-the-Engineer card's rotation takes half a minute to
 * come round. This renders the real components against fabricated models at 390px, which is
 * the width they have to survive.
 *
 * The states that matter are the awkward ones: a driver with one track, a driver with four,
 * a slower month (which must NOT read as a telling-off), and an account with nothing logged.
 */

import { notFound } from "next/navigation";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { DashboardAskEngineerCard } from "@/components/dashboard/DashboardAskEngineerCard";
import type { DashboardPaceTrend, DashboardSummary } from "@/lib/dashboardSummary";
import type { DashboardRecord } from "@/lib/dashboardRecords";
import { selectDashboardStarterQuestions } from "@/lib/engineerStarterQuestions";

const IRONBARK: DashboardPaceTrend = {
  trackName: "Ironbark Raceway",
  className: "Modified",
  runsCount: 6,
  firstBestLap: 13.26,
  lastBestLap: 12.84,
  deltaSeconds: -0.42,
  spark: [13.26, 13.11, 13.18, 12.97, 13.02, 12.84],
};

const MEADOWBANK: DashboardPaceTrend = {
  trackName: "Meadowbank Park",
  className: null,
  runsCount: 3,
  firstBestLap: 14.91,
  lastBestLap: 15.02,
  deltaSeconds: 0.11,
  spark: [14.91, 15.14, 15.02],
};

const KILSYTH: DashboardPaceTrend = {
  trackName: "Kilsyth Indoor",
  className: "13.5 Touring",
  runsCount: 4,
  firstBestLap: 11.42,
  lastBestLap: 11.4,
  deltaSeconds: -0.002,
  spark: [11.42, 11.45, 11.41, 11.4],
};

const HOBSONVILLE: DashboardPaceTrend = {
  trackName: "Hobsonville Raceway",
  className: null,
  runsCount: 2,
  firstBestLap: 17.8,
  lastBestLap: 17.44,
  deltaSeconds: -0.36,
  spark: [17.8, 17.44],
};

const RECORDS: DashboardRecord[] = [
  {
    trackName: "Ironbark Raceway",
    className: "Modified",
    runsCount: 42,
    lastRunAt: "2026-08-17T04:12:00.000Z",
    bestLap: 12.84,
    avgTop5: 13.02,
    racePace: 13.4,
    freshPbMetric: "best",
  },
];

function summary(partial: Partial<DashboardSummary>): DashboardSummary {
  return {
    windowDays: 30,
    hasData: true,
    hasEverLogged: true,
    lastRunLabel: "19 Jul",
    runs: { current: 8, prior: 5 },
    laps: { current: 214, prior: 138 },
    drivingSeconds: { current: 6000, prior: 3900 },
    activeDays: 4,
    tracks: 2,
    pace: IRONBARK,
    paceByTrack: [IRONBARK, MEADOWBANK],
    activityByDay: Array.from({ length: 30 }, (_, i) => (i % 7 === 5 ? 3 : 0)),
    ...partial,
  };
}

const STATES: { title: string; note: string; summary: DashboardSummary }[] = [
  {
    title: "Two tracks",
    note: "the normal month — one faster, one not",
    summary: summary({}),
  },
  {
    title: "One track",
    note: "a club racer who only ever goes to one place",
    summary: summary({ paceByTrack: [IRONBARK], tracks: 1 }),
  },
  {
    title: "Four tracks",
    note: "caps at three rows, and says how many are left",
    summary: summary({
      paceByTrack: [IRONBARK, MEADOWBANK, KILSYTH, HOBSONVILLE],
      tracks: 4,
      runs: { current: 15, prior: 5 },
    }),
  },
  {
    title: "A slower month",
    note: "must read as a report, never a telling-off — no red anywhere",
    summary: summary({ paceByTrack: [MEADOWBANK], pace: MEADOWBANK, tracks: 1 }),
  },
  {
    title: "Runs, but no trend yet",
    note: "one session per track, so nothing has two points to draw",
    summary: summary({ paceByTrack: [], pace: null, runs: { current: 2, prior: 0 } }),
  },
  {
    title: "Nothing logged",
    note: "the card falls back to its invitation",
    summary: summary({ hasData: false, paceByTrack: [], pace: null }),
  },
];

export default function HowYoureGoingPreviewPage() {
  // Dev-only synthetic preview — never exposed in production.
  if (process.env.NODE_ENV === "production") notFound();

  const trackDayQuestions = selectDashboardStarterQuestions({ hasRuns: true, isTrackDay: true });
  const offDayQuestions = selectDashboardStarterQuestions({ hasRuns: true, isTrackDay: false });
  const newDriverQuestions = selectDashboardStarterQuestions({ hasRuns: false, isTrackDay: false });

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-1 text-[17px] font-bold text-foreground">
        How you&rsquo;re going · Ask the Engineer
      </h1>
      <p className="mb-5 text-[12px] text-muted-foreground">
        Real cards, fabricated models, boxed at 390px.
      </p>

      <div className="flex flex-wrap gap-6">
        {STATES.map((s) => (
          <div key={s.title} style={{ width: 390 }} className="flex-none">
            <div className="mb-1.5">
              <div className="text-[13px] font-semibold text-foreground">{s.title}</div>
              <div className="text-[11.5px] text-faint">{s.note}</div>
            </div>
            <DashboardSummaryCard
              summary={s.summary}
              records={RECORDS}
              newPb={null}
            />
          </div>
        ))}

        {[
          { title: "Ask — track day", note: "run, feel and plan questions", qs: trackDayQuestions },
          { title: "Ask — off day", note: "no feel questions; the car isn't in front of you", qs: offDayQuestions },
          { title: "Ask — nothing logged", note: "no read-this-run questions survive", qs: newDriverQuestions },
        ].map((s) => (
          <div key={s.title} style={{ width: 390 }} className="flex-none">
            <div className="mb-1.5">
              <div className="text-[13px] font-semibold text-foreground">{s.title}</div>
              <div className="text-[11.5px] text-faint">{s.note}</div>
            </div>
            <DashboardAskEngineerCard questions={s.qs} />
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
              {s.qs.map((q) => (
                <li key={q.id}>
                  {q.family} · {q.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
