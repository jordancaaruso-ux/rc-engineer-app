"use client";

/**
 * Dev preview for the Phase B mobile analyze flow — stubs the job, run-timing,
 * and library endpoints so the full 5-step flow can be driven with zero DB
 * writes. Uses /dev-lap-compare-sample.mp4 (generated, not committed) as the
 * "library" video so sync/mark steps get real seeking.
 */

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
    <main className="page-body mx-auto max-w-md p-4">
      <p className="type-timestamp mb-4 text-center">
        DEBUG · analyze flow on stubbed endpoints · library video = generated sample
      </p>
      {ready ? (
        <AnalyzeFlowClient jobId="flow_preview" videoUrlForAsset={() => SAMPLE_VIDEO} />
      ) : null}
    </main>
  );
}
