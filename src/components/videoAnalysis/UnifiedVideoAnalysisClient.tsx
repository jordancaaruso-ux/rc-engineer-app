"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import { VideoFrameControls } from "./VideoFrameControls";
import { VideoViewTransform } from "./VideoViewTransform";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type { DriverRole, ManualDriverLap, ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { normalizeManualSession } from "@/lib/manualVideoAnalysis/timing";
import { findTimingSession, updateTimingSession } from "@/lib/manualVideoAnalysis/sessionModel";

type SectorLineApi = SectorLineNorm & { sortOrder: number };

type JobData = {
  job: {
    id: string;
    track: { id: string; name: string };
    profile: { id: string; name: string };
    runId: string | null;
  };
  manual: { session: ManualVideoSessionV2 } | null;
  sectorLines: SectorLineApi[];
};

type DriverColumn = {
  sessionId: string;
  role: DriverRole;
  driverName: string;
  laps: ManualDriverLap[];
};

type SelectedLap = {
  sessionId: string;
  role: DriverRole;
  lapNumber: number;
  driverName: string;
};

function formatLap(sec: number): string {
  return sec.toFixed(3);
}

function collectDriverColumns(session: ManualVideoSessionV2): DriverColumn[] {
  const cols: DriverColumn[] = [];
  for (const ts of session.timingSessions) {
    for (const d of ts.drivers) {
      cols.push({
        sessionId: ts.sessionId,
        role: d.role,
        driverName: d.driverName,
        laps: d.laps.filter((l) => l.isIncluded !== false && l.lapTimeSec > 0),
      });
    }
  }
  return cols;
}

function isAnchoredLap(
  session: ManualVideoSessionV2,
  sessionId: string,
  role: DriverRole,
  lapNumber: number
): boolean {
  const ts = findTimingSession(session, sessionId);
  const a = ts?.sync.anchor;
  return Boolean(a && a.driverRole === role && a.lapNumber === lapNumber && a.anchorKind === "sf_start");
}

export function UnifiedVideoAnalysisClient({ jobId }: { jobId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV2 | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [selectedLap, setSelectedLap] = useState<SelectedLap | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines: SectorLineNorm[] =
    data?.sectorLines.map((l) => ({
      lineKey: l.lineKey,
      label: l.label,
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
      sortOrder: l.sortOrder,
    })) ?? [];

  const load = useCallback(async () => {
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
    if (!res.ok) return;
    const json = (await res.json()) as JobData;
    setData(json);
    if (json.manual?.session) {
      setSession(normalizeManualSession(json.manual.session));
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  async function persistSession(next: ManualVideoSessionV2) {
    const normalized = normalizeManualSession(next);
    setSession(normalized);
    setSaving(true);
    const res = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualJson: normalized }),
    });
    setSaving(false);
    if (!res.ok) setMsg("Failed to save");
  }

  function schedulePersist(next: ManualVideoSessionV2) {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void persistSession(next);
    }, 500);
  }

  function setVideoFile(file: File | null) {
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    if (!file) {
      setVideoSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    videoObjectUrlRef.current = url;
    setVideoSrc(url);
    if (session) {
      const next = { ...session, localVideoName: file.name };
      setSession(next);
      schedulePersist(next);
    }
  }

  function currentVideoTime(): number {
    return videoRef.current?.currentTime ?? 0;
  }

  function selectLap(col: DriverColumn, lapNumber: number) {
    setSelectedLap({
      sessionId: col.sessionId,
      role: col.role,
      lapNumber,
      driverName: col.driverName,
    });
    setMsg(
      `Lap ${lapNumber} selected for ${col.driverName}. Scrub to lap start on video, then Select as anchor.`
    );
  }

  function setAnchorAtPlayhead() {
    if (!session || !selectedLap) return;
    const ts = findTimingSession(session, selectedLap.sessionId);
    if (!ts) return;
    const t = currentVideoTime();
    const next = updateTimingSession(session, selectedLap.sessionId, {
      isOnVideo: true,
      sync: {
        ...ts.sync,
        anchor: {
          videoTimeSec: t,
          lapNumber: selectedLap.lapNumber,
          driverRole: selectedLap.role,
          anchorKind: "sf_start",
        },
      },
    });
    setSession(next);
    schedulePersist(next);
    setMsg(
      `${selectedLap.driverName} lap ${selectedLap.lapNumber} start = ${t.toFixed(3)}s on video.`
    );
  }

  const driverColumns = useMemo(
    () => (session ? collectDriverColumns(session) : []),
    [session]
  );

  if (!data || !session) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-3 max-w-6xl">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/videos/analysis" className="underline text-muted-foreground">
          ← Hub
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>
          {data.job.track.name} · {data.job.profile.name}
        </span>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <label className="text-xs block max-w-sm">
        Video
        <input
          type="file"
          accept="video/*"
          className="mt-0.5 w-full rounded-md border border-border px-2 py-1"
          onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
        />
        {session.localVideoName && (
          <span className="text-muted-foreground ml-2">{session.localVideoName}</span>
        )}
      </label>

      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 min-w-[140px]">
          <p className="text-sm font-medium">Drivers</p>
          <div className="flex gap-4">
            {driverColumns.map((col) => (
              <div key={`${col.sessionId}-${col.role}`} className="flex flex-col gap-1">
                <p className="text-xs font-medium truncate max-w-[120px]" title={col.driverName}>
                  {col.driverName}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {[...col.laps]
                    .sort((a, b) => a.lapNumber - b.lapNumber)
                    .map((lap) => {
                      const isSelected =
                        selectedLap?.sessionId === col.sessionId &&
                        selectedLap.role === col.role &&
                        selectedLap.lapNumber === lap.lapNumber;
                      const isAnchor = isAnchoredLap(
                        session,
                        col.sessionId,
                        col.role,
                        lap.lapNumber
                      );
                      return (
                        <li key={lap.lapNumber}>
                          <button
                            type="button"
                            className={`w-full text-left rounded px-1.5 py-0.5 font-mono text-[11px] border ${
                              isAnchor
                                ? "border-green-600/60 bg-green-500/15"
                                : isSelected
                                  ? "border-primary bg-primary/15"
                                  : "border-transparent hover:bg-muted/50"
                            }`}
                            onClick={() => selectLap(col, lap.lapNumber)}
                            title="Select this lap"
                          >
                            {lap.lapNumber}{" "}
                            <span className="text-muted-foreground">{formatLap(lap.lapTimeSec)}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40 w-fit"
            disabled={!selectedLap || !videoSrc}
            onClick={setAnchorAtPlayhead}
          >
            Select as anchor
          </button>
          {selectedLap && (
            <p className="text-[10px] text-muted-foreground">
              Lap {selectedLap.lapNumber} · {selectedLap.driverName}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <VideoViewTransform>
            <VideoWithLineOverlay
              videoSrc={videoSrc}
              lines={lines}
              activeLineKey="sf"
              videoRef={videoRef}
            />
          </VideoViewTransform>
          <VideoFrameControls
            videoRef={videoRef}
            active={!!videoSrc}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
          />
        </div>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
