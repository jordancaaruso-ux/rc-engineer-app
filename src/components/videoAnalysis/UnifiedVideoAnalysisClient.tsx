"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DualPlayheadVideo } from "./DualPlayheadVideo";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type { DriverRole, ManualDriverLap, ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { normalizeManualSession } from "@/lib/manualVideoAnalysis/timing";
import {
  findTimingSession,
  getCompareSfAlignment,
  referenceAnchoredSession,
  updateTimingSession,
  videoTimeAtLapSf,
} from "@/lib/manualVideoAnalysis/sessionModel";

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

function driverColumnKey(col: Pick<DriverColumn, "sessionId" | "role">): string {
  return `${col.sessionId}-${col.role}`;
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

function compareLapsFromSession(session: ManualVideoSessionV2): Record<string, number> {
  const out: Record<string, number> = {};
  const { my, competitor } = session.compare;
  if (my) out[`${my.sessionId}-${my.role}`] = my.lapNumber;
  if (competitor) out[`${competitor.sessionId}-${competitor.role}`] = competitor.lapNumber;
  return out;
}

function sessionWithCompareLaps(
  session: ManualVideoSessionV2,
  columns: DriverColumn[],
  compareLaps: Record<string, number>
): ManualVideoSessionV2 {
  const col0 = columns[0];
  const col1 = columns[1];
  const lap0 = col0 ? compareLaps[driverColumnKey(col0)] : undefined;
  const lap1 = col1 ? compareLaps[driverColumnKey(col1)] : undefined;

  return {
    ...session,
    compare: {
      ...session.compare,
      alignAt: "sf_start",
      my:
        col0 && lap0 != null
          ? { sessionId: col0.sessionId, role: col0.role, lapNumber: lap0 }
          : null,
      competitor:
        col1 && lap1 != null
          ? { sessionId: col1.sessionId, role: col1.role, lapNumber: lap1 }
          : null,
    },
  };
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

function compareSlotLabel(
  session: ManualVideoSessionV2,
  col: DriverColumn | undefined,
  lapNumber: number | undefined
): string {
  if (!col || lapNumber == null) return "—";
  return `${col.driverName} L${lapNumber}`;
}

export function UnifiedVideoAnalysisClient({ jobId }: { jobId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [session, setSession] = useState<ManualVideoSessionV2 | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [selectedLap, setSelectedLap] = useState<SelectedLap | null>(null);
  const [compareLaps, setCompareLaps] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
      const normalized = normalizeManualSession(json.manual.session);
      setSession(normalized);
      setCompareLaps(compareLapsFromSession(normalized));
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

  function seekTo(sec: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, sec);
    videoRef.current.pause();
  }

  const driverColumns = useMemo(
    () => (session ? collectDriverColumns(session) : []),
    [session]
  );

  const compareSfAlignment = useMemo(() => {
    if (!session || driverColumns.length < 2) return null;
    const withCompare = sessionWithCompareLaps(session, driverColumns, compareLaps);
    const col0 = driverColumns[0]!;
    const col1 = driverColumns[1]!;
    const lap0 = compareLaps[driverColumnKey(col0)];
    const lap1 = compareLaps[driverColumnKey(col1)];
    if (lap0 == null || lap1 == null) return null;
    return getCompareSfAlignment(withCompare, withCompare.compare);
  }, [session, driverColumns, compareLaps]);

  const ghostCompareActive = compareSfAlignment != null;

  function onLapClick(col: DriverColumn, lapNumber: number) {
    const key = driverColumnKey(col);
    setSelectedLap({
      sessionId: col.sessionId,
      role: col.role,
      lapNumber,
      driverName: col.driverName,
    });

    if (!session || !referenceAnchoredSession(session)) {
      setMsg(
        `Lap ${lapNumber} selected for ${col.driverName}. Scrub to lap start on video, then Select as anchor.`
      );
      return;
    }

    const nextCompareLaps = { ...compareLaps, [key]: lapNumber };
    setCompareLaps(nextCompareLaps);
    const nextSession = sessionWithCompareLaps(session, driverColumns, nextCompareLaps);
    setSession(nextSession);
    schedulePersist(nextSession);

    const t = videoTimeAtLapSf(session, col.sessionId, col.role, lapNumber, "sf_start");
    if (t == null) {
      setMsg(`Could not map ${col.driverName} lap ${lapNumber} to video.`);
      return;
    }

    const col0 = driverColumns[0];
    const col1 = driverColumns[1];
    const bothSelected =
      col0 &&
      col1 &&
      nextCompareLaps[driverColumnKey(col0)] != null &&
      nextCompareLaps[driverColumnKey(col1)] != null;

    if (bothSelected) {
      const alignment = getCompareSfAlignment(nextSession, nextSession.compare);
      if (alignment) {
        seekTo(alignment.bottomSec);
        setMsg(
          `Comparing ${compareSlotLabel(session, col0, nextCompareLaps[driverColumnKey(col0)!])} vs ${compareSlotLabel(session, col1, nextCompareLaps[driverColumnKey(col1)!])} at lap start.`
        );
        return;
      }
    }

    seekTo(t);
    setMsg(`${col.driverName} lap ${lapNumber} start @ ${t.toFixed(2)}s`);
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

  if (!data || !session) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const col0 = driverColumns[0];
  const col1 = driverColumns[1];
  const compareLap0 = col0 ? compareLaps[driverColumnKey(col0)] : undefined;
  const compareLap1 = col1 ? compareLaps[driverColumnKey(col1)] : undefined;

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
              <div key={driverColumnKey(col)} className="flex flex-col gap-1">
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
                      const isCompare =
                        compareLaps[driverColumnKey(col)] === lap.lapNumber;
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
                                : isCompare
                                  ? "border-amber-500/60 bg-amber-500/15"
                                  : isSelected
                                    ? "border-primary bg-primary/15"
                                    : "border-transparent hover:bg-muted/50"
                            }`}
                            onClick={() => onLapClick(col, lap.lapNumber)}
                            title={
                              referenceAnchoredSession(session)
                                ? "Jump to lap start · pick one lap per driver to compare"
                                : "Select lap, then anchor at playhead"
                            }
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
          {ghostCompareActive && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Overlay: {compareSlotLabel(session, col0, compareLap0)} vs{" "}
              {compareSlotLabel(session, col1, compareLap1)}
            </p>
          )}
        </div>

        <DualPlayheadVideo
          videoSrc={videoSrc}
          lines={lines}
          activeLineKey="sf"
          offsetSec={compareSfAlignment?.offsetSec ?? null}
          ghostCompareActive={ghostCompareActive}
          alignBottomSec={ghostCompareActive ? compareSfAlignment?.bottomSec : null}
          bottomLabel={compareSlotLabel(session, col0, compareLap0)}
          topLabel={compareSlotLabel(session, col1, compareLap1)}
          videoRef={videoRef}
        />
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
