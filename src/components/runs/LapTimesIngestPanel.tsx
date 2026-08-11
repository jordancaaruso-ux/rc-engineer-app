"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { parseManualLapText } from "@/lib/lapSession/parseManual";
import type { LapSourceKind } from "@/lib/lapSession/types";
import type { LapImportLapRow, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { formatLap } from "@/lib/runLaps";
import type { LapRow } from "@/lib/lapAnalysis";
import { getAverageTopN, getBestLap } from "@/lib/lapAnalysis";
import {
  formatDriverSessionLabel,
  formatImportedSessionTime,
  resolveImportedSessionDisplayTimeIso,
  resolveImportedSessionHasWallClockTime,
  timingSourceFromParserId,
  type ImportedSessionTimeFormatOptions,
  type LapTimingSource,
} from "@/lib/lapImport/labels";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { PagedCard } from "@/components/ui/PagedCard";
import {
  TrackTimingSourceNotice,
  type TrackTimingUrls,
} from "@/components/runs/TrackTimingSourceNotice";

export type UrlImportBlock = {
  blockId: string;
  importedSessionId: string;
  sourceUrl: string;
  parserId: string;
  /** ISO time for labels when true session time is unknown (import row createdAt). */
  recordedAt: string;
  /** DB `sessionCompletedAt` after persist (canonical when parser did not echo ISO in `sessionCompletedAtIso`). */
  sessionCompletedAtDbIso?: string | null;
  /** UTC ISO from timing page when parsed. */
  sessionCompletedAtIso: string | null;
  sessionDrivers: LapUrlSessionDriver[];
  selectedDriverIds: string[];
  driverLapRowsByDriverId: Record<string, LapRow[]>;
  urlLapRows?: LapImportLapRow[] | null;
};

export type LapIngestFormValue = {
  manualText: string;
  /** Per-lap inclusion for manual/edit entry (preserved across edits). */
  manualLapRows?: LapRow[] | null;
  sourceKind: LapSourceKind;
  sourceDetail: string | null;
  parserId: string | null;
  /** Structured laps + warnings from URL import (e.g. LiveRC) — legacy single-primary; first URL block overrides. */
  urlLapRows?: LapImportLapRow[] | null;
  /** At most one URL import per run; maps to a persisted ImportedLapTimeSession. */
  urlImportBlocks: UrlImportBlock[];
};

type IngestTab = "url-auto" | "url-manual" | "manual" | "photo";

const URL_TABS: IngestTab[] = ["url-auto", "url-manual"];

function isUrlTab(tab: IngestTab): boolean {
  return URL_TABS.includes(tab);
}

const DEFAULT_VALUE: LapIngestFormValue = {
  manualText: "",
  manualLapRows: null,
  sourceKind: "manual",
  sourceDetail: null,
  parserId: null,
  urlLapRows: null,
  urlImportBlocks: [],
};

function initDriverLapRows(drivers: LapUrlSessionDriver[]): Record<string, LapRow[]> {
  const out: Record<string, LapRow[]> = {};
  for (const d of drivers) {
    const raw = d.laps.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: true,
    }));
    out[d.driverId] = applyMedianBandAutoExclude(raw);
  }
  return out;
}

function syncManualLapRowsFromText(text: string, existing: LapRow[] | null | undefined): LapRow[] {
  const times = parseManualLapText(text);
  if (times.length === 0) return [];
  if (
    existing &&
    existing.length === times.length &&
    existing.every((r, i) => Math.abs(r.lapTimeSeconds - times[i]!) < 0.0005)
  ) {
    return existing.map((r, i) => ({
      ...r,
      lapNumber: i + 1,
      lapTimeSeconds: times[i]!,
    }));
  }
  return applyMedianBandAutoExclude(
    times.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: true,
    }))
  );
}

function blockLabelTimeIso(block: UrlImportBlock): string {
  return resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
    parsedPayload:
      block.sessionCompletedAtIso != null && block.sessionCompletedAtIso.trim()
        ? { sessionCompletedAtIso: block.sessionCompletedAtIso.trim() }
        : undefined,
    createdAt: block.recordedAt,
  });
}

/** Display options for {@link blockLabelTimeIso} — freezes LiveRC/MyRCM wall clock, viewer zone otherwise. */
function blockTimeFormatOpts(block: UrlImportBlock): ImportedSessionTimeFormatOptions {
  return {
    timingSource: timingSourceFromParserId(block.parserId),
    isWallClockTime: resolveImportedSessionHasWallClockTime({
      sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
      parsedPayload:
        block.sessionCompletedAtIso != null && block.sessionCompletedAtIso.trim()
          ? { sessionCompletedAtIso: block.sessionCompletedAtIso.trim() }
          : undefined,
    }),
  };
}

function sortSessionsNewestFirst<T>(items: T[], getIso: (item: T) => string | null): T[] {
  return [...items].sort((a, b) => {
    const ta = getIso(a) ? new Date(getIso(a)!).getTime() : 0;
    const tb = getIso(b) ? new Date(getIso(b)!).getTime() : 0;
    return tb - ta;
  });
}

function formatSessionWhen(
  iso: string | null,
  sessionTime: string | null,
  timingSource?: LapTimingSource | null
): string | null {
  if (iso?.trim()) return formatImportedSessionTime(iso.trim(), { timingSource });
  if (sessionTime?.trim()) return sessionTime.trim();
  return null;
}

function primaryLapTextFromFirstBlock(blocks: UrlImportBlock[]): string {
  const first = blocks[0];
  if (!first?.sessionDrivers?.length) return "";
  const ids = first.selectedDriverIds ?? [];
  const ordered = first.sessionDrivers.filter((d) => ids.includes(d.driverId));
  const primary = ordered[0] ?? first.sessionDrivers[0];
  if (!primary) return "";
  const rows = first.driverLapRowsByDriverId?.[primary.driverId];
  if (rows?.length) {
    return rows.map((r) => r.lapTimeSeconds.toFixed(3)).join("\n");
  }
  return primary.laps.map((t) => t.toFixed(3)).join("\n");
}

type ScanDayCandidate = {
  sessionId: string;
  sessionUrl: string;
  driverName: string;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  matchesDriver: boolean | null;
  alreadyImported: boolean;
  linkedRunId: string | null;
  timingSource?: "liverc" | "speedhive" | "myrcm";
  bestLapSeconds?: number | null;
};

