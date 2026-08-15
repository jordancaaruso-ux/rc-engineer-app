/**
 * Dev preview for the phone day-verdict card's THIRD instrument.
 *
 * The real card only renders on a track day — you need runs logged today, with laps and
 * ratings, to see any of it — so judging a row change against the live app means seeding
 * a day first. This renders the REAL `DashboardDayVerdictCard` against fabricated
 * verdicts at 390px, which is the width the row has to survive.
 *
 * Every state the handling row can reach is here, including the two that are easy to
 * forget: an eight-run day (does the arc still fit one line?) and a day where no run
 * carries a rating yet (does the row vanish cleanly, leaving Last change as the last row?).
 */

import { notFound } from "next/navigation";
import { DashboardDayVerdictCard } from "@/components/dashboard/DashboardDayVerdictCard";
import type { TodayVerdict } from "@/lib/dashboardVerdict";

const CONTEXT = { trackName: "Kilsyth", eventName: null, carName: "TC01" };

const CHANGE = [
  { key: "front_sway", label: "Front sway", unit: "mm", previous: "1.4", current: "1.5" },
];

function verdict(partial: Partial<TodayVerdict>): TodayVerdict {
  return {
    runCount: 3,
    trend: { direction: "faster", delta: -0.412, metric: "avg", spark: [15.62, 15.38, 15.21] },
    bestRun: { runLabel: "Run 3", bestLap: 15.041, avgTop5: 15.208 },
    lastChange: { runLabel: "Run 3", rows: CHANGE, delta: -0.17, metric: "avg", verdict: "helped" },
    handling: null,
    ...partial,
  };
}

const STATES: { title: string; note: string; verdict: TodayVerdict }[] = [
  {
    title: "Improving day",
    note: "the case the row exists for",
    verdict: verdict({
      handling: { rating: 8, runLabel: "Run 3", arc: [5, 6, 8], direction: "improving" },
    }),
  },
  {
    title: "Fading day",
    note: "car went away as the track came in",
    verdict: verdict({
      trend: { direction: "slower", delta: 0.31, metric: "avg", spark: [15.2, 15.35, 15.51] },
      handling: { rating: 5, runLabel: "Run 3", arc: [8, 6, 5], direction: "fading" },
    }),
  },
  {
    title: "Flat day",
    note: "band word carries the level, since there is no direction",
    verdict: verdict({
      handling: { rating: 7, runLabel: "Run 3", arc: [7, 7, 7], direction: "flat" },
    }),
  },
  {
    title: "Flat and bad",
    note: "the blunt end of the band table",
    verdict: verdict({
      handling: { rating: 2, runLabel: "Run 3", arc: [2, 3, 2], direction: "flat" },
    }),
  },
  {
    title: "One run today",
    note: "no arc to draw — level only",
    verdict: verdict({
      runCount: 1,
      trend: null,
      lastChange: null,
      bestRun: { runLabel: "Run 1", bestLap: 15.41, avgTop5: 15.58 },
      handling: { rating: 9, runLabel: "Run 1", arc: [9], direction: null },
    }),
  },
  {
    title: "One rating, more runs",
    note: "a draft is open, so 'first run of the day' would lie",
    verdict: verdict({
      runCount: 3,
      handling: { rating: 6, runLabel: "Run 3", arc: [6], direction: null },
    }),
  },
  {
    title: "Four-run day",
    note: "the widest arc shown in full — must not wrap",
    verdict: verdict({
      runCount: 4,
      handling: { rating: 8, runLabel: "Run 4", arc: [4, 5, 7, 8], direction: "improving" },
    }),
  },
  {
    title: "Eight-run day",
    note: "arc trimmed to both ends, because the word is computed from them",
    verdict: verdict({
      runCount: 8,
      handling: {
        rating: 8,
        runLabel: "Run 8",
        arc: [4, 5, 5, 6, 6, 7, 8, 8],
        direction: "improving",
      },
    }),
  },
  {
    title: "Nothing rated yet",
    note: "row absent — Last change has to become the last row",
    verdict: verdict({ handling: null }),
  },
  {
    title: "No laps at all",
    note: "the old consistency row went blank here; this one still speaks",
    verdict: verdict({
      runCount: 2,
      trend: null,
      bestRun: { runLabel: "Run 2", bestLap: null, avgTop5: null },
      lastChange: null,
      handling: { rating: 6, runLabel: "Run 2", arc: [4, 6], direction: "improving" },
    }),
  },
];

export default function DayVerdictPreviewPage() {
  // Dev-only synthetic preview — never exposed in production.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-1 text-[17px] font-bold text-foreground">Day verdict — handling row</h1>
      <p className="mb-5 text-[12px] text-muted-foreground">
        Real card, fabricated verdicts, boxed at 390px.
      </p>
      <div className="flex flex-wrap gap-6">
        {STATES.map((s) => (
          <div key={s.title} style={{ width: 390 }} className="flex-none">
            <div className="mb-1.5">
              <div className="text-[13px] font-semibold text-foreground">{s.title}</div>
              <div className="text-[11.5px] text-faint">{s.note}</div>
            </div>
            <DashboardDayVerdictCard verdict={s.verdict} context={CONTEXT} />
          </div>
        ))}
      </div>
    </div>
  );
}
