"use client";

/**
 * Dev preview for the lap-times sheet — the modal, the "Compared with" bar, the
 * session picker and the tinted grid, driven by synthetic runs.
 *
 * The sheet is otherwise only reachable from a real session with real laps, an
 * imported timing sheet and several earlier runs at one track — which makes the
 * one surface in the app that is purely about reading numbers the hardest one to
 * look at while changing it. Everything below the fetch stub is the production
 * component tree; only the data is fake.
 *
 * Numbers mirror the rev-3 layout proposal (MR33 Arena, a 14.8s class) so the
 * built thing and the mock can be held side by side.
 */

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { RunLapAnalysisModal } from "@/components/runs/RunLapAnalysisModal";
import { toCompareRunShape } from "@/lib/runCompareShape";

const TRACK = { id: "trk_mr33", name: "MR33 Arena" };

/** A believable stint: mid-14.8s pace, one crash lap, a little scatter. */
function laps(seed: number, base: number, count = 12): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < count; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const jitter = ((x / 2147483648) - 0.5) * 0.34;
    out.push(Number((base + jitter).toFixed(3)));
  }
  // One lap everybody excludes, so the tint scale has something to ignore.
  out[4] = Number((base + 3.4).toFixed(3));
  return out;
}

function run(
  id: string,
  sessionLabel: string,
  hoursAgo: number,
  base: number,
  opts?: { userId?: string; track?: { id: string; name: string } | null; dayOffset?: number }
) {
  const when = new Date(Date.UTC(2026, 7, 9, 3, 20, 0) - hoursAgo * 3600_000 - (opts?.dayOffset ?? 0) * 86400_000);
  return {
    id,
    userId: opts?.userId ?? "usr_dayne",
    createdAt: when,
    loggingCompletedAt: when,
    sessionCompletedAt: when,
    sortAt: when,
    sessionType: "TESTING",
    sessionLabel,
    eventId: null,
    car: { id: "car_mr33", name: "MR33" },
    carId: "car_mr33",
    carNameSnapshot: "MR33",
    track: opts?.track === undefined ? TRACK : opts.track,
    trackNameSnapshot: opts?.track === undefined ? TRACK.name : (opts.track?.name ?? "Bathurst Indoor"),
    // Seeded off the whole id, not its length — "run_4"/"run_5"/"run_6" are all
    // 5 characters, so a length seed gave every run the same jitter and the grid
    // came out with one constant delta per column: a flat tint that proves nothing.
    lapTimes: laps([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), base),
    // Lap 5 is the crash lap `laps()` plants. Marking it excluded is the whole
    // point of having one: it must strike through, lose its tint, and stay out of
    // the range the other laps are coloured against.
    lapSession: {
      version: 1,
      entries: [{ perLap: Array.from({ length: 12 }, (_, i) => ({ isIncluded: i !== 4 })) }],
    },
    tireRunNumber: 3,
    setupSnapshot: null,
  };
}

const ANCHOR_LAPS = laps([..."run_4"].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), 14.93);

const ANCHOR = {
  ...run("run_4", "Run 4", 0, 14.93),
  importedLapSets: [
    /*
     * The driver's OWN row off the timing sheet, imported after midnight and
     * carrying no on-track wall time — the shape that produced the target-row
     * date bug (reported 2026-08-12). Its laps match the run's, so
     * `filterDuplicateImportedSeries` drops the duplicate column and it survives
     * only as the run's `primaryImport`: exactly how a real LiveRC import lands.
     */
    {
      id: "imp_me",
      driverName: "Dayne Warren",
      isPrimaryUser: true,
      createdAt: new Date(Date.UTC(2026, 7, 9, 13, 26, 0)),
      sessionCompletedAt: null,
      laps: ANCHOR_LAPS.map((t, i) => ({
        lapNumber: i + 1,
        lapTimeSeconds: t,
        isIncluded: i !== 4,
      })),
    },
    {
      id: "imp_volk",
      driverName: "T. Volk",
      isPrimaryUser: false,
      createdAt: new Date(Date.UTC(2026, 7, 9, 3, 20, 0)),
      sessionCompletedAt: new Date(Date.UTC(2026, 7, 9, 3, 20, 0)),
      laps: laps(31, 14.86).map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: i !== 4 })),
    },
    {
      id: "imp_rowe",
      driverName: "K. Rowe",
      isPrimaryUser: false,
      createdAt: new Date(Date.UTC(2026, 7, 9, 3, 20, 0)),
      sessionCompletedAt: new Date(Date.UTC(2026, 7, 9, 3, 20, 0)),
      laps: laps(97, 15.04).map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: i !== 4 })),
    },
  ],
};