/** MyRCM event page (`main?…dId[E]=…`) or class report URL without a reportKey — scannable, not directly importable. */
function isMyRcmDiscoveryPaste(raw: string): boolean {
  const url = raw.trim();
  if (!/^https?:\/\/(www\.)?myrcm\.ch\//i.test(url)) return false;
  if (/\/myrcm\/report\/[a-z]{2}\/\d+\/\d+/i.test(url) && !/[?&]reportKey=\d+/i.test(url)) return true;
  if (/\/myrcm\/main\/?\?/i.test(url) && /dId(%5B|\[)E(%5D|\])=/i.test(url)) return true;
  return false;
}

const RECENT_RUNS_COLLAPSED = 3;
const RECENT_RUNS_MAX = 10;

/** A row in the unified "Sessions to import" list (event race + track scan, deduped). */
type ImportPickerCandidate = {
  key: string;
  sessionUrl: string;
  title: string;
  when: string | null;
  bestLapSeconds: number | null;
  timingSource?: "liverc" | "speedhive" | "myrcm";
  alreadyImported: boolean;
  sortIso: string | null;
};

const REPLACE_IMPORT_CONFIRM =
  "Replace current import? Lap times from the session you imported earlier will be removed.";

function SessionImportListRow({
  title,
  when,
  bestLapSeconds,
  timingSource,
  isActive,
  actionLabel,
  disabled,
  onClick,
}: {
  title: string;
  when: string | null;
  bestLapSeconds: number | null;
  timingSource?: "liverc" | "speedhive" | "myrcm";
  isActive: boolean;
  actionLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const sourceLabel =
    timingSource === "speedhive"
      ? "Speedhive"
      : timingSource === "liverc"
        ? "LiveRC"
        : timingSource === "myrcm"
          ? "MyRCM"
          : null;
  const meta = [sourceLabel, when].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition",
        isActive
          ? "border-primary-ink/50 bg-accent/10"
          : "border-border bg-surface-runna hover:bg-surface-runna-inset",
        disabled && "opacity-60 pointer-events-none"
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{title}</span>
        {meta ? <span className="mt-0.5 block truncate text-[11px] text-faint">{meta}</span> : null}
      </span>
      {bestLapSeconds != null ? (
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-wide text-faint">Best</span>
          <span className="lap-figure text-[12.5px] font-medium text-foreground">
            {formatLap(bestLapSeconds)}
          </span>
        </span>
      ) : null}
      {isActive ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-foreground">
          <span aria-hidden className="text-emerald-500">
            ✓
          </span>
          Imported
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-primary-ink/45 bg-accent/5 px-3 py-1 text-[11px] font-bold text-primary-ink">
          {actionLabel}
        </span>
      )}
    </button>
  );
}

/** Empty-state headline + optional detail line for the import picker. */
type ScanStatus = { title: string; detail: string | null };

/** Scan status — prefer server hint; fall back to totals when all are imported. */
function resolveScanStatus(opts: {
  scanMessage: string | null;
  totalCandidates: number;
  unimportedCount: number;
  candidateCount: number;
  olderCount: number;
}): ScanStatus | null {
  const { scanMessage, totalCandidates, unimportedCount, candidateCount, olderCount } = opts;
  if (scanMessage) return { title: scanMessage, detail: null };
  if (candidateCount === 0) {
    if (olderCount > 0) {
      return {
        title: "No sessions from today yet",
        detail: `${olderCount} older session${olderCount === 1 ? "" : "s"} available below.`,
      };
    }
    if (totalCandidates > 0 && unimportedCount === 0) {
      const n = totalCandidates;
      return {
        title: "No new sessions to import",
        detail: `Found ${n} session${n === 1 ? "" : "s"} for your driver — all already imported.`,
      };
    }
    return { title: "No new sessions to import", detail: null };
  }
  return null;
}

/** Server: `/api/events/[eventId]/my-race-sessions` — driver verified on each race page. */
type EventRaceSessionRow = {
  sessionUrl: string;
  listLinkText: string | null;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  alreadyImported: boolean;
  existingImportedSessionId: string | null;
};

