"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DualPlayheadVideo } from "./DualPlayheadVideo";
import type { SectorLineNorm } from "./SectorLineCanvas";
import type {
  DriverRole,
  ManualDriver,
  ManualDriverLap,
  ManualTimingSession,
  ManualVideoSessionV2,
  VideoViewCropNorm,
} from "@/lib/manualVideoAnalysis/types";
import {
  applyDefaultIsOnVideo,
  applyTop3LapSelection,
  defaultDriverKeys,
  normalizeManualSession,
  setDriverRoles,
} from "@/lib/manualVideoAnalysis/timing";
import {
  findTimingSession,
  getCompareSfAlignment,
  referenceAnchoredSession,
  updateTimingSession,
  videoTimeAtLapSf,
} from "@/lib/manualVideoAnalysis/sessionModel";
import { lapSfKey } from "@/lib/manualVideoAnalysis/types";
import { clampViewCropNorm } from "@/lib/manualVideoAnalysis/videoViewCrop";

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
  const [compareSnapSec, setCompareSnapSec] = useState<number | null>(null);
  const [timingUrls, setTimingUrls] = useState("");
  const [pickerDrivers, setPickerDrivers] = useState<ManualDriver[]>([]);
  const [meKey, setMeKey] = useState("");
  const [competitorKey, setCompetitorKey] = useState("");
  const [timingLoading, setTimingLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cropSelectMode, setCropSelectMode] = useState(false);
  const [draftCrop, setDraftCrop] = useState<VideoViewCropNorm | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines: SectorLineNorm[] =
    data?.sectorLines
      .filter((l) => l.lineKey === "sf")
      .map((l) => ({
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
      setTimingUrls((normalized.timingUrls ?? []).join("\n"));
      const flat = normalized.timingSessions.flatMap((ts) => ts.drivers);
      setPickerDrivers(flat);
      const defaults = defaultDriverKeys(flat);
      setMeKey(defaults.meKey);
      setCompetitorKey(defaults.competitorKey);
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

  useEffect(() => {
    if (!ghostCompareActive || compareSnapSec != null || !compareSfAlignment) return;
    setCompareSnapSec(compareSfAlignment.bottomSec);
  }, [ghostCompareActive, compareSnapSec, compareSfAlignment]);

  function onLapClick(col: DriverColumn, lapNumber: number) {
    const key = driverColumnKey(col);
    const playhead = currentVideoTime();
    setSelectedLap({
      sessionId: col.sessionId,
      role: col.role,
      lapNumber,
      driverName: col.driverName,
    });

    const refSession = session ? referenceAnchoredSession(session) : undefined;
    if (!session || !refSession?.sync.anchor) {
      setMsg(
        `Lap ${lapNumber} selected for ${col.driverName}. Scrub to lap start on video, then Select as anchor.`
      );
      return;
    }

    const anchor = refSession.sync.anchor;
    const isAnchorDriverLap =
      refSession.sessionId === col.sessionId &&
      anchor.driverRole === col.role &&
      anchor.lapNumber === lapNumber;

    let workingSession = session;
    if (!isAnchorDriverLap) {
      const ts = findTimingSession(session, col.sessionId);
      if (ts) {
        const sfKey = lapSfKey(col.role, lapNumber);
        workingSession = updateTimingSession(session, col.sessionId, {
          sync: {
            ...ts.sync,
            perLapSfStart: {
              ...ts.sync.perLapSfStart,
              [sfKey]: playhead,
            },
          },
        });
      }
    }

    const nextCompareLaps = { ...compareLaps, [key]: lapNumber };
    setCompareLaps(nextCompareLaps);
    const nextSession = sessionWithCompareLaps(workingSession, driverColumns, nextCompareLaps);
    nextSession.compare = { ...nextSession.compare, offsetNudgeSec: 0 };
    setSession(nextSession);
    schedulePersist(nextSession);

    const t = videoTimeAtLapSf(nextSession, col.sessionId, col.role, lapNumber, "sf_start");
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
        setCompareSnapSec(alignment.bottomSec);
        setMsg(
          `Comparing ${compareSlotLabel(session, col0, nextCompareLaps[driverColumnKey(col0)!])} vs ${compareSlotLabel(session, col1, nextCompareLaps[driverColumnKey(col1)!])} at lap start. Scrub or nudge sync to align.`
        );
        return;
      }
    }

    setCompareSnapSec(null);

    if (!isAnchorDriverLap) {
      setMsg(
        `${col.driverName} lap ${lapNumber} synced to playhead @ ${playhead.toFixed(2)}s. Pick the other driver's lap to compare.`
      );
      return;
    }

    seekTo(t);
    setMsg(`${col.driverName} lap ${lapNumber} start @ ${t.toFixed(2)}s`);
  }

  function nudgeCompareSync(deltaSec: number) {
    if (!session) return;
    const cur = session.compare.offsetNudgeSec ?? 0;
    const next = {
      ...session,
      compare: { ...session.compare, offsetNudgeSec: cur + deltaSec },
    };
    setSession(next);
    schedulePersist(next);
  }

  function driverPickerLabel(d: ManualDriver): string {
    if (!session) return d.driverName;
    const ts = session.timingSessions.find((s) => s.drivers.some((x) => x.key === d.key));
    const prefix =
      session.timingSessions.length > 1 && ts ? `${ts.label}: ` : "";
    return `${prefix}${d.driverName} (${d.laps.length} laps)`;
  }

  function sessionsWithRoles(
    sessions: ManualTimingSession[],
    nextMeKey: string,
    nextCompetitorKey: string
  ): ManualTimingSession[] {
    return applyDefaultIsOnVideo(
      sessions.map((ts) => ({
        ...ts,
        drivers: setDriverRoles(ts.drivers, nextMeKey, nextCompetitorKey),
      }))
    );
  }

  function applyDriverRolesToSession(nextMeKey: string, nextCompetitorKey: string) {
    if (!session) return;
    const timingSessions = sessionsWithRoles(
      session.timingSessions,
      nextMeKey,
      nextCompetitorKey
    );
    let next = applyTop3LapSelection({
      ...session,
      timingSessions,
    });
    setSession(next);
    schedulePersist(next);
  }

  async function loadTimingUrls() {
    if (!session) return;
    const urls = timingUrls
      .split(/\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      setMsg("Paste one or more LiveRC / timing URLs (one per line).");
      return;
    }

    setTimingLoading(true);
    setMsg(null);
    const res = await fetch("/api/video-analysis/manual/parse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    setTimingLoading(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg((err as { error?: string }).error ?? "Could not load timing");
      return;
    }

    const d = await res.json();
    const loadedSessions = (d.sessions ?? []) as ManualTimingSession[];
    const drivers = (d.drivers ?? []) as ManualDriver[];
    const defaults = (d.defaults ?? defaultDriverKeys(drivers)) as {
      meKey: string;
      competitorKey: string;
    };
    let nextMe = defaults.meKey;
    let nextComp = defaults.competitorKey;
    if (nextMe && nextMe === nextComp) {
      nextComp = drivers.find((x) => x.key !== nextMe)?.key ?? "";
    }

    const timingSessions = sessionsWithRoles(loadedSessions, nextMe, nextComp);
    let next = applyTop3LapSelection({
      ...session,
      timingSource: "url",
      timingUrls: urls,
      timingSessions,
      compare: { ...session.compare, my: null, competitor: null, offsetNudgeSec: 0 },
    });
    next = normalizeManualSession(next);
    setPickerDrivers(drivers);
    setMeKey(nextMe);
    setCompetitorKey(nextComp);
    setCompareLaps({});
    setCompareSnapSec(null);
    setSession(next);
    await persistSession(next);
    setMsg(
      d.errors?.length
        ? `Loaded ${timingSessions.length} session(s). Some URLs failed: ${(d.errors as string[]).join("; ")}`
        : `Loaded ${timingSessions.length} timing session(s). Pick laps to anchor and compare.`
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

  function startCropMode() {
    if (!videoSrc) {
      setMsg("Select a video file first.");
      return;
    }
    setDraftCrop(session?.viewCropNorm ?? null);
    setCropSelectMode(true);
    setMsg("Drag on the video to select the track area. Hold Shift for a square.");
  }

  function cancelCropMode() {
    setCropSelectMode(false);
    setDraftCrop(null);
  }

  function applyCrop() {
    if (!session) return;
    const crop = draftCrop ? clampViewCropNorm(draftCrop) : null;
    if (!crop) {
      setMsg("Draw a crop region on the video first.");
      return;
    }
    const next = { ...session, viewCropNorm: crop };
    setSession(next);
    schedulePersist(next);
    setCropSelectMode(false);
    setDraftCrop(null);
    setMsg("Crop applied. Use Revert crop to restore the full frame.");
  }

  function revertCrop() {
    if (!session) return;
    const next = { ...session, viewCropNorm: undefined };
    setSession(next);
    schedulePersist(next);
    setCropSelectMode(false);
    setDraftCrop(null);
    setMsg("Crop removed — showing full video frame.");
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
        <Link href="/videos/analysis/manual/new" className="underline text-muted-foreground">
          ← New session
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

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!cropSelectMode ? (
          <>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50"
              disabled={!videoSrc}
              onClick={startCropMode}
            >
              Crop video
            </button>
            {session.viewCropNorm ? (
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted"
                onClick={revertCrop}
              >
                Revert crop
              </button>
            ) : null}
            {session.viewCropNorm ? (
              <span className="text-muted-foreground">Track crop active</span>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
              disabled={!draftCrop}
              onClick={applyCrop}
            >
              Apply crop
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
              onClick={cancelCropMode}
            >
              Cancel
            </button>
            <span className="text-muted-foreground">Snipping mode — drag on video</span>
          </>
        )}
      </div>

      <div className="max-w-xl flex flex-col gap-2 text-xs">
        <label>
          LiveRC / timing URLs <span className="text-muted-foreground">(optional)</span>
          <textarea
            className="mt-0.5 w-full rounded-md border border-border px-2 py-1 min-h-[72px] font-mono text-xs"
            value={timingUrls}
            onChange={(e) => setTimingUrls(e.target.value)}
            placeholder={"https://...\nhttps://... (one per line)"}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50"
            disabled={timingLoading}
            onClick={() => void loadTimingUrls()}
          >
            {timingLoading ? "Loading…" : "Load laps"}
          </button>
          {session.timingSessions.length > 0 && (
            <span className="text-muted-foreground">
              {session.timingSessions.length} session
              {session.timingSessions.length === 1 ? "" : "s"} linked
            </span>
          )}
        </div>
        {pickerDrivers.length >= 2 && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Me
              <select
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1"
                value={meKey}
                onChange={(e) => {
                  const nextMe = e.target.value;
                  setMeKey(nextMe);
                  let nextComp = competitorKey;
                  if (nextComp === nextMe) {
                    nextComp = pickerDrivers.find((d) => d.key !== nextMe)?.key ?? "";
                    setCompetitorKey(nextComp);
                  }
                  applyDriverRolesToSession(nextMe, nextComp);
                }}
              >
                {pickerDrivers.map((d) => (
                  <option key={d.key} value={d.key} disabled={d.key === competitorKey}>
                    {driverPickerLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Competitor
              <select
                className="mt-0.5 w-full rounded-md border border-border px-2 py-1"
                value={competitorKey}
                onChange={(e) => {
                  const nextComp = e.target.value;
                  setCompetitorKey(nextComp);
                  applyDriverRolesToSession(meKey, nextComp);
                }}
              >
                {pickerDrivers.map((d) => (
                  <option key={d.key} value={d.key} disabled={d.key === meKey}>
                    {driverPickerLabel(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <div
        className={`grid gap-4 ${driverColumns.length > 0 ? "lg:grid-cols-[auto_minmax(0,1fr)]" : ""}`}
      >
        {driverColumns.length > 0 && (
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
        )}

        <DualPlayheadVideo
          videoSrc={videoSrc}
          lines={lines}
          activeLineKey="sf"
          offsetSec={compareSfAlignment?.offsetSec ?? null}
          ghostCompareActive={ghostCompareActive}
          alignBottomSec={compareSnapSec}
          syncNudgeSec={session.compare.offsetNudgeSec ?? 0}
          onSyncNudge={ghostCompareActive && !cropSelectMode ? nudgeCompareSync : undefined}
          bottomLabel={compareSlotLabel(session, col0, compareLap0)}
          topLabel={compareSlotLabel(session, col1, compareLap1)}
          videoRef={videoRef}
          viewCropNorm={session.viewCropNorm ?? null}
          cropSelectMode={cropSelectMode}
          draftCrop={draftCrop}
          onDraftCropChange={setDraftCrop}
        />
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