/** Lap rows in the shape the timing import stores them, lap 5 excluded like everywhere else here. */
function rows(times: number[]) {
  return times.map((t, i) => ({ lapNumber: i + 1, lapTimeSeconds: t, isIncluded: i !== 4 }));
}

/*
 * Other races' fields, for the Field tab's "compare me with his FIRST heat"
 * case. Two shapes, because both reach the sheet:
 *  - `run_jul` carries its rivals' laps inline (a run loaded in full);
 *  - `run_3` carries only the names, the way the Sessions list query ships
 *    them, and the fetch stub below serves its laps when the group is opened —
 *    the production path.
 */
const RUN_3 = run("run_3", "Run 3", 1.25, 14.98);
const RUN_3_FIELD_FULL = [
  {
    id: "imp_r3_me",
    driverName: "Dayne Warren",
    isPrimaryUser: true,
    createdAt: RUN_3.sessionCompletedAt,
    sessionCompletedAt: RUN_3.sessionCompletedAt,
    laps: rows(RUN_3.lapTimes),
  },
  {
    id: "imp_r3_volk",
    driverName: "T. Volk",
    isPrimaryUser: false,
    createdAt: RUN_3.sessionCompletedAt,
    sessionCompletedAt: RUN_3.sessionCompletedAt,
    laps: rows(laps(67, 14.9)),
  },
  {
    id: "imp_r3_rowe",
    driverName: "K. Rowe",
    isPrimaryUser: false,
    createdAt: RUN_3.sessionCompletedAt,
    sessionCompletedAt: RUN_3.sessionCompletedAt,
    laps: rows(laps(71, 15.12)),
  },
];
const RUN_3_FIELD_NAMES_ONLY = RUN_3_FIELD_FULL.map(({ laps: _laps, ...meta }) => meta);

const RUN_JUL = run("run_jul", "Round 3 · A-main", 0, 14.79, { dayOffset: 21 });
const RUN_JUL_FIELD = [
  {
    id: "imp_jul_volk",
    driverName: "T. Volk",
    isPrimaryUser: false,
    createdAt: RUN_JUL.sessionCompletedAt,
    sessionCompletedAt: RUN_JUL.sessionCompletedAt,
    laps: rows(laps(41, 14.71)),
  },
  {
    id: "imp_jul_ng",
    driverName: "S. Ng",
    isPrimaryUser: false,
    createdAt: RUN_JUL.sessionCompletedAt,
    sessionCompletedAt: RUN_JUL.sessionCompletedAt,
    laps: rows(laps(53, 14.95)),
  },
];

const OTHERS = [
  run("run_6", "Run 6", -3.7, 15.01),
  run("run_5", "Run 5", -2.5, 15.06),
  { ...RUN_3, importedLapSets: RUN_3_FIELD_NAMES_ONLY },
  run("run_2", "Run 2", 2.65, 15.11),
  // A teammate on the same day, to exercise the Teammates segment.
  run("run_t1", "Run 3", 1.0, 14.88, { userId: "usr_mara" }),
  // Same venue, three weeks back — the "Earlier at MR33 Arena" group.
  { ...RUN_JUL, importedLapSets: RUN_JUL_FIELD },
  // Somewhere else entirely — only visible once the scope is widened.
  run("run_far", "Run 2", 0, 15.4, { dayOffset: 40, track: null }),
];

export default function LapTimesPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Inner />;
}

function Inner() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/lap-time-sessions")) {
        return new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Run 3's field arrives names-only; opening its group fetches the laps.
      // The delay is there so the "Loading laps…" line can actually be seen.
      if (url.includes("/api/runs/run_3/imported-lap-sets")) {
        await new Promise((r) => setTimeout(r, 700));
        return new Response(JSON.stringify({ sets: RUN_3_FIELD_FULL }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = realFetch;
    };
  }, []);

  return (
    <main className="page-body mx-auto max-w-md space-y-4 p-4">
      <header className="page-header">
        <h1 className="page-title">Lap times preview</h1>
        <p className="page-subtitle">
          Synthetic runs through the real sheet. Debug page — not linked from nav.
        </p>
      </header>

      <button
        type="button"
        className="btn-surface w-full px-3 py-2 text-sm"
        onClick={() => setOpen(true)}
      >
        Open lap times
      </button>

      {ready ? (
        <RunLapAnalysisModal
          open={open}
          onClose={() => setOpen(false)}
          run={ANCHOR}
          pickerRunsSameCar={OTHERS.map(toCompareRunShape)}
          runListSource="my_runs"
          userDisplayName="Dayne Warren"
          runOwnedByViewer
          viewerUserId="usr_dayne"
          memberDisplayByUserId={{ usr_dayne: "Dayne Warren", usr_mara: "Mara Ellis" }}
        />
      ) : null}
    </main>
  );
}
