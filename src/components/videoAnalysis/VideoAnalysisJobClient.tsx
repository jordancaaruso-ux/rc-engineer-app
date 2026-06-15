"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SectorHeatMatrix } from "./SectorHeatMatrix";
import type { SectorFastestRow } from "@/lib/videoAnalysis/sectorStats";
import type { VideoAnalysisResultV1, MotIdCorrection } from "@/lib/videoAnalysis/types";
import type { LapCompareReport } from "@/lib/videoAnalysis/compareTransponder";

type JobPayload = {
  job: {
    id: string;
    status: string;
    runId: string | null;
    idCorrectionsJson?: MotIdCorrection[] | null;
    track: { id: string; name: string };
    profile: { id: string; name: string };
  };
  result: VideoAnalysisResultV1 | null;
  sectorMatrix: SectorFastestRow[] | null;
  transponderCompare: LapCompareReport | null;
};

export function VideoAnalysisJobClient({ jobId }: { jobId: string }) {
  const [data, setData] = useState<JobPayload | null>(null);
  const [importText, setImportText] = useState("");
  const [runIdInput, setRunIdInput] = useState("");
  const [correctionFrom, setCorrectionFrom] = useState("");
  const [correctionTo, setCorrectionTo] = useState("");
  const [correctionStart, setCorrectionStart] = useState("0");
  const [correctionEnd, setCorrectionEnd] = useState("9999");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
    if (!res.ok) return;
    const json = (await res.json()) as JobPayload;
    setData(json);
    if (json.job.runId) setRunIdInput(json.job.runId);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const p = sessionStorage.getItem(`video-analysis-local-path:${jobId}`);
    if (p) setMsg(`Local video path (for worker): ${p}`);
  }, [jobId]);

  async function importResults() {
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setMsg("Invalid JSON");
      return;
    }
    const res = await fetch(`/api/video-analysis/jobs/${jobId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: parsed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg((err as { error?: string }).error ?? "Import failed");
      return;
    }
    setMsg(`Imported ${(await res.json()).trackCount ?? "?"} tracks`);
    setImportText("");
    void load();
  }

  async function linkRun() {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: runIdInput.trim() || null }),
    });
    if (!res.ok) {
      setMsg("Failed to link run");
      return;
    }
    setMsg("Run linked");
    void load();
  }

  async function addCorrection() {
    const fromId = parseInt(correctionFrom, 10);
    const toId = parseInt(correctionTo, 10);
    const startSec = parseFloat(correctionStart);
    const endSec = parseFloat(correctionEnd);
    if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
      setMsg("Invalid MOT ids");
      return;
    }
    const existing: MotIdCorrection[] = Array.isArray(data?.job.idCorrectionsJson)
      ? data.job.idCorrectionsJson
      : [];

    const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idCorrectionsJson: [
          ...existing,
          { fromId, toId, startSec, endSec },
        ],
      }),
    });
    if (!res.ok) {
      setMsg("Failed to save correction");
      return;
    }
    setMsg("ID correction added");
    void load();
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading job…</p>;
  }

  const swapCount = data.result?.idSwapHints?.length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="text-sm">
        <Link href="/videos/analysis/manual/new" className="underline text-muted-foreground">
          ← Lap sync
        </Link>
        <p className="mt-1">
          <span className="font-medium">{data.job.track.name}</span>
          {" · "}
          {data.job.profile.name}
          {" · "}
          <span className="text-muted-foreground">{data.job.status}</span>
        </p>
      </div>

      {!data.result && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium">Import worker JSON</h2>
          <p className="text-xs text-muted-foreground">
            Run the Python worker locally, then paste <code>results.json</code> here.
          </p>
          <textarea
            className="w-full h-40 rounded-md border border-border bg-background p-2 font-mono text-[10px]"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{ "version": 1, "tracks": [...] }'
          />
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
            onClick={() => void importResults()}
          >
            Import results
          </button>
        </div>
      )}

      {data.result && (
        <>
          <div className="rounded-lg border border-border bg-card p-4 text-xs space-y-1">
            <p>
              <span className="text-muted-foreground">Tracks detected:</span> {data.result.tracks.length}
            </p>
            <p>
              <span className="text-muted-foreground">ID swap hints:</span> {swapCount}
            </p>
            <p>
              <span className="text-muted-foreground">Detector:</span> {data.result.detector ?? "—"}
            </p>
            {data.result.alignment && (
              <p>
                <span className="text-muted-foreground">Alignment:</span>{" "}
                {data.result.alignment.ok ? "OK" : data.result.alignment.error ?? "weak"}{" "}
                {data.result.alignment.inlier_ratio != null &&
                  `(inliers ${(data.result.alignment.inlier_ratio * 100).toFixed(0)}%)`}
              </p>
            )}
          </div>

          {data.sectorMatrix && <SectorHeatMatrix rows={data.sectorMatrix} />}

          {data.transponderCompare && (
            <div className="rounded-lg border border-border bg-card p-4 text-xs">
              <h3 className="font-medium mb-2">vs transponder (linked run)</h3>
              <p>
                Median Δ: {data.transponderCompare.medianDeltaSec?.toFixed(3) ?? "—"}s ·{" "}
                {(data.transponderCompare.pctWithin0_15s * 100).toFixed(0)}% within 0.15s (
                {data.transponderCompare.comparedLaps} laps)
              </p>
            </div>
          )}

          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="text-xs cursor-pointer font-medium">Per-track laps</summary>
            <div className="mt-2 space-y-3 max-h-64 overflow-auto">
              {data.result.tracks.map((tr) => (
                <div key={tr.motTrackId}>
                  <p className="text-xs font-mono font-medium">
                    Car {tr.motTrackId} — best {tr.bestLapSec.toFixed(3)}s ({tr.lapCount} laps)
                  </p>
                  <ul className="text-[10px] text-muted-foreground font-mono">
                    {tr.laps.slice(0, 8).map((l) => (
                      <li key={l.lapIndex}>
                        Lap {l.lapIndex}: {l.lapTimeSec.toFixed(3)}s
                        {Object.keys(l.sectorTimesSec).length > 0 &&
                          ` · sectors ${JSON.stringify(l.sectorTimesSec)}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-medium">Link to Run (transponder compare)</h3>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
            value={runIdInput}
            onChange={(e) => setRunIdInput(e.target.value)}
            placeholder="Run cuid"
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
            onClick={() => void linkRun()}
          >
            Save
          </button>
          {runIdInput && (
            <Link href={`/runs/${runIdInput}/edit`} className="text-xs underline self-center">
              Open run
            </Link>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-medium">Manual MOT ID correction</h3>
        <p className="text-xs text-muted-foreground">
          Reassign track ID for a time window (e.g. after crossover swap).
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <input
            className="w-16 rounded-md border border-border px-2 py-1"
            placeholder="from"
            value={correctionFrom}
            onChange={(e) => setCorrectionFrom(e.target.value)}
          />
          <span>→</span>
          <input
            className="w-16 rounded-md border border-border px-2 py-1"
            placeholder="to"
            value={correctionTo}
            onChange={(e) => setCorrectionTo(e.target.value)}
          />
          <input
            className="w-20 rounded-md border border-border px-2 py-1"
            placeholder="start s"
            value={correctionStart}
            onChange={(e) => setCorrectionStart(e.target.value)}
          />
          <input
            className="w-20 rounded-md border border-border px-2 py-1"
            placeholder="end s"
            value={correctionEnd}
            onChange={(e) => setCorrectionEnd(e.target.value)}
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 hover:bg-muted"
            onClick={() => void addCorrection()}
          >
            Add correction
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