export function LapTimesIngestPanel({
  value,
  onChange,
  practiceDayUrl,
  lapImportEventId,
  trackId,
  trackName,
  trackLiveRcUrl,
  trackSpeedhiveUrl,
  onTrackTimingUrlsSaved,
  editingRunId,
  onUrlImportSuccess,
}: {
  value: LapIngestFormValue;
  onChange: (next: LapIngestFormValue) => void;
  /**
   * LiveRC index URL for "scan" (practice `session_list` day page, or any `/results/` page that lists sessions).
   * Optional override when track has `liveRcUrl` for automatic discovery.
   */
  practiceDayUrl?: string | null;
  /** When set, LiveRC event hub imports filter by this event's race class list. */
  lapImportEventId?: string | null;
  /** When set with a track timing URL, scan finds your most recent sessions without a daily URL. */
  trackId?: string | null;
  /** Names the track in the timing-source line, so "no timing site" points at a venue. */
  trackName?: string | null;
  trackLiveRcUrl?: string | null;
  trackSpeedhiveUrl?: string | null;
  /** Timing URL added from the notice below — caller updates its track list, which re-scans. */
  onTrackTimingUrlsSaved?: (next: TrackTimingUrls) => void;
  /** When editing a run, linked timing imports stay visible in discovery even if already imported. */
  editingRunId?: string | null;
  /**
   * A URL import just landed laps for at least one driver (both the discovered-session
   * rows and the paste box route through here). The wizard uses this to move off the
   * Laps step — importing IS that step's completion moment, and before this the driver
   * was left on a step with nothing to do and no prompt to continue.
   *
   * Deliberately a callback rather than the caller watching lap state: an effect would
   * also fire when a draft rehydrates with laps already attached, throwing the driver
   * off Laps on mount. Photo/OCR and manual paste do not call this — those get looked
   * over before moving on.
   */
  onUrlImportSuccess?: () => void;
}) {
  const hasLiveRcTrack = Boolean(trackId?.trim() && trackLiveRcUrl?.trim());
  const hasSpeedhiveTrack = Boolean(trackId?.trim() && trackSpeedhiveUrl?.trim());
  const hasTrackDiscovery = hasLiveRcTrack || hasSpeedhiveTrack;
  const hasUrlScan = Boolean((practiceDayUrl ?? "").trim()) || hasTrackDiscovery;
  const [tab, setTab] = useState<IngestTab>("url-auto");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [photoConfidence, setPhotoConfidence] = useState<string | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  /** Last manually scanned discovery URL (e.g. MyRCM event) — lets Refresh re-scan it. */
  const manualScanUrlRef = useRef<string | null>(null);
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [dayScanBusy, setDayScanBusy] = useState(false);
  const [dayScanStatus, setDayScanStatus] = useState<ScanStatus | null>(null);
  const [dayScanCandidates, setDayScanCandidates] = useState<ScanDayCandidate[] | null>(null);
  const [dayScanIndexKind, setDayScanIndexKind] = useState<"practice" | "results" | null>(null);
  const [dayScanHasDriverName, setDayScanHasDriverName] = useState<boolean>(true);
  const [scanTotals, setScanTotals] = useState<{ total: number; unimported: number } | null>(null);
  const [showAllRecentRuns, setShowAllRecentRuns] = useState(false);
  /** Unimported sessions completed before today (first-scan backlog) — collapsed by default. */
  const [dayScanOlderCandidates, setDayScanOlderCandidates] = useState<ScanDayCandidate[] | null>(null);
  const [dayScanOlderTotal, setDayScanOlderTotal] = useState(0);
  const [showOlderSessions, setShowOlderSessions] = useState(false);
  /** `${blockId}:${driverId}` for lap preview */
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);

  const [liveRcDriverName, setLiveRcDriverName] = useState<string | null>(null);
  const [liveRcDriverId, setLiveRcDriverId] = useState<string | null>(null);

  const [eventRaceBusy, setEventRaceBusy] = useState(false);
  const [eventRaceSessions, setEventRaceSessions] = useState<EventRaceSessionRow[] | null>(null);
  const [eventRaceHint, setEventRaceHint] = useState<string | null>(null);

  const loadEventRaceSessions = useCallback(async () => {
    const eid = lapImportEventId?.trim();
    if (!eid) {
      setEventRaceSessions(null);
      setEventRaceHint(null);
      return;
    }
    setEventRaceBusy(true);
    setEventRaceHint(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eid)}/my-race-sessions`);
      const data = (await res.json().catch(() => null)) as {
        sessions?: EventRaceSessionRow[];
        hint?: string | null;
        error?: string;
      } | null;
      if (!res.ok) {
        setEventRaceSessions([]);
        setEventRaceHint(data?.error ?? "Could not load sessions for this event.");
        return;
      }
      setEventRaceSessions(Array.isArray(data?.sessions) ? data!.sessions! : []);
      setEventRaceHint(typeof data?.hint === "string" && data.hint.trim() ? data.hint : null);
    } catch {
      setEventRaceSessions([]);
      setEventRaceHint("Request failed.");
    } finally {
      setEventRaceBusy(false);
    }
  }, [lapImportEventId]);

  useEffect(() => {
    void loadEventRaceSessions();
  }, [loadEventRaceSessions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings/live-rc-driver");
        const data = (await res.json().catch(() => null)) as {
          liveRcDriverName?: string | null;
          liveRcDriverId?: string | null;
        } | null;
        if (cancelled || !res.ok || !data) return;
        setLiveRcDriverName(typeof data.liveRcDriverName === "string" ? data.liveRcDriverName : null);
        setLiveRcDriverId(typeof data.liveRcDriverId === "string" ? data.liveRcDriverId : null);
      } catch {
        /* keep nulls */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasUrlScan) {
      setTab((prev) => (prev === "manual" ? "url-auto" : prev));
    }
  }, [hasUrlScan]);

  useEffect(() => {
    if (value.sourceKind === "url" && value.urlImportBlocks.length > 0) {
      setTab("url-auto");
    }
  }, [value.sourceKind, value.urlImportBlocks.length]);

  useEffect(() => {
    if (hasTrackDiscovery) {
      void scanDayUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescan when track context changes only
  }, [trackId, trackLiveRcUrl, trackSpeedhiveUrl, lapImportEventId, editingRunId]);

  const activeImportBlock = value.urlImportBlocks[0] ?? null;
  const activeImportUrl = activeImportBlock?.sourceUrl.trim() ?? "";

  const hasLinkedLapImport = Boolean(activeImportBlock);

  const sortedDayScanCandidates = useMemo(() => {
    if (!dayScanCandidates?.length) return [];
    return sortSessionsNewestFirst(dayScanCandidates, (c) => c.sessionCompletedAtIso);
  }, [dayScanCandidates]);

  const sortedEventRaceSessions = useMemo(() => {
    if (!eventRaceSessions?.length) return [];
    return sortSessionsNewestFirst(eventRaceSessions, (c) => c.sessionCompletedAtIso);
  }, [eventRaceSessions]);

  // One import list: event race sessions (matched by LiveRC driver ID — precise) merged with
  // track scan candidates (practice + results across LiveRC + Speedhive, matched by name/transponder),
  // deduped by session URL. Event rows win on dedupe so ID precision is preserved.
  const mergedImportCandidates = useMemo<ImportPickerCandidate[]>(() => {
    const byUrl = new Map<string, ImportPickerCandidate>();
    for (const c of sortedEventRaceSessions) {
      const url = c.sessionUrl.trim();
      if (!url) continue;
      byUrl.set(url, {
        key: `event:${url}`,
        sessionUrl: c.sessionUrl,
        title: c.listLinkText?.trim() || "Race session",
        when: formatSessionWhen(c.sessionCompletedAtIso, c.sessionTime, "liverc"),
        bestLapSeconds: null,
        timingSource: "liverc",
        alreadyImported: c.alreadyImported,
        sortIso: c.sessionCompletedAtIso,
      });
    }
    for (const c of sortedDayScanCandidates) {
      const url = c.sessionUrl.trim();
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, {
        key: `track:${c.sessionId}`,
        sessionUrl: c.sessionUrl,
        title: c.driverName?.trim() || "Run",
        when: formatSessionWhen(c.sessionCompletedAtIso, c.sessionTime, c.timingSource),
        bestLapSeconds: c.bestLapSeconds ?? null,
        timingSource: c.timingSource,
        alreadyImported: c.alreadyImported,
        sortIso: c.sessionCompletedAtIso,
      });
    }
    return sortSessionsNewestFirst(Array.from(byUrl.values()), (r) => r.sortIso);
  }, [sortedEventRaceSessions, sortedDayScanCandidates]);

  // Backlog list (unimported sessions from before today) — collapsed behind "Show older sessions".
  const olderPickerRows = useMemo<ImportPickerCandidate[]>(() => {
    if (!dayScanOlderCandidates?.length) return [];
    const seenUrls = new Set(mergedImportCandidates.map((c) => c.sessionUrl.trim()));
    return sortSessionsNewestFirst(
      dayScanOlderCandidates.filter((c) => c.sessionUrl.trim() && !seenUrls.has(c.sessionUrl.trim())),
      (c) => c.sessionCompletedAtIso
    ).map((c) => ({
      key: `older:${c.sessionId}`,
      sessionUrl: c.sessionUrl,
      title: c.driverName?.trim() || "Run",
      when: formatSessionWhen(c.sessionCompletedAtIso, c.sessionTime, c.timingSource),
      bestLapSeconds: c.bestLapSeconds ?? null,
      timingSource: c.timingSource,
      alreadyImported: c.alreadyImported,
      sortIso: c.sessionCompletedAtIso,
    }));
  }, [dayScanOlderCandidates, mergedImportCandidates]);

  const canExpandImportRows = mergedImportCandidates.length > RECENT_RUNS_COLLAPSED;

  // Total for the status line — the track scan may report more unimported sessions than it returns rows for.
  const importPickerTotal = Math.max(mergedImportCandidates.length, scanTotals?.unimported ?? 0);

  function selectTab(id: IngestTab) {
    setTab(id);
    if (id === "manual") {
      onChange({
        ...value,
        sourceKind: "manual",
        sourceDetail: null,
        parserId: null,
        urlLapRows: null,
        urlImportBlocks: [],
      });
    }
  }

  async function onPhotoSelected(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoNote(null);
    setPhotoConfidence(null);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await fetch("/api/laps/extract-preview", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoNote((data as { error?: string })?.error || "Upload failed.");
        return;
      }
      const laps = (data as { laps?: number[] })?.laps ?? [];
      const note = (data as { note?: string | null })?.note ?? null;
      const conf = (data as { confidence?: string | null })?.confidence ?? null;
      const filename = (data as { filename?: string | null })?.filename ?? file.name;
      const textFromLaps = laps.length ? laps.map((n) => n.toFixed(3)).join("\n") : value.manualText;
      const manualLapRows = syncManualLapRowsFromText(textFromLaps, null);
      onChange({
        ...value,
        manualText: textFromLaps,
        manualLapRows: manualLapRows.length ? manualLapRows : null,
        sourceKind: "screenshot",
        sourceDetail: filename || null,
        parserId: (data as { extractorId?: string })?.extractorId ?? "openai_gpt4o_mini_vision_v1",
        urlLapRows: null,
        urlImportBlocks: [],
      });
      setPhotoNote(note);
      setPhotoConfidence(conf);
    } catch {
      setPhotoNote("Upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function scanDayUrl(overrideDayUrl?: string) {
    const url = (overrideDayUrl ?? practiceDayUrl ?? "").trim();
    const tid = trackId?.trim() ?? "";
    const useTrack = overrideDayUrl ? false : hasTrackDiscovery;
    if (!useTrack && !url) {
      setDayScanStatus({
        title: "No timing source for this track",
        detail: "Select a track with a LiveRC or Speedhive URL on the Tracks page.",
      });
      return;
    }
    setDayScanBusy(true);
    setDayScanStatus(null);
    setDayScanIndexKind(null);
    setScanTotals(null);
    setShowAllRecentRuns(false);
    setDayScanOlderCandidates(null);
    setDayScanOlderTotal(0);
    setShowOlderSessions(false);
    // Manual (pasted URL) scan: render the picker area immediately so busy/error states are visible
    // even when the run has no track discovery or linked event.
    if (overrideDayUrl) setDayScanCandidates([]);
    try {
      // Local start-of-day: the picker defaults to today's sessions; older unimported
      // sessions (e.g. a new user's Speedhive history) come back collapsed separately.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const res = await fetch("/api/laps/scan-day-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(useTrack ? { trackId: tid } : { dayUrl: url }),
          eventId: lapImportEventId?.trim() || undefined,
          runId: editingRunId?.trim() || undefined,
          todayStartIso: useTrack ? todayStart.toISOString() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDayScanStatus({
          title: "Scan failed",
          detail: (data as { error?: string })?.error || null,
        });
        setDayScanCandidates(overrideDayUrl ? [] : null);
        return;
      }
      const candidates = Array.isArray((data as { candidates?: unknown }).candidates)
        ? ((data as { candidates: ScanDayCandidate[] }).candidates)
        : [];
      const hasDriver = Boolean((data as { hasDriverNameSetting?: boolean }).hasDriverNameSetting);
      const ik = (data as { indexKind?: string }).indexKind;
      const scanMessage =
        typeof (data as { scanMessage?: unknown }).scanMessage === "string"
          ? ((data as { scanMessage: string }).scanMessage.trim() || null)
          : null;
      const totalCandidates =
        typeof (data as { totalCandidates?: unknown }).totalCandidates === "number"
          ? (data as { totalCandidates: number }).totalCandidates
          : candidates.length;
      const unimportedCount =
        typeof (data as { unimportedCount?: unknown }).unimportedCount === "number"
          ? (data as { unimportedCount: number }).unimportedCount
          : candidates.length;
      const olderCandidates = Array.isArray((data as { olderCandidates?: unknown }).olderCandidates)
        ? ((data as { olderCandidates: ScanDayCandidate[] }).olderCandidates)
        : [];
      const olderCount =
        typeof (data as { olderCount?: unknown }).olderCount === "number"
          ? (data as { olderCount: number }).olderCount
          : olderCandidates.length;
      setDayScanIndexKind(ik === "results" || ik === "practice" ? ik : null);
      setDayScanHasDriverName(hasDriver);
      setDayScanCandidates(candidates);
      setDayScanOlderCandidates(olderCandidates);
      setDayScanOlderTotal(olderCount);
      setScanTotals({ total: totalCandidates, unimported: unimportedCount });
      setDayScanStatus(
        resolveScanStatus({
          scanMessage,
          totalCandidates,
          unimportedCount,
          candidateCount: candidates.length,
          olderCount,
        })
      );
    } catch {
      setDayScanStatus({ title: "Scan failed", detail: null });
    } finally {
      setDayScanBusy(false);
    }
  }

  function confirmReplaceIfNeeded(targetUrl: string): boolean {
    if (!activeImportBlock) return true;
    const currentUrl = activeImportUrl;
    const nextUrl = targetUrl.trim();
    if (!nextUrl || currentUrl === nextUrl) return true;
    return window.confirm(REPLACE_IMPORT_CONFIRM);
  }

  function clearImport() {
    onChange({
      ...value,
      urlImportBlocks: [],
      sourceKind: "manual",
      sourceDetail: null,
      parserId: null,
      urlLapRows: null,
      manualText: "",
      manualLapRows: null,
    });
    setActivePreviewKey(null);
    setUrlMessage(null);
  }

  async function importFromSessionUrl(sessionUrl: string) {
    if (!confirmReplaceIfNeeded(sessionUrl)) return;
    setUrlInput(sessionUrl);
    setUrlMessage(null);
    setDayScanStatus(null);
    await fetchUrlPreviewWithUrl(sessionUrl);
  }

  /** Refresh both discovery sources behind the unified import list. */
  function refreshImportSources() {
    void loadEventRaceSessions();
    if (hasTrackDiscovery) void scanDayUrl();
    else if (manualScanUrlRef.current) void scanDayUrl(manualScanUrlRef.current);
  }

  async function fetchUrlPreviewWithUrl(explicit: string) {
    const url = explicit.trim();
    if (!url) {
      setUrlMessage("Paste a timing/results URL first.");
      return;
    }
    await runUrlImport(url);
  }

  async function fetchUrlPreview() {
    const url = urlInput.trim();
    if (!url) {
      setUrlMessage("Paste a timing/results URL first.");
      return;
    }
    // MyRCM event / class URL: it lists many sessions, so scan it into the picker
    // instead of importing (a direct MyRCM session URL with ?reportKey= imports normally).
    if (isMyRcmDiscoveryPaste(url)) {
      manualScanUrlRef.current = url;
      setUrlMessage(null);
      setTab("url-auto");
      await scanDayUrl(url);
      return;
    }
    if (!confirmReplaceIfNeeded(url)) return;
    await runUrlImport(url);
  }

  async function runUrlImport(url: string) {
    setUrlBusy(true);
    setUrlMessage(null);
    try {
      const res = await fetch("/api/lap-time-sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: [url],
          ...(lapImportEventId?.trim() ? { eventId: lapImportEventId.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlMessage((data as { error?: string })?.error || "Request failed.");
        return;
      }
      const results = Array.isArray((data as { results?: unknown }).results)
        ? ((data as { results: unknown[] }).results as Record<string, unknown>[])
        : [];

      type SuccessRow = {
        success: true;
        importedSessionId: string;
        recordedAt: string;
        sessionCompletedAtIso?: string | null;
        sessionCompletedAtDbIso?: string | null;
        parserId: string;
        message?: string | null;
        laps?: number[];
        lapRows?: LapImportLapRow[] | null;
        sessionDrivers?: LapUrlSessionDriver[];
        sessionHint?: { name?: string | null } | null;
        url?: string;
      };

      const successes: SuccessRow[] = [];
      const failures: { error: string }[] = [];
      for (const r of results) {
        if (!r || typeof r !== "object") continue;
        if (r.success === true && typeof (r as SuccessRow).importedSessionId === "string") {
          successes.push(r as SuccessRow);
        } else if (r.success === false && typeof (r as { error?: string }).error === "string") {
          failures.push({ error: (r as { error: string }).error });
        }
      }

      if (successes.length === 0) {
        setUrlMessage(failures[0]?.error ?? "Could not import this URL.");
        return;
      }

      const row = successes[0]!;
      const parserId = row.parserId ?? "http_timing_v1";
      const combinedMessage = row.message ?? null;

      const sessionDriversRaw = row.sessionDrivers ?? [];
      const sessionDrivers = Array.isArray(sessionDriversRaw)
        ? sessionDriversRaw.filter((d) => d && typeof d.driverId === "string" && Array.isArray(d.laps))
        : [];
      const topLaps = row.laps ?? [];
      const lapRowsFromApi = row.lapRows;

      const autoSelectIds =
        sessionDrivers.length === 0
          ? []
          : sessionDrivers.length === 1 && sessionDrivers[0]?.driverId
            ? [sessionDrivers[0].driverId]
            : [
              pickPrimarySessionDriver(sessionDrivers, {
                liveRcDriverId,
                liveRcDriverName,
                // Server-side match (Speedhive transponder / driver name aware) — used
                // when the local LiveRC id/name don't identify a row.
                sessionHintName: typeof row.sessionHint?.name === "string" ? row.sessionHint.name : null,
              }).driverId,
            ];

      const recordedAt = row.recordedAt ?? new Date().toISOString();
      const sessionCompletedAtIso =
        typeof row.sessionCompletedAtIso === "string" && row.sessionCompletedAtIso.trim()
          ? row.sessionCompletedAtIso.trim()
          : null;
      const sessionCompletedAtDbIso =
        typeof row.sessionCompletedAtDbIso === "string" && row.sessionCompletedAtDbIso.trim()
          ? row.sessionCompletedAtDbIso.trim()
          : null;

      const sourceUrl = typeof row.url === "string" && row.url.trim() ? row.url.trim() : url;

      const newBlock: UrlImportBlock = {
        blockId: crypto.randomUUID(),
        importedSessionId: row.importedSessionId,
        sourceUrl,
        parserId,
        recordedAt,
        sessionCompletedAtDbIso,
        sessionCompletedAtIso,
        sessionDrivers: sessionDrivers.length > 0 ? sessionDrivers : [],
        selectedDriverIds: autoSelectIds,
        driverLapRowsByDriverId: sessionDrivers.length > 0 ? initDriverLapRows(sessionDrivers) : {},
        urlLapRows:
          Array.isArray(lapRowsFromApi) && lapRowsFromApi.length > 0 && lapRowsFromApi.length === topLaps.length
            ? lapRowsFromApi
            : null,
      };

      const nextBlocks = [newBlock];

      onChange({
        ...value,
        manualText: primaryLapTextFromFirstBlock(nextBlocks),
        sourceKind: "url",
        sourceDetail: newBlock.sourceUrl,
        parserId: newBlock.parserId ?? "liverc_deterministic_v1",
        urlLapRows: newBlock.urlLapRows ?? null,
        urlImportBlocks: nextBlocks,
      });
      const pid = newBlock.selectedDriverIds?.[0];
      if (pid) {
        setActivePreviewKey(`${newBlock.blockId}:${pid}`);
      }
      setUrlInput("");
      setUrlMessage(combinedMessage);
      setDayScanCandidates((prev) =>
        prev ? prev.map((c) => (c.sessionUrl === url ? { ...c, alreadyImported: true } : c)) : prev
      );
      void loadEventRaceSessions();
      // Gated on a driver being present — that is the same condition the caller's
      // buildImportedLapSetsFromIngest requires before it will produce any lap
      // sets, so a driver-less parse never advances off a still-empty step.
      if (sessionDrivers.length > 0) onUrlImportSuccess?.();
    } catch {
      setUrlMessage("Request failed.");
    } finally {
      setUrlBusy(false);
    }
  }

  /** One primary driver per block (whose laps are edited / drive the run). Click a row to switch. */
  function selectPrimaryDriverForBlock(blockId: string, driverId: string, blockIndex: number) {
    const blocks = value.urlImportBlocks.map((b) => {
      if (b.blockId !== blockId) return b;
      return { ...b, selectedDriverIds: [driverId], urlLapRows: null };
    });
    onChange({
      ...value,
      urlImportBlocks: blocks,
      ...(blockIndex === 0
        ? {
            manualText: primaryLapTextFromFirstBlock(blocks),
            urlLapRows: blocks[0]?.urlLapRows ?? null,
            parserId: blocks[0]?.parserId ?? value.parserId,
          }
        : {}),
    });
  }

  function statsForDriver(block: UrlImportBlock, d: LapUrlSessionDriver): { bestLap: number | null; avgTop10: number | null } {
    const rows =
      block.driverLapRowsByDriverId?.[d.driverId] ??
      d.laps.map((t, i) => ({
        lapNumber: i + 1,
        lapTimeSeconds: t,
        isIncluded: true,
      }));
    return {
      bestLap: getBestLap(rows),
      avgTop10: getAverageTopN(rows, 10),
    };
  }

  const activeImportPreview = useMemo(() => {
    const block = activeImportBlock;
    if (!block) return null;
    const primaryId = block.selectedDriverIds?.[0] ?? block.sessionDrivers[0]?.driverId ?? null;
    const driver = primaryId ? block.sessionDrivers.find((d) => d.driverId === primaryId) ?? null : null;
    const stats = driver ? statsForDriver(block, driver) : null;
    const title = driver
      ? formatDriverSessionLabel(driver.driverName, blockLabelTimeIso(block), blockTimeFormatOpts(block))
      : block.sourceUrl;
    const timingSource = timingSourceFromParserId(block.parserId) ?? undefined;
    return {
      title,
      when: formatImportedSessionTime(blockLabelTimeIso(block), blockTimeFormatOpts(block)),
      bestLapSeconds: stats?.bestLap ?? null,
      timingSource,
    };
  }, [activeImportBlock, value.urlImportBlocks]);

  // Visible slice of the merged list (collapsed/expanded), with the active import always surfaced.
  const importPickerRows = useMemo(() => {
    type Row = {
      key: string;
      sessionUrl: string;
      title: string;
      when: string | null;
      bestLapSeconds: number | null;
      timingSource?: "liverc" | "speedhive" | "myrcm";
      alreadyImported: boolean;
      isActive: boolean;
    };
    const limit = showAllRecentRuns ? RECENT_RUNS_MAX : RECENT_RUNS_COLLAPSED;
    const rows: Row[] = mergedImportCandidates.slice(0, limit).map((c) => {
      const isActive = activeImportUrl === c.sessionUrl.trim();
      return {
        key: c.key,
        sessionUrl: c.sessionUrl,
        title: c.title,
        when: c.when,
        bestLapSeconds: isActive ? activeImportPreview?.bestLapSeconds ?? c.bestLapSeconds : c.bestLapSeconds,
        timingSource: c.timingSource,
        alreadyImported: c.alreadyImported,
        isActive,
      };
    });
    if (activeImportBlock && activeImportUrl && !rows.some((r) => r.sessionUrl.trim() === activeImportUrl)) {
      rows.unshift({
        key: activeImportBlock.blockId,
        sessionUrl: activeImportUrl,
        title: activeImportPreview?.title ?? activeImportUrl,
        when: activeImportPreview?.when ?? null,
        bestLapSeconds: activeImportPreview?.bestLapSeconds ?? null,
        timingSource: activeImportPreview?.timingSource,
        alreadyImported: false,
        isActive: true,
      });
    }
    return rows;
  }, [
    mergedImportCandidates,
    showAllRecentRuns,
    activeImportBlock,
    activeImportUrl,
    activeImportPreview,
  ]);

  function toggleLapInclusion(blockId: string, driverId: string, lapIndex: number) {
    const blocks = value.urlImportBlocks.map((b) => {
      if (b.blockId !== blockId) return b;
      const prev = b.driverLapRowsByDriverId?.[driverId];
      if (!prev?.[lapIndex]) return b;
      const nextRows = [...prev];
      nextRows[lapIndex] = { ...nextRows[lapIndex], isIncluded: !nextRows[lapIndex].isIncluded };
      return {
        ...b,
        driverLapRowsByDriverId: {
          ...(b.driverLapRowsByDriverId ?? {}),
          [driverId]: nextRows,
        },
        urlLapRows: null,
      };
    });
    onChange({
      ...value,
      urlImportBlocks: blocks,
      manualText: primaryLapTextFromFirstBlock(blocks),
      urlLapRows: blocks[0]?.urlLapRows ?? null,
      parserId: blocks[0]?.parserId ?? value.parserId,
    });
  }

  return (
    <SurfaceCard
      variant="panel"
      overflowHidden={false}
      contentClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Lap times</Eyebrow>
        {hasLinkedLapImport && isUrlTab(tab) ? (
          <button
            type="button"
            className="ml-auto shrink-0 rounded-md border border-border bg-surface-runna px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-runna-inset hover:text-foreground transition"
            onClick={clearImport}
          >
            Clear import
          </button>
        ) : null}
      </div>
      <PagedCard
        storageKey="run-form:lap-ingest"
        controlPosition="above"
        heightMode="adaptive"
        activeId={tab}
        onActiveIdChange={(id) => selectTab(id as IngestTab)}
        faces={[
          {
            id: "url-auto",
            label: "URL Auto",
            content: (
        <div className="space-y-2 text-sm">
          {/* What discovery is actually pointed at, said before the empty list can be read
              as a failed scan (founder 2026-08-05). */}
          {trackId?.trim() ? (
            <TrackTimingSourceNotice
              trackId={trackId.trim()}
              trackName={trackName}
              liveRcUrl={trackLiveRcUrl}
              speedhiveUrl={trackSpeedhiveUrl}
              onSaved={(next) => onTrackTimingUrlsSaved?.(next)}
            />
          ) : null}
          {hasTrackDiscovery || lapImportEventId?.trim() || dayScanCandidates != null ? (
            <div
              className="space-y-2 rounded-md border border-border bg-surface-runna p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="type-data-label">Sessions to import</span>
                  {importPickerTotal > 0 ? (
                    <span className="text-[12px] font-semibold tabular-nums text-foreground">
                      {importPickerTotal}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={eventRaceBusy || dayScanBusy}
                  className={cn(
                    "shrink-0 rounded-md border border-border bg-surface-runna px-3 py-1.5 text-[11px] font-medium hover:bg-surface-runna-inset transition",
                    (eventRaceBusy || dayScanBusy) && "opacity-60 pointer-events-none"
                  )}
                  onClick={() => refreshImportSources()}
                >
                  {eventRaceBusy || dayScanBusy ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {hasTrackDiscovery && !dayScanHasDriverName ? (
                // Just-in-time timing gate (docs/ONBOARDING_NORTH_STAR.md, reversal
                // 2026-07-23): timing isn't required up front, so this is where it
                // actually bites — no identity, no way to match your sessions. Kept
                // source-aware (LiveRC name vs Speedhive transponder) so it never
                // over-asks; a plain link, not a hard wall, so manual picking still works.
                <div className="rounded-md border border-border bg-surface-runna-inset p-2.5">
                  <p className="text-[12px] font-semibold text-foreground">
                    Add your timing details so laps attach on their own
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {hasSpeedhiveTrack && !hasLiveRcTrack
                      ? "We need your MYLAPS transponder number and/or Speedhive driver name to find your sessions at this track."
                      : "We need your driver name (LiveRC, and/or a Speedhive transponder / name) to find your sessions at this track."}
                  </p>
                  <Link
                    href="/settings"
                    className="mt-2 inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground transition hover:brightness-95"
                  >
                    Add timing details
                  </Link>
                </div>
              ) : null}
              {importPickerRows.length > 0 ? (
                <div className="space-y-1">
                  <ul className="space-y-1">
                    {importPickerRows.map((row) => (
                      <li key={row.key}>
                        <SessionImportListRow
                          title={row.title}
                          when={row.when}
                          bestLapSeconds={row.bestLapSeconds}
                          timingSource={row.timingSource}
                          isActive={row.isActive}
                          actionLabel={row.alreadyImported ? "Import again" : "Import"}
                          disabled={urlBusy}
                          onClick={() => {
                            if (row.isActive) return;
                            void importFromSessionUrl(row.sessionUrl);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                  {canExpandImportRows ? (
                    <button
                      type="button"
                      className="w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-runna-inset transition"
                      onClick={() => setShowAllRecentRuns((prev) => !prev)}
                    >
                      {showAllRecentRuns
                        ? "Show fewer sessions"
                        : `Show more sessions (${Math.min(RECENT_RUNS_MAX, mergedImportCandidates.length) - RECENT_RUNS_COLLAPSED} more)`}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {(eventRaceBusy || dayScanBusy) && importPickerRows.length === 0 ? (
                <div role="status" className="flex flex-col items-center gap-2.5 px-3 py-5 text-center">
                  <span
                    aria-hidden
                    className="h-[22px] w-[22px] animate-spin rounded-full border-2 border-primary-ink/20 border-t-accent"
                  />
                  <p className="text-sm font-semibold text-foreground">Searching for new runs…</p>
                </div>
              ) : null}
              {!eventRaceBusy && !dayScanBusy && mergedImportCandidates.length === 0 ? (
                (() => {
                  const status: ScanStatus = dayScanStatus ??
                    (eventRaceHint
                      ? { title: "No sessions to import yet", detail: eventRaceHint }
                      : {
                          title: "No sessions found yet",
                          detail:
                            "Check your driver name in Settings, or add a LiveRC/Speedhive URL on the track or event.",
                        });
                  return (
                    <div className="px-3 py-4 text-center">
                      <p className="text-sm font-semibold text-foreground text-balance">
                        {status.title}
                      </p>
                      {status.detail ? (
                        <p className="mt-1 text-xs text-muted-foreground">{status.detail}</p>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}
              {!dayScanBusy && olderPickerRows.length > 0 ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-runna-inset transition"
                    onClick={() => setShowOlderSessions((prev) => !prev)}
                  >
                    {showOlderSessions
                      ? "Hide older sessions"
                      : `Show older sessions (${dayScanOlderTotal})`}
                  </button>
                  {showOlderSessions ? (
                    <>
                      <ul className="space-y-1">
                        {olderPickerRows.map((row) => (
                          <li key={row.key}>
                            <SessionImportListRow
                              title={row.title}
                              when={row.when}
                              bestLapSeconds={row.bestLapSeconds}
                              timingSource={row.timingSource}
                              isActive={activeImportUrl === row.sessionUrl.trim()}
                              actionLabel="Import"
                              disabled={urlBusy}
                              onClick={() => {
                                if (activeImportUrl === row.sessionUrl.trim()) return;
                                void importFromSessionUrl(row.sessionUrl);
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                      {dayScanOlderTotal > olderPickerRows.length ? (
                        <p className="ui-label-meta">
                          Showing the {olderPickerRows.length} most recent of {dayScanOlderTotal} older sessions.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {eventRaceHint && mergedImportCandidates.length > 0 ? (
                <p className="ui-label-meta">{eventRaceHint}</p>
              ) : null}
            </div>
          ) : hasUrlScan ? (
            <div className="space-y-2 rounded-md border border-border bg-surface-runna p-2">
              <p className="ui-label-meta">
                Or use <span className="text-foreground/90">URL Manual</span> to paste a session URL
                or a MyRCM event URL.
              </p>
            </div>
          ) : trackId?.trim() ? null : (
            <p className="ui-label-meta">
              Pick a track first — sessions are found from that track&apos;s timing site.
            </p>
          )}
        </div>
            ),
          },
          {
            id: "url-manual",
            label: "URL Manual",
            content: (
        <div className="space-y-2 text-sm">
          <p className="ui-label-meta">
            Paste a LiveRC, Speedhive, MyRCM, or other timing/results page URL to import laps.
            A MyRCM event or class URL lists its sessions to pick from.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="url-import-input"
              type="url"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void fetchUrlPreview();
                }
              }}
              className="flex-1 rounded-md border border-border bg-surface-runna-inset px-3 py-2 text-sm outline-none"
              placeholder="Timing / results URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              aria-label="Timing URL"
            />
            <button
              type="button"
              disabled={urlBusy}
              className={cn(
                "rounded-md border border-border bg-surface-runna px-4 py-2 text-xs font-medium hover:bg-surface-runna-inset transition shrink-0 min-w-[88px]",
                urlBusy && "opacity-60 pointer-events-none"
              )}
              onClick={() => void fetchUrlPreview()}
            >
              {urlBusy ? "Importing…" : "Import"}
            </button>
          </div>

          {activeImportBlock ? (
            <div
              key={activeImportBlock.blockId}
              className="space-y-2 rounded-lg border border-primary-ink/35 bg-accent/5 p-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Eyebrow>
                    Imported · {formatImportedSessionTime(blockLabelTimeIso(activeImportBlock), blockTimeFormatOpts(activeImportBlock))}
                  </Eyebrow>
                  <div className="text-[11px] text-muted-foreground break-all">{activeImportBlock.sourceUrl}</div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary-ink/40 bg-accent/10 px-2 py-1 text-[10px] font-medium text-foreground">
                  <span aria-hidden>✓</span>
                  Active
                </span>
              </div>

              {activeImportBlock.sessionDrivers.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {activeImportBlock.sessionDrivers.map((d) => {
                      const key = `${activeImportBlock.blockId}:${d.driverId}`;
                      const isPreview = activePreviewKey === key;
                      const isPrimaryForRun = activeImportBlock.selectedDriverIds?.[0] === d.driverId;
                      const stats = statsForDriver(activeImportBlock, d);
                      const primaryLabel = formatDriverSessionLabel(
                        d.driverName,
                        blockLabelTimeIso(activeImportBlock),
                        blockTimeFormatOpts(activeImportBlock)
                      );
                      return (
                        <div
                          key={d.driverId}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            selectPrimaryDriverForBlock(activeImportBlock.blockId, d.driverId, 0);
                            setActivePreviewKey(key);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectPrimaryDriverForBlock(activeImportBlock.blockId, d.driverId, 0);
                              setActivePreviewKey(key);
                            }
                          }}
                          className={cn(
                            "flex items-start gap-3 rounded-md border p-2 cursor-pointer transition bg-surface-runna",
                            isPreview
                              ? "border-primary-ink/70 bg-accent/10"
                              : cn(
                                  "border-border hover:bg-surface-runna-inset",
                                  isPrimaryForRun && "border-primary-ink/40 bg-primary/5"
                                )
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-xs font-medium truncate">{primaryLabel}</span>
                              {isPrimaryForRun ? (
                                <span className="shrink-0 rounded border border-primary-ink/35 bg-primary/10 px-1.5 py-0 ui-title text-[10px] text-foreground/90">
                                  Your laps
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-1">
                              <span className="font-medium text-muted-foreground">Best:</span>{" "}
                              {stats.bestLap != null ? `${stats.bestLap.toFixed(3)}s` : "—"} •{" "}
                              <span className="font-medium text-muted-foreground">Avg Top 10:</span>{" "}
                              {stats.avgTop10 != null ? `${stats.avgTop10.toFixed(3)}s` : "—"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1 rounded-md border border-border bg-surface-runna-inset p-2">
                    <Eyebrow>Lap preview</Eyebrow>
                    <p className="text-[10px] leading-snug text-muted-foreground mb-1">
                      Fast laps well below the session median start excluded; slow laps only when far above
                      median. Use Include to restore a lap.
                    </p>
                    {(() => {
                      const keys = activePreviewKey?.split(":");
                      const bId = keys?.[0];
                      const dId = keys?.[1];
                      const blk = bId === activeImportBlock.blockId ? activeImportBlock : null;
                      const active = blk && dId ? blk.sessionDrivers.find((x) => x.driverId === dId) ?? null : null;
                      if (!blk || !active) return <div className="text-[11px] text-muted-foreground">—</div>;
                      const rows =
                        blk.driverLapRowsByDriverId?.[active.driverId] ??
                        applyMedianBandAutoExclude(
                          active.laps.map((t, i) => ({
                            lapNumber: i + 1,
                            lapTimeSeconds: t,
                            isIncluded: true,
                          }))
                        );
                      return (
                        <ul className="font-mono text-xs max-h-48 overflow-y-auto rounded-md border border-border bg-surface-runna p-2 space-y-1">
                          {rows.map((row, i) => (
                            <li
                              key={`${active.driverId}-${row.lapNumber}-${i}`}
                              className={cn(
                                "flex flex-wrap items-center gap-2 rounded px-1 py-0.5",
                                row.isIncluded ? "opacity-100" : "opacity-50 line-through"
                              )}
                            >
                              <span className="text-muted-foreground w-8 shrink-0">{row.lapNumber}.</span>
                              <span className="min-w-[4.5rem]">{row.lapTimeSeconds.toFixed(3)}s</span>
                              {!row.isIncluded ? (
                                <span className="ui-title text-[10px] text-muted-foreground">Excluded</span>
                              ) : null}
                              <button
                                type="button"
                                className={cn(
                                  "ml-auto shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition",
                                  row.isIncluded
                                    ? "border-border bg-surface-runna-inset hover:bg-surface-runna"
                                    : "border-border bg-surface-runna hover:bg-surface-runna-inset"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleLapInclusion(blk.blockId, active.driverId, i);
                                }}
                              >
                                {row.isIncluded ? "Included" : "Excluded"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {urlMessage ? (
            <p
              className={cn(
                "text-[11px]",
                (urlMessage.toLowerCase().includes("not found") ||
                  urlMessage.toLowerCase().includes("unsupported") ||
                  urlMessage.toLowerCase().includes("could not")) &&
                  "text-muted-foreground"
              )}
            >
              {urlMessage}
            </p>
          ) : null}
        </div>
            ),
          },
          {
            id: "manual",
            label: "Manual",
            content: (
        <p className="ui-label-meta">
          Paste or type laps — separated by <span className="text-foreground/80">new lines</span>,{" "}
          <span className="text-foreground/80">commas</span>, or <span className="text-foreground/80">spaces</span>.
        </p>
            ),
          },
          {
            id: "photo",
            label: "Photo",
            content: (
        <div className="space-y-2 text-sm">
          <p className="ui-label-meta">
            Upload a screenshot or photo of a lap list / timing app. The server uses{" "}
            <span className="text-foreground/90">OpenAI vision</span> (JSON output) to fill laps below — always review
            and edit before saving. Requires <code className="text-foreground/80">OPENAI_API_KEY</code> in{" "}
            <code className="text-foreground/80">.env</code>.
          </p>
          <input
            type="file"
            accept="image/*"
            disabled={photoBusy}
            className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-runna file:px-2 file:py-1"
            onChange={(e) => onPhotoSelected(e.target.files?.[0] ?? null)}
          />
          {photoBusy ? <p className="ui-label-meta">Processing…</p> : null}
          {photoConfidence ? (
            <p className="ui-label-meta">
              Model confidence: <span className="font-mono text-foreground/90">{photoConfidence}</span>
            </p>
          ) : null}
          {photoNote ? <p className="text-[11px] text-muted-foreground">{photoNote}</p> : null}
        </div>
            ),
          },
        ]}
      />

      {!isUrlTab(tab) ? (
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground" htmlFor="lap-times-edit">
            Laps (edit before save)
          </label>
          <textarea
            id="lap-times-edit"
            className="h-32 w-full resize-none rounded-md border border-border bg-surface-runna-inset px-3 py-2 text-sm outline-none font-mono"
            placeholder={"12.341 12.298 12.410\nor comma / line separated"}
            value={value.manualText}
            onChange={(e) => {
              const text = e.target.value;
              const manualLapRows = syncManualLapRowsFromText(text, value.manualLapRows);
              onChange({
                ...value,
                manualText: text,
                manualLapRows: manualLapRows.length ? manualLapRows : null,
                sourceKind: tab === "manual" ? "manual" : value.sourceKind,
                sourceDetail: tab === "manual" ? null : value.sourceDetail,
                parserId: tab === "manual" ? null : value.parserId,
                urlLapRows: value.urlLapRows,
              });
            }}
            aria-label="Lap times"
          />
          {value.manualLapRows && value.manualLapRows.length > 0 ? (
            <div className="space-y-1 rounded-md border border-border bg-surface-runna-inset p-2">
              <Eyebrow>Lap include / exclude</Eyebrow>
              <p className="text-[10px] leading-snug text-muted-foreground mb-1">
                Fast laps well below the session median start excluded; slow laps only when far above median.
              </p>
              <ul className="font-mono text-xs max-h-48 overflow-y-auto rounded-md border border-border bg-surface-runna p-2 space-y-1">
                {value.manualLapRows.map((row, i) => (
                  <li
                    key={`manual-${row.lapNumber}-${i}`}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded px-1 py-0.5",
                      row.isIncluded ? "opacity-100" : "opacity-50 line-through"
                    )}
                  >
                    <span className="text-muted-foreground w-8 shrink-0">{row.lapNumber}.</span>
                    <span className="min-w-[4.5rem]">{row.lapTimeSeconds.toFixed(3)}s</span>
                    {!row.isIncluded ? (
                      <span className="ui-title text-[10px] text-muted-foreground">Excluded</span>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        "ml-auto shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition",
                        row.isIncluded
                          ? "border-border bg-surface-runna-inset hover:bg-surface-runna"
                          : "border-border bg-surface-runna hover:bg-surface-runna-inset"
                      )}
                      onClick={() => {
                        const next = value.manualLapRows!.map((r, idx) =>
                          idx === i ? { ...r, isIncluded: !r.isIncluded } : r
                        );
                        onChange({ ...value, manualLapRows: next });
                      }}
                    >
                      {row.isIncluded ? "Included" : "Excluded"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </SurfaceCard>
  );
}

export function defaultLapIngestValue(): LapIngestFormValue {
  return { ...DEFAULT_VALUE };
}
