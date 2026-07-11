"use client";

/**
 * Dev preview for the Phase 1 lap-compare surface (VIDEO_TRACE_NORTH_STAR) with
 * synthetic worker results — lets the panel be exercised without seeding
 * VideoAnalysisJob rows. Stubs window.fetch for the two API calls the panel makes;
 * everything below the stub is the real production component tree.
 *
 * The standalone clip player at the bottom uses /dev-lap-compare-sample.mp4
 * (generated, not committed) when present — timecode burned into the frame proves
 * the dual-seek offset visually.
 */

import { useEffect, useState } from "react";
import { LapComparePanel } from "@/components/videoAnalysis/LapComparePanel";
import { SectorClipPlayer } from "@/components/videoAnalysis/SectorClipPlayer";

const SAMPLE_VIDEO = "/dev-lap-compare-sample.mp4";

type LapSpec = { lapTimeSec: number; splits: Record<string, number> };

function buildTrack(motTrackId: number, firstStartSec: number, laps: LapSpec[]) {
  let cursor = firstStartSec;
  const rows = laps.map((l, i) => {
    const row = {
      lapIndex: i + 1,
      lapTimeSec: l.lapTimeSec,
      startSec: Number(cursor.toFixed(3)),
      endSec: Number((cursor + l.lapTimeSec).toFixed(3)),
      sectorTimesSec: l.splits,
    };
    cursor += l.lapTimeSec;
    return row;
  });
  return {
    motTrackId,
    lapCount: rows.length,
    bestLapSec: Math.min(...rows.map((r) => r.lapTimeSec)),
    laps: rows,
  };
}

const RESULT = {
  version: 1,
  fps: 60,
  sectorLines: [
    { id: "sf", label: "SF", x1: 0, y1: 0, x2: 1, y2: 0 },
    { id: "s1", label: "Esses", x1: 0, y1: 0, x2: 1, y2: 0 },
    { id: "s2", label: "Sweeper", x1: 0, y1: 0, x2: 1, y2: 0 },
    { id: "s3", label: "Hairpins", x1: 0, y1: 0, x2: 1, y2: 0 },
  ],
  tracks: [
    buildTrack(1, 12.0, [
      { lapTimeSec: 18.42, splits: { s1: 4.31, s2: 9.77, s3: 14.2 } },
      { lapTimeSec: 17.92, splits: { s1: 4.2, s2: 9.51, s3: 13.85 } },
      { lapTimeSec: 17.74, splits: { s1: 4.15, s2: 9.44, s3: 13.7 } },
      { lapTimeSec: 18.05, splits: { s1: 4.18, s2: 9.62, s3: 13.98 } },
      { lapTimeSec: 17.41, splits: { s1: 4.05, s2: 9.18, s3: 13.44 } },
      { lapTimeSec: 17.68, splits: { s1: 4.12, s2: 9.42, s3: 13.71 } },
      { lapTimeSec: 17.83, splits: { s1: 4.16, s2: 9.48, s3: 13.79 } },
      { lapTimeSec: 19.21, splits: { s1: 4.4, s2: 10.3, s3: 15.0 } },
    ]),
    buildTrack(7, 14.2, [
      { lapTimeSec: 17.28, splits: { s1: 4.0, s2: 9.1, s3: 13.3 } },
      { lapTimeSec: 17.55, splits: { s1: 4.08, s2: 9.3, s3: 13.55 } },
      { lapTimeSec: 17.9, splits: { s1: 4.2, s2: 9.5, s3: 13.8 } },
      { lapTimeSec: 17.62, splits: { s1: 4.1, s2: 9.35, s3: 13.6 } },
      { lapTimeSec: 18.4, splits: { s1: 4.3, s2: 9.8, s3: 14.2 } },
    ]),
  ],
};

