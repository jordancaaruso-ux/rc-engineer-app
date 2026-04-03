"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { parseManualLapText } from "@/lib/lapSession/parseManual";
import type { LapSourceKind } from "@/lib/lapSession/types";
import type { LapImportLapRow, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { computeLapMetrics, formatLap } from "@/lib/runLaps";
import type { LapRow } from "@/lib/lapAnalysis";
import { getAverageTopN, getBestLap } from "@/lib/lapAnalysis";

export type LapIngestFormValue = {
  manualText: string;
  sourceKind: LapSourceKind;
  sourceDetail: string | null;
  parserId: string | null;
  /** Structured laps + warnings from URL import (e.g. LiveRC). */
  urlLapRows?: LapImportLapRow[] | null;
  /** Optional race-result session data for primary + competitor selection. */
  sessionDrivers?: LapUrlSessionDriver[] | null;
  selectedDriverIds?: string[] | null;
  /** URL import: per-driver lap rows (inclusion); keyed by driverId. */
  driverLapRowsByDriverId?: Record<string, LapRow[]> | null;
};

type IngestTab = "manual" | "photo" | "url" | "csv";

const DEFAULT_VALUE: LapIngestFormValue = {
  manualText: "",
  sourceKind: "manual",
  sourceDetail: null,
  parserId: null,
  urlLapRows: null,
  sessionDrivers: null,
  selectedDriverIds: null,
  driverLapRowsByDriverId: null,
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

export function LapTimesIngestPanel({
  value,
  onChange,
}: {
  value: LapIngestFormValue;
  onChange: (next: LapIngestFormValue) => void;
}) {
  const [tab, setTab] = useState<IngestTab>("manual");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [photoConfidence, setPhotoConfidence] = useState<string | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [activePreviewDriverId, setActivePreviewDriverId] = useState<string | null>(null);

  const parsedLaps = useMemo(() => parseManualLapText(value.manualText), [value.manualText]);
  const metrics = useMemo(() => computeLapMetrics(parsedLaps), [parsedLaps]);

  const urlPrimaryPreviewMetrics = useMemo(() => {
    if (value.sourceKind !== "url" || !value.sessionDrivers?.length) return null;
    const ids = value.selectedDriverIds ?? [];
    const primaryId = ids[0] ?? value.sessionDrivers[0]?.driverId ?? null;
    if (!primaryId) return null;
    const rows = value.driverLapRowsByDriverId?.[primaryId];
    if (!rows?.length) return null;
    const included = rows.filter((r) => r.isIncluded && r.lapNumber !== 0);
    return {
      lapCount: included.length,
      bestLap: getBestLap(rows),
      averageTop5: getAverageTopN(rows, 5),
    };
  }, [value.sourceKind, value.sessionDrivers, value.selectedDriverIds, value.driverLapRowsByDriverId]);

  function selectTab(id: IngestTab) {
    setTab(id);
    if (id === "manual") {
      onChange({
        ...value,
        sourceKind: "manual",
        sourceDetail: null,
        parserId: null,
        urlLapRows: null,
        sessionDrivers: null,
        selectedDriverIds: null,
        driverLapRowsByDriverId: null,
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
        driverLapRowsByDriverId: null,
      });
      setPhotoNote(note);
      setPhotoConfidence(conf);
    } catch {
      setPhotoNote("Upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function fetchUrlPreview() {
    const url = urlInput.trim();
    if (!url) {
      setUrlMessage("Paste a timing/results URL first.");
      return;
    }
    setUrlBusy(true);
    setUrlMessage(null);
    try {
      const res = await fetch("/api/laps/parse-url-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlMessage((data as { error?: string })?.error || "Request failed.");
        return;
      }
      const parserId = (data as { parserId?: string })?.parserId ?? "http_timing_v1";
      const message = (data as { message?: string | null })?.message ?? null;
      const sessionDriversRaw = (data as { sessionDrivers?: LapUrlSessionDriver[] }).sessionDrivers ?? [];
      const sessionDrivers = Array.isArray(sessionDriversRaw)
        ? sessionDriversRaw.filter((d) => d && typeof d.driverId === "string" && Array.isArray(d.laps))
        : [];
      const topLaps = (data as { laps?: number[] })?.laps ?? [];
      const lapRowsFromApi = (data as { lapRows?: LapImportLapRow[] | null }).lapRows;

      const textFromLaps = topLaps.length > 0 ? topLaps.map((n) => n.toFixed(3)).join("\n") : value.manualText;

      const autoSelectIds =
        sessionDrivers.length === 1 && sessionDrivers[0]?.driverId
          ? [sessionDrivers[0].driverId]
          : [];

      onChange({
        ...value,
        manualText: textFromLaps,
        sourceKind: "url",
        sourceDetail: url,
        parserId,
        urlLapRows:
          Array.isArray(lapRowsFromApi) && lapRowsFromApi.length > 0 && lapRowsFromApi.length === topLaps.length
            ? lapRowsFromApi
            : null,
        sessionDrivers: sessionDrivers.length > 0 ? sessionDrivers : null,
        selectedDriverIds: autoSelectIds,
        driverLapRowsByDriverId: sessionDrivers.length > 0 ? initDriverLapRows(sessionDrivers) : null,
      });
      setActivePreviewDriverId(sessionDrivers[0]?.driverId ?? null);
      setUrlMessage(message);
    } catch {
      setUrlMessage("Request failed.");
    } finally {
      setUrlBusy(false);
    }
  }

  function toggleDriverSelection(driverId: string) {
    const drivers = value.sessionDrivers ?? [];
    if (drivers.length === 0) return;
    const current = new Set(value.selectedDriverIds ?? []);
    if (current.has(driverId)) current.delete(driverId);
    else current.add(driverId);

    const selectedOrderedIds = drivers.map((d) => d.driverId).filter((id) => current.has(id));

    onChange({
      ...value,
      selectedDriverIds: selectedOrderedIds,
      urlLapRows: null,
    });
  }

  function statsForDriver(d: LapUrlSessionDriver): { bestLap: number | null; avgTop10: number | null } {
    const rows =
      value.driverLapRowsByDriverId?.[d.driverId] ??
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

  function toggleLapInclusion(driverId: string, lapIndex: number) {
    const prev = value.driverLapRowsByDriverId?.[driverId];
    if (!prev?.[lapIndex]) return;
    const nextRows = [...prev];
    nextRows[lapIndex] = { ...nextRows[lapIndex], isIncluded: !nextRows[lapIndex].isIncluded };
    onChange({
      ...value,
      driverLapRowsByDriverId: {
        ...(value.driverLapRowsByDriverId ?? {}),
        [driverId]: nextRows,
      },
      urlLapRows: null,
    });
  }

  function lapTextFromRows(driverId: string, fallbackLaps: number[]): string {
    const rows = value.driverLapRowsByDriverId?.[driverId];
    if (rows && rows.length > 0) {
      return rows.map((r) => r.lapTimeSeconds.toFixed(3)).join("\n");
    }
    return fallbackLaps.map((n) => n.toFixed(3)).join("\n");
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
      <div className="ui-title text-sm text-muted-foreground">Lap times</div>
      <div
        className="flex flex-wrap border-b border-border gap-x-0.5"
        role="tablist"
        aria-label="Lap time entry method"
      >
        {(
          [
            ["manual", "Manual"],
            ["photo", "Photo"],
            ["url", "URL"],
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
            className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-2 file:py-1"
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
          <p className="text-[11px] text-muted-foreground">
            Paste an <span className="text-foreground/90">https</span> link and import. Then select one or more drivers.
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
              className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
              placeholder="Upload URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              aria-label="Upload URL"
            />
            <button
              type="button"
              disabled={urlBusy}
              className={cn(
                "rounded-md border border-border bg-card px-4 py-2 text-xs font-medium hover:bg-muted/90 transition shrink-0 min-w-[88px]",
                urlBusy && "opacity-60 pointer-events-none"
              )}
              onClick={() => void fetchUrlPreview()}
            >
              {urlBusy ? "Importing…" : "Import"}
            </button>
          </div>
          {value.sessionDrivers && value.sessionDrivers.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/70 p-2">
              <div className="ui-title text-sm text-muted-foreground">Imported drivers</div>

              <div className="space-y-2">
                {value.sessionDrivers.map((d) => {
                  const selected = Boolean(value.selectedDriverIds?.includes(d.driverId));
                  const activeId = activePreviewDriverId ?? value.sessionDrivers?.[0]?.driverId ?? null;
                  const isPreview = activeId === d.driverId;
                  const stats = statsForDriver(d);
                  return (
                    <div
                      key={d.driverId}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setActivePreviewDriverId(d.driverId);
                        onChange({
                          ...value,
                          manualText: lapTextFromRows(d.driverId, d.laps),
                          urlLapRows: null,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setActivePreviewDriverId(d.driverId);
                          onChange({
                            ...value,
                            manualText: lapTextFromRows(d.driverId, d.laps),
                            urlLapRows: null,
                          });
                        }
                      }}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-md border bg-muted/80 p-2 cursor-pointer transition",
                        isPreview ? "border-accent/70 bg-accent/10" : "border-border hover:bg-muted/70"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{d.driverName}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          <span className="font-medium text-muted-foreground">Best:</span> {stats.bestLap != null ? `${stats.bestLap.toFixed(3)}s` : "—"}{" "}
                          • <span className="font-medium text-muted-foreground">Avg Top 10:</span>{" "}
                          {stats.avgTop10 != null ? `${stats.avgTop10.toFixed(3)}s` : "—"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={cn(
                          "shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium border transition",
                          selected
                            ? "border-accent bg-accent/20 text-foreground"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDriverSelection(d.driverId);
                        }}
                      >
                        {selected ? "Selected" : "Select"}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1 rounded-md border border-border bg-muted/60 p-2">
                <div className="ui-title text-sm text-muted-foreground">Lap preview</div>
                {(() => {
                  const activeId = activePreviewDriverId ?? value.sessionDrivers?.[0]?.driverId ?? null;
                  const active = activeId ? value.sessionDrivers.find((x) => x.driverId === activeId) ?? null : null;
                  if (!active) return <div className="text-[11px] text-muted-foreground">—</div>;
                  const rows =
                    value.driverLapRowsByDriverId?.[active.driverId] ??
                    active.laps.map((t, i) => ({
                      lapNumber: i + 1,
                      lapTimeSeconds: t,
                      isIncluded: true,
                    }));
                  return (
                    <ul className="font-mono text-xs max-h-48 overflow-y-auto rounded-md border border-border bg-muted/80 p-2 space-y-1">
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
                                ? "border-border bg-card hover:bg-muted"
                                : "border-border bg-muted/70 hover:bg-muted/70"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLapInclusion(active.driverId, i);
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
            </div>
          ) : null}
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
          className="h-32 w-full resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none font-mono"
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

      <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-[11px] space-y-1">
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
              · <span className="truncate inline-block max-w-[220px] align-bottom">{value.sourceDetail}</span>
            </>
          ) : null}
        </span>
        {value.selectedDriverIds && value.selectedDriverIds.length > 0 && value.sessionDrivers ? (
          <span className="text-muted-foreground">
            Selected drivers:{" "}
            <span className="text-foreground/90">
              {value.sessionDrivers
                .filter((d) => value.selectedDriverIds?.includes(d.driverId))
                .map((d) => d.driverName)
                .join(", ")}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function defaultLapIngestValue(): LapIngestFormValue {
  return { ...DEFAULT_VALUE };
}
