"use client";

/**
 * Dev preview for the Phase B mobile analyze flow — stubs the job, run-timing,
 * and library endpoints so the full 5-step flow can be driven with zero DB
 * writes. Uses /dev-lap-compare-sample.mp4 (generated, not committed) as the
 * "library" video so sync/mark steps get real seeking.
 */

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { AnalyzeFlowClient } from "@/components/videoAnalysis/AnalyzeFlowClient";

const SAMPLE_VIDEO = "/dev-lap-compare-sample.mp4";

// Mutable so the stubbed sectors PUT (in-flow line editor) survives re-fetches.
// `?empty=1` starts with only SF — the no-corner-lines setup state.
let sectorLinesState = [
  { lineKey: "sf", label: "SF", sortOrder: 0, x1: 0.25, y1: 0.75, x2: 0.55, y2: 0.85 },
  { lineKey: "s1", label: "Esses", sortOrder: 1, x1: 0.15, y1: 0.3, x2: 0.35, y2: 0.2 },
  { lineKey: "s2", label: "Sweeper", sortOrder: 2, x1: 0.65, y1: 0.25, x2: 0.85, y2: 0.4 },
];

const TIMING = {
  sessions: [
    {
      sessionId: "ts_flow",
      label: "Heat 2",
      sourceUrl: null,
      isOnVideo: true,
      sync: {},
      drivers: [
        {
          key: "me",
          driverName: "Jordan",
          normalizedName: "jordan",
          role: "me",
          laps: [
            { lapNumber: 1, lapTimeSec: 17.5 },
            { lapNumber: 2, lapTimeSec: 17.3 },
            { lapNumber: 3, lapTimeSec: 17.9 },
          ],
        },
        {
          key: "comp",
          driverName: "T. Volk",
          normalizedName: "t volk",
          role: "competitor",
          laps: [
            { lapNumber: 1, lapTimeSec: 17.2 },
            { lapNumber: 2, lapTimeSec: 17.6 },
          ],
        },
      ],
    },
  ],
  drivers: [] as unknown[],
  defaults: { meKey: "me", competitorKey: "comp" },
};
TIMING.drivers = TIMING.sessions[0]!.drivers;

/**
 * A LiveRC practice link's answer: one session, one driver, nobody else in it.
 *
 * Pressing "+" again hands back the next person, so the chip lane can be driven the way it is
 * actually used — your own link first, then one per rival in the video.
 */
const PRACTICE_DRIVERS = [
  { name: "Jordan Caruso", laps: [17.5, 17.31, 17.92, 17.44, 17.68, 17.22] },
  { name: "Sandy Nguyen", laps: [17.24, 17.51, 16.98, 17.33, 17.09, 17.62] },
  { name: "Chris Kalfoglou", laps: [18.02, 17.88, 18.31, 17.95, 18.12, 17.79] },
  { name: "Alex Marino", laps: [17.71, 17.55, 17.99, 17.63, 17.84, 17.48] },
];
let practiceIndex = 0;

function practicePayload(url: string) {
  const who = PRACTICE_DRIVERS[practiceIndex % PRACTICE_DRIVERS.length]!;
  practiceIndex++;
  const sessionId = `ts_prac_${practiceIndex}`;
  const drivers = [
    {
      key: `${sessionId}::liverc_practice_session`,
      driverName: who.name,
      normalizedName: who.name.toLowerCase(),
      role: "me",
      laps: who.laps.map((lapTimeSec, i) => ({
        lapNumber: i + 1,
        lapTimeSec,
        isIncluded: true,
      })),
    },
  ];
  return {
    sessions: [
      {
        sessionId,
        label: `practice/${who.name.split(" ")[0]!.toLowerCase()}`,
        sourceUrl: url,
        sessionCompletedAtIso: "2026-09-01T02:00:00.000Z",
        isOnVideo: true,
        drivers,
        sync: {},
      },
    ],
    drivers,
    parserId: "liverc_practice_session_v1",
    defaults: { meKey: drivers[0]!.key, competitorKey: "" },
  };
}

// Mutable server-side session mirror so PATCHed state survives re-fetches
// within the page session.
let sessionState: unknown = {
  version: 2,
  timingSource: "run",
  timingSessions: [],
  compare: { my: null, competitor: null, alignAt: "sf_finish" },
  selectedLaps: { me: [], competitor: [] },
  marks: [],
};

export default function AnalyzeFlowPreviewPage() {
  // Dev-only synthetic preview — never exposed in production.
  if (process.env.NODE_ENV === "production") notFound();
  return <AnalyzeFlowPreviewInner />;
}

function AnalyzeFlowPreviewInner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("empty") === "1") {
      sectorLinesState = sectorLinesState.filter((l) => l.lineKey === "sf");
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const json = (obj: unknown) =>
        new Response(JSON.stringify(obj), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

      if (url.includes("/api/video-analysis/jobs/flow_preview")) {
        if (init?.method === "PATCH") {
          try {
            const body = JSON.parse(String(init.body ?? "{}")) as { manualJson?: unknown };
            if (body.manualJson) sessionState = body.manualJson;
          } catch {}
          return json({ id: "flow_preview" });
        }
        return json({
          job: {
            id: "flow_preview",
            track: { id: "track_prev", name: "Ardent Raceway" },
            profile: { id: "prof_prev", name: "Drivers' stand" },
            runId: "run_prev",
            videoAssetId: null,
            analysisMode: "manual",
          },
          manual: { session: sessionState },
          result: null,
          sectorLines: sectorLinesState,
        });
      }
      if (url.includes("/api/video-analysis/profiles/prof_prev/sectors") && init?.method === "PUT") {
        try {
          const body = JSON.parse(String(init.body ?? "{}")) as {
            lines?: typeof sectorLinesState;
          };
          if (Array.isArray(body.lines)) {
            sectorLinesState = body.lines.map((l, i) => ({ ...l, sortOrder: i }));
          }
        } catch {}
        return json({ sectorLines: sectorLinesState });
      }
      if (url.includes("/api/video-analysis/manual/session-drivers")) {
        return json(TIMING);
      }
      if (url.includes("/api/video-analysis/manual/parse-url")) {
        let pasted = "https://liverc.test/practice";
        try {
          const body = JSON.parse(String(init?.body ?? "{}")) as { urls?: string[] };
          pasted = body.urls?.[0] ?? pasted;
        } catch {}
        return json(practicePayload(pasted));
      }
      if (url.includes("/api/videos") && (!init?.method || init.method === "GET")) {
        return json({
          videos: [
            {
              id: "sample",
              createdAt: new Date(2026, 6, 10).toISOString(),
              label: "heat2_stand.mp4",
              originalFilename: "heat2_stand.mp4",
              mimeType: "video/mp4",
              bytes: 4820105,
            },
          ],
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
    // Same chrome as the real route — no wrapper padding, no in-flow debug banner. The flow
    // sizes its video against the leftover window height, so anything this page adds above it
    // makes the preview lie about the layout it exists to show. (A max-w-md wrapper here once
    // collapsed the desktop video column to zero width.)
    <main className="page-body">
      <p className="type-timestamp pointer-events-none fixed bottom-1 right-2 z-50 opacity-70">
        DEBUG · stubbed endpoints · generated sample video
      </p>
      <div className="pt-[calc(var(--top-chrome-y)+2.25rem)] md:pt-0">
        {ready ? (
          <AnalyzeFlowClient jobId="flow_preview" videoUrlForAsset={() => SAMPLE_VIDEO} />
        ) : null}
      </div>
    </main>
  );
}
