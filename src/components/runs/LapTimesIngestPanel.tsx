"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { parseManualLapText } from "@/lib/lapSession/parseManual";
import type { LapSourceKind } from "@/lib/lapSession/types";
import type { LapImportLapRow, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { computeLapMetrics, formatLap } from "@/lib/runLaps";
import type { LapRow } from "@/lib/lapAnalysis";
import { getAverageTopN, getBestLap } from "@/lib/lapAnalysis";
import { formatDriverSessionLabel, resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

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
  sourceKind: LapSourceKind;
  sourceDetail: string | null;
  parserId: string | null;
  /** Structured laps + warnings from URL import (e.g. LiveRC) — legacy single-primary; first URL block overrides. */
  urlLapRows?: LapImportLapRow[] | null;
  /** Multiple URL imports: one block per Import click; each maps to a persisted ImportedLapTimeSession. */
  urlImportBlocks: UrlImportBlock[];
};

type IngestTab = "manual" | "photo" | "url" | "csv";

const DEFAULT_VALUE: LapIngestFormValue = {
  manualText: "",
  sourceKind: "manual",
  sourceDetail: null,
  parserId: null,
  urlLapRows: null,
  urlImportBlocks: [],
};

function initDriverLapRows(drivers: LapUrlSessionDriver[]): Record<string, LapRow[]> {
  const out: Record<string, LapRow[]> = {};
  for (const d of drivers) {
    out[d.driverId] = d.laps.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: true,
    }));
  }
  return out;
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
};

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
}: {
  value: LapIngestFormValue;
  onChange: (next: LapIngestFormValue) => void;
  /**
   * LiveRC index URL for "scan" (practice `session_list` day page, or any `/results/` page that lists sessions).
   * Enables the scan picker above the manual URL field.
   */
  practiceDayUrl?: string | null;
  /** When set, LiveRC event hub imports filter by this event's race class list. */
  lapImportEventId?: string | null;
}) {
  const [tab, setTab] = useState<IngestTab>(() => ((practiceDayUrl ?? "").trim() ? "url" : "manual"));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [photoConfidence, setPhotoConfidence] = useState<string | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [dayScanBusy, setDayScanBusy] = useState(false);
  const [dayScanMessage, setDayScanMessage] = useState<string | null>(null);
  const [dayScanCandidates, setDayScanCandidates] = useState<ScanDayCandidate[] | null>(null);
  const [dayScanIndexKind, setDayScanIndexKind] = useState<"practice" | "results" | null>(null);
  const [dayScanHasDriverName, setDayScanHasDriverName] = useState<boolean>(true);
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
    if (!(practiceDayUrl ?? "").trim()) return;
    setTab((prev) => (prev === "manual" ? "url" : prev));
  }, [practiceDayUrl]);

  const parsedLaps = useMemo(() => parseManualLapText(value.manualText), [value.manualText]);
  const metrics = useMemo(() => computeLapMetrics(parsedLaps), [parsedLaps]);

  const urlPrimaryPreviewMetrics = useMemo(() => {
    if (value.sourceKind !== "url") return null;
    const blocks = value.urlImportBlocks ?? [];
    const first = blocks[0];
    if (!first?.sessionDrivers?.length) return null;
    const ids = first.selectedDriverIds ?? [];
    const primaryId = ids[0] ?? first.sessionDrivers[0]?.driverId ?? null;
    if (!primaryId) return null;
    const rows = first.driverLapRowsByDriverId?.[primaryId];
    if (!rows?.length) return null;
    const included = rows.filter((r) => r.isIncluded && r.lapNumber !== 0);
    return {
      lapCount: included.length,
      bestLap: getBestLap(rows),
      averageTop5: getAverageTopN(rows, 5),
    };
  }, [value.sourceKind, value.urlImportBlocks]);

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
      onChange({
        ...value,
        manualText: textFromLaps,
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

  async function scanDayUrl() {
    const url = (practiceDayUrl ?? "").trim();
    if (!url) {
      setDayScanMessage("Add a LiveRC timing index URL under Session type or Event first.");
      return;
    }
    setDayScanBusy(true);
    setDayScanMessage(null);
    setDayScanIndexKind(null);
    try {
      const res = await fetch("/api/laps/scan-day-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayUrl: url,
          eventId: lapImportEventId?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDayScanMessage((data as { error?: string })?.error || "Scan failed.");
        setDayScanCandidates(null);
        return;
      }
      const candidates = Array.isArray((data as { candidates?: unknown }).candidates)
        ? ((data as { candidates: ScanDayCandidate[] }).candidates)
        : [];
      const hasDriver = Boolean((data as { hasDriverNameSetting?: boolean }).hasDriverNameSetting);
      const ik = (data as { indexKind?: string }).indexKind;
      setDayScanIndexKind(ik === "results" || ik === "practice" ? ik : null);
      setDayScanHasDriverName(hasDriver);
      setDayScanCandidates(candidates);
      if (candidates.length === 0) {
        setDayScanMessage("No sessions found on that day page.");
      }
    } catch {
      setDayScanMessage("Scan failed.");
    } finally {
      setDayScanBusy(false);
    }
  }

  async function importFromDayCandidate(c: ScanDayCandidate) {
    setUrlInput(c.sessionUrl);
    setDayScanMessage(null);
    await fetchUrlPreviewWithUrl(c.sessionUrl);
  }

  async function importFromEventRaceRow(c: EventRaceSessionRow) {
    setUrlInput(c.sessionUrl);
    setUrlMessage(null);
    await fetchUrlPreviewWithUrl(c.sessionUrl);
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

      let nextBlocks = [...value.urlImportBlocks];
      let combinedMessage: string | null = null;

      for (const row of successes) {
        const parserId = row.parserId ?? "http_timing_v1";
        const message = row.message ?? null;
        if (combinedMessage == null && message) combinedMessage = message;

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
              : [pickPrimarySessionDriver(sessionDrivers, { liveRcDriverId, liveRcDriverName }).driverId];

        const recordedAt = row.recordedAt ?? new Date().toISOString();
        const sessionCompletedAtIso =
          typeof row.sessionCompletedAtIso === "string" && row.sessionCompletedAtIso.trim()
            ? row.sessionCompletedAtIso.trim()
            : null;
        const sessionCompletedAtDbIso =
          typeof row.sessionCompletedAtDbIso === "string" && row.sessionCompletedAtDbIso.trim()
            ? row.sessionCompletedAtDbIso.trim()
            : null;

        const sourceUrl =
          typeof row.url === "string" && row.url.trim() ? row.url.trim() : url;

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

        nextBlocks = [...nextBlocks, newBlock];
      }

      const detail =
        nextBlocks.length === 1
          ? nextBlocks[0]!.sourceUrl
          : `${nextBlocks.length} timing URLs`;

      onChange({
        ...value,
        manualText: primaryLapTextFromFirstBlock(nextBlocks),
        sourceKind: "url",
        sourceDetail: detail,
        parserId: nextBlocks[0]?.parserId ?? successes[0]!.parserId ?? "liverc_deterministic_v1",
        urlLapRows: nextBlocks[0]?.urlLapRows ?? null,
        urlImportBlocks: nextBlocks,
      });
      const lastBlock = nextBlocks[nextBlocks.length - 1];
      const pid = lastBlock?.selectedDriverIds?.[0];
      if (lastBlock && pid) {
        setActivePreviewKey(`${lastBlock.blockId}:${pid}`);
      }
      setUrlInput("");
      if (successes.length > 1) {
        setUrlMessage(`Imported ${successes.length} race sessions from the event page.${combinedMessage ? ` ${combinedMessage}` : ""}`);
      } else {
        setUrlMessage(combinedMessage);
      }
      setDayScanCandidates((prev) =>
        prev ? prev.map((c) => (c.sessionUrl === url ? { ...c, alreadyImported: true } : c)) : prev
      );
      void loadEventRaceSessions();
    } catch {
      setUrlMessage("Request failed.");
    } finally {
      setUrlBusy(false);
    }
  }

  function removeBlock(blockId: string) {
    const next = value.urlImportBlocks.filter((b) => b.blockId !== blockId);
    if (next.length === 0) {
      onChange({
        ...value,
        urlImportBlocks: [],
        sourceKind: "manual",
        sourceDetail: null,
        parserId: null,
        urlLapRows: null,
        manualText: value.manualText,
      });
      setActivePreviewKey(null);
      return;
    }
    onChange({
      ...value,
      urlImportBlocks: next,
      sourceKind: "url",
      manualText: primaryLapTextFromFirstBlock(next),
      sourceDetail: next.length === 1 ? next[0]!.sourceUrl : `${next.length} timing URLs`,
      parserId: next[0]?.parserId ?? null,
      urlLapRows: next[0]?.urlLapRows ?? null,
    });
    setActivePreviewKey(null);
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

  const primaryDriverLabels = useMemo(() => {
    const blocks = value.urlImportBlocks ?? [];
    const parts: string[] = [];
    for (const b of blocks) {
      const id = b.selectedDriverIds?.[0];
      if (!id) continue;
      const d = b.sessionDrivers.find((x) => x.driverId === id);
      if (d) parts.push(formatDriverSessionLabel(d.driverName, blockLabelTimeIso(b)));
    }
    return parts;
  }, [value.urlImportBlocks]);

  return (
    <div className="rounded-lg border border-border bg-surface-runna-deep p-4 space-y-3">
      <div className="ui-title text-sm text-muted-foreground">Lap times</div>
      <div
        className="flex flex-wrap border-b border-border gap-x-0.5"
        role="tablist"
        aria-label="Lap time entry method"
      >
        {(
          [
            ["url", "URL"],
            ["manual", "Manual"],
            ["photo", "Photo"],
            ["csv", "CSV"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            disabled={id === "csv"}
            className={cn(
              "px-3 sm:px-4 py-2 text-xs font-medium transition border-b-2 -mb-px",
              tab === id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
              id === "csv" && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => selectTab(id)}
          >
            {label}
            {id === "csv" ? " (soon)" : ""}
          </button>
        ))}
      </div>

      {tab === "manual" ? (
        <p className="text-[11px] text-muted-foreground">
          Paste or type laps — separated by <span className="text-foreground/80">new lines</span>,{" "}
          <span className="text-foreground/80">commas</span>, or <span className="text-foreground/80">spaces</span>.
        </p>
      ) : null}

      {tab === "photo" ? (
        <div className="space-y-2 text-sm">
          <p className="text-[11px] text-muted-foreground">
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
          {photoBusy ? <p className="text-[11px] text-muted-foreground">Processing…</p> : null}
          {photoConfidence ? (
            <p className="text-[11px] text-muted-foreground">
              Model confidence: <span className="font-mono text-foreground/90">{photoConfidence}</span>
            </p>
          ) : null}
          {photoNote ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{photoNote}</p> : null}
        </div>
      ) : null}

      {tab === "url" ? (
        <div className="space-y-2 text-sm">
          {lapImportEventId?.trim() ? (
            <div className="space-y-2 rounded-md border border-accent/35 bg-accent/5 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="ui-title text-[11px] uppercase tracking-wide text-muted-foreground">
                    Your sessions at this event
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                    Uses your LiveRC <span className="text-foreground/90">driver ID</span> from each result table (not
                    just name), so you are not mixed up with someone else on another main. IDs are saved automatically in
                    Settings when unambiguous; clear there if wrong.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={eventRaceBusy}
                  className={cn(
                    "shrink-0 rounded-md border border-border bg-surface-runna px-3 py-1.5 text-[11px] font-medium hover:bg-surface-runna-inset transition",
                    eventRaceBusy && "opacity-60 pointer-events-none"
                  )}
                  onClick={() => void loadEventRaceSessions()}
                >
                  {eventRaceBusy ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              {eventRaceBusy ? <p className="text-[11px] text-muted-foreground">Loading sessions…</p> : null}
              {eventRaceSessions && eventRaceSessions.length > 0 ? (
                <ul className="space-y-1">
                  {eventRaceSessions.map((c) => {
                    const added = value.urlImportBlocks.some(
                      (b) => b.sourceUrl.trim() === c.sessionUrl.trim()
                    );
                    const title =
                      c.listLinkText?.trim() || "Race session";
                    return (
                      <li key={c.sessionUrl}>
                        <button
                          type="button"
                          disabled={urlBusy || added}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
                            added || urlBusy
                              ? "border-border bg-surface-runna opacity-70 cursor-not-allowed"
                              : "border-border bg-surface-runna hover:bg-surface-runna-inset"
                          )}
                          onClick={() => void importFromEventRaceRow(c)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {title}
                              {c.sessionTime ? ` · ${c.sessionTime}` : ""}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">{c.sessionUrl}</span>
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {added ? "Added" : c.alreadyImported ? "Import again" : "Import"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!eventRaceBusy && eventRaceSessions !== null && eventRaceSessions.length === 0 ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  {eventRaceHint ??
                    "No pending race sessions — add a LiveRC results URL on the event, or every session may already have a run logged."}
                </p>
              ) : null}
              {!eventRaceBusy && eventRaceHint && eventRaceSessions && eventRaceSessions.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">{eventRaceHint}</p>
              ) : null}
            </div>
          ) : null}
          {practiceDayUrl ? (
            <div className="space-y-2 rounded-md border border-border bg-surface-runna p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="ui-title text-[11px] uppercase tracking-wide text-muted-foreground">
                    {dayScanIndexKind === "results" || /\/results\b/i.test(practiceDayUrl)
                      ? "Race / results index URL"
                      : "Practice day URL"}
                  </div>
                  <div className="text-[11px] text-muted-foreground break-all">{practiceDayUrl}</div>
                </div>
                <button
                  type="button"
                  disabled={dayScanBusy}
                  className={cn(
                    "shrink-0 rounded-md border border-border bg-surface-runna px-3 py-1.5 text-[11px] font-medium hover:bg-surface-runna-inset transition",
                    dayScanBusy && "opacity-60 pointer-events-none"
                  )}
                  onClick={() => void scanDayUrl()}
                >
                  {dayScanBusy
                    ? "Scanning…"
                    : dayScanCandidates
                      ? "Rescan"
                      : dayScanIndexKind === "results" || /\/results\b/i.test(practiceDayUrl)
                        ? "Scan for sessions"
                        : "Scan for my sessions"}
                </button>
              </div>
              {!dayScanHasDriverName &&
              (dayScanIndexKind !== "results" && !/\/results\b/i.test(practiceDayUrl)) ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  No LiveRC driver name set — Settings → LiveRC driver name helps filter practice list scans to
                  only your sessions.
                </p>
              ) : null}
              {dayScanIndexKind === "results" || /\/results\b/i.test(practiceDayUrl) ? (
                <p className="text-[11px] text-muted-foreground">
                  Results pages list races by class or round — pick your session, then confirm your row on the
                  timing page (your LiveRC driver name still applies there).
                </p>
              ) : null}
              {dayScanCandidates && dayScanCandidates.length > 0 ? (
                <ul className="space-y-1">
                  {dayScanCandidates.map((c) => (
                    <li key={c.sessionId}>
                      <button
                        type="button"
                        disabled={urlBusy || c.alreadyImported}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
                            c.alreadyImported
                              ? "border-border bg-surface-runna opacity-60 cursor-not-allowed"
                              : "border-border bg-surface-runna hover:bg-surface-runna-inset"
                          )}
                        onClick={() => void importFromDayCandidate(c)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {c.driverName || "Unnamed driver"}
                            {c.sessionTime ? ` · ${c.sessionTime}` : ""}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {c.sessionUrl}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {c.alreadyImported ? (c.linkedRunId ? "Saved" : "Imported") : "Import"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {dayScanMessage ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{dayScanMessage}</p>
              ) : null}
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Paste an <span className="text-foreground/90">https</span> link and import. LiveRC{" "}
            <span className="text-foreground/90">event results</span> pages (<code className="text-[10px]">p=view_event</code>)
            import every race result session not already saved (optionally filtered by race class when this run is tied to
            an event). Add another URL anytime — each import stays below. Multi-driver sessions default to your LiveRC
            driver (Settings); competitor laps are kept for field comparisons. Click a row to use that driver&apos;s laps
            for this run.
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

          {value.urlImportBlocks.map((block, blockIndex) => (
            <div key={block.blockId} className="space-y-2 rounded-lg border border-border bg-surface-runna p-2" data-import-index={blockIndex}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Import {blockIndex + 1} · {formatRunCreatedAtDateTime(blockLabelTimeIso(block))}
                  </div>
                  <div className="text-[11px] text-muted-foreground break-all">{block.sourceUrl}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-surface-runna-inset"
                  onClick={() => removeBlock(block.blockId)}
                >
                  Remove
                </button>
              </div>

              {block.sessionDrivers.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {block.sessionDrivers.map((d) => {
                      const key = `${block.blockId}:${d.driverId}`;
                      const isPreview = activePreviewKey === key;
                      const isPrimaryForRun = block.selectedDriverIds?.[0] === d.driverId;
                      const stats = statsForDriver(block, d);
                      const primaryLabel = formatDriverSessionLabel(d.driverName, blockLabelTimeIso(block));
                      return (
                        <div
                          key={d.driverId}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            selectPrimaryDriverForBlock(block.blockId, d.driverId, blockIndex);
                            setActivePreviewKey(key);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectPrimaryDriverForBlock(block.blockId, d.driverId, blockIndex);
                              setActivePreviewKey(key);
                            }
                          }}
                          className={cn(
                            "flex items-start gap-3 rounded-md border p-2 cursor-pointer transition bg-surface-runna",
                            isPreview
                              ? "border-accent/70 bg-accent/10"
                              : cn(
                                  "border-border hover:bg-surface-runna-inset",
                                  isPrimaryForRun && "border-primary/40 bg-primary/5"
                                )
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-xs font-medium truncate">{primaryLabel}</span>
                              {isPrimaryForRun ? (
                                <span className="shrink-0 rounded border border-primary/35 bg-primary/10 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-foreground/90">
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
                    <div className="ui-title text-sm text-muted-foreground">Lap preview</div>
                    {(() => {
                      const keys = activePreviewKey?.split(":");
                      const bId = keys?.[0];
                      const dId = keys?.[1];
                      const blk = bId ? value.urlImportBlocks.find((x) => x.blockId === bId) : null;
                      const active = blk && dId ? blk.sessionDrivers.find((x) => x.driverId === dId) ?? null : null;
                      if (!blk || !active) return <div className="text-[11px] text-muted-foreground">—</div>;
                      const rows =
                        blk.driverLapRowsByDriverId?.[active.driverId] ??
                        active.laps.map((t, i) => ({
                          lapNumber: i + 1,
                          lapTimeSeconds: t,
                          isIncluded: true,
                        }));
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
                                <span className="text-[10px] uppercase text-muted-foreground">Excluded</span>
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
          ))}

          {urlMessage ? (
            <p
              className={cn(
                "text-[11px]",
                (urlMessage.toLowerCase().includes("not found") ||
                  urlMessage.toLowerCase().includes("unsupported") ||
                  urlMessage.toLowerCase().includes("could not")) &&
                  "text-amber-600 dark:text-amber-400"
              )}
            >
              {urlMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "csv" ? (
        <p className="text-[11px] text-muted-foreground">CSV import will use the same confirmation step as manual entry.</p>
      ) : null}

      {tab !== "url" ? (
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
              onChange({
                ...value,
                manualText: text,
                sourceKind: tab === "manual" ? "manual" : value.sourceKind,
                sourceDetail: tab === "manual" ? null : value.sourceDetail,
                parserId: tab === "manual" ? null : value.parserId,
                urlLapRows: value.urlLapRows,
              });
            }}
            aria-label="Lap times"
          />
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-surface-runna-inset px-3 py-2 text-[11px] space-y-1">
        <div className="ui-title text-sm text-muted-foreground">Preview</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-foreground">
          <span>
            Count:{" "}
            <span className="font-mono">
              {urlPrimaryPreviewMetrics ? urlPrimaryPreviewMetrics.lapCount : metrics.lapCount}
            </span>
          </span>
          <span>
            Best:{" "}
            <span className="font-mono">
              {formatLap(urlPrimaryPreviewMetrics ? urlPrimaryPreviewMetrics.bestLap : metrics.bestLap)}
            </span>
          </span>
          <span>
            Avg top 5:{" "}
            <span className="font-mono">
              {formatLap(urlPrimaryPreviewMetrics ? urlPrimaryPreviewMetrics.averageTop5 : metrics.averageTop5)}
            </span>
          </span>
        </div>
        <span className="text-muted-foreground">
          Source: <span className="text-foreground/90">{value.sourceKind}</span>
          {value.sourceDetail ? (
            <>
              {" "}
              · <span className="truncate inline-block max-w-[280px] align-bottom">{value.sourceDetail}</span>
            </>
          ) : null}
        </span>
        {primaryDriverLabels.length > 0 ? (
          <span className="text-muted-foreground block">
            Your laps for this run:{" "}
            <span className="text-foreground/90">{primaryDriverLabels.join(" · ")}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function defaultLapIngestValue(): LapIngestFormValue {
  return { ...DEFAULT_VALUE };
}