const MANUAL_SESSION = {
  version: 2,
  timingSource: "run",
  timingSessions: [
    {
      sessionId: "ts_prev",
      label: "Heat 2",
      isOnVideo: true,
      sync: {
        anchor: { videoTimeSec: 117.5, lapNumber: 1, driverRole: "me", anchorKind: "sf_finish" },
      },
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
  compare: { my: null, competitor: null, alignAt: "sf_finish" },
  selectedLaps: { me: [1, 2], competitor: [1] },
  marks: [
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 1, lineKey: "__lap_start__", videoTimeSec: 100.0 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 1, lineKey: "s1", videoTimeSec: 104.1 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 1, lineKey: "s2", videoTimeSec: 109.4 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 1, lineKey: "sf", videoTimeSec: 117.5 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 2, lineKey: "__lap_start__", videoTimeSec: 117.5 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 2, lineKey: "s1", videoTimeSec: 121.4 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 2, lineKey: "s2", videoTimeSec: 126.5 },
    { sessionId: "ts_prev", driverRole: "me", lapNumber: 2, lineKey: "sf", videoTimeSec: 134.8 },
    { sessionId: "ts_prev", driverRole: "competitor", lapNumber: 1, lineKey: "__lap_start__", videoTimeSec: 102.0 },
    { sessionId: "ts_prev", driverRole: "competitor", lapNumber: 1, lineKey: "s1", videoTimeSec: 106.0 },
    { sessionId: "ts_prev", driverRole: "competitor", lapNumber: 1, lineKey: "s2", videoTimeSec: 111.1 },
  ],
};

const MANUAL_LINES = [
  { lineKey: "sf", label: "SF", sortOrder: 0 },
  { lineKey: "s1", label: "Esses", sortOrder: 1 },
  { lineKey: "s2", label: "Sweeper", sortOrder: 2 },
];

export default function LapComparePreviewPage() {
  const [ready, setReady] = useState(false);
  const [videoOk, setVideoOk] = useState(false);

  useEffect(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/video-analysis/jobs?runId=preview-empty")) {
        return new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/video-analysis/jobs?runId=preview-manual")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: "job_manual",
                status: "COMPLETED",
                hasResult: false,
                hasManual: true,
                analysisMode: "manual",
                profile: { name: "Drivers' stand" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/video-analysis/jobs/job_manual")) {
        return new Response(
          JSON.stringify({
            job: { id: "job_manual", videoAssetId: null, idCorrectionsJson: null },
            result: null,
            manual: { session: MANUAL_SESSION },
            transponderCompare: null,
            sectorLines: MANUAL_LINES,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/video-analysis/jobs?runId=preview")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: "job_preview",
                status: "COMPLETED",
                hasResult: true,
                analysisMode: "worker",
                profile: { name: "Drivers' stand" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/api/video-analysis/jobs/job_preview")) {
        return new Response(
          JSON.stringify({
            job: { id: "job_preview", videoAssetId: "sample", idCorrectionsJson: null },
            result: RESULT,
            transponderCompare: { comparedLaps: 8, medianDeltaSec: 0.043, pctWithin0_15s: 1 },
            sectorLines: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    }) as typeof window.fetch;
    setReady(true);

    void realFetch(SAMPLE_VIDEO, { method: "HEAD" }).then((r) =>
      setVideoOk(r.ok && (r.headers.get("content-type") ?? "").includes("video"))
    );

    return () => {
      window.fetch = realFetch;
    };
  }, []);

  return (
    <main className="page-body mx-auto max-w-md space-y-6 p-4">
      <header className="page-header">
        <h1 className="page-title">Lap compare preview</h1>
        <p className="page-subtitle">
          Synthetic worker results (2 cars, 8 + 5 laps) through the real components. Debug
          page — not linked from nav.
        </p>
      </header>

      {ready ? (
        <>
          <LapComparePanel runId="preview" trackId="track_prev" />
          <section className="space-y-2 border-t border-border pt-4">
            <span className="type-data-label">Manual-source panel (adapter path)</span>
            <LapComparePanel runId="preview-manual" trackId="track_prev" />
          </section>
          <section className="space-y-2 border-t border-border pt-4">
            <span className="type-data-label">Empty state (analyze CTA)</span>
            <LapComparePanel runId="preview-empty" trackId="track_prev" />
          </section>
        </>
      ) : null}

      <section className="space-y-2">
        <span className="type-data-label">Standalone clip player (real video seek)</span>
        {videoOk ? (
          <SectorClipPlayer
            videoUrl={SAMPLE_VIDEO}
            aWindow={{ startSec: 10.0, endSec: 14.4 }}
            bWindow={{ startSec: 28.0, endSec: 32.6 }}
            aLabel="L5"
            bLabel="L6"
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Sample video not present ({SAMPLE_VIDEO}) — generate one with ffmpeg to exercise
            playback here.
          </p>
        )}
      </section>
    </main>
  );
}
