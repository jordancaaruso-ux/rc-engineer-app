"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { parseManualLapText } from "@/lib/lapSession/parseManual";
import type { LapSourceKind } from "@/lib/lapSession/types";
import type { LapImportLapRow } from "@/lib/lapUrlParsers/types";
import { computeLapMetrics, formatLap } from "@/lib/runLaps";

export type LapIngestFormValue = {
  manualText: string;
  sourceKind: LapSourceKind;
  sourceDetail: string | null;
  parserId: string | null;
  /** Structured laps + warnings from URL import (e.g. LiveRC). */
  urlLapRows?: LapImportLapRow[] | null;
};

type IngestTab = "manual" | "photo" | "url" | "csv";

type UrlCandidateRow = { id: string; label: string; laps: number[] };

const DEFAULT_VALUE: LapIngestFormValue = {
  manualText: "",
  sourceKind: "manual",
  sourceDetail: null,
  parserId: null,
  urlLapRows: null,
};

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
  const [urlDriverName, setUrlDriverName] = useState("");
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [urlCandidates, setUrlCandidates] = useState<UrlCandidateRow[]>([]);
  const [urlSelectedId, setUrlSelectedId] = useState<string>("");

  const parsedLaps = useMemo(() => parseManualLapText(value.manualText), [value.manualText]);
  const metrics = useMemo(() => computeLapMetrics(parsedLaps), [parsedLaps]);

  function selectTab(id: IngestTab) {
    setTab(id);
    if (id === "manual") {
      onChange({
        ...value,
        sourceKind: "manual",
        sourceDetail: null,
        parserId: null,
        urlLapRows: null,
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
    setUrlCandidates([]);
    setUrlSelectedId("");
    try {
      const res = await fetch("/api/laps/parse-url-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, driverName: urlDriverName.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlMessage((data as { error?: string })?.error || "Request failed.");
        return;
      }
      const parserId = (data as { parserId?: string })?.parserId ?? "http_timing_v1";
      const message = (data as { message?: string | null })?.message ?? null;
      const rawCandidates = (data as { candidates?: UrlCandidateRow[] })?.candidates ?? [];
      const topLaps = (data as { laps?: number[] })?.laps ?? [];
      const lapRowsRaw = (data as { lapRows?: LapImportLapRow[] | null })?.lapRows ?? null;
      const lapRows: LapImportLapRow[] | null =
        Array.isArray(lapRowsRaw) && lapRowsRaw.length > 0
          ? lapRowsRaw.map((r) => ({
              time: r.time,
              isOutlierWarning: r.isOutlierWarning,
              warningReason: r.warningReason ?? null,
              isFlagged: Boolean(r.isFlagged),
              flagReason: r.flagReason ?? null,
            }))
          : null;

      let list: UrlCandidateRow[] = rawCandidates.filter(
        (c) => c && typeof c.id === "string" && Array.isArray(c.laps)
      );
      if (list.length === 0 && topLaps.length > 0) {
        list = [{ id: "default", label: "Imported laps", laps: topLaps }];
      }

      setUrlCandidates(list);
      const firstId = list[0]?.id ?? "";
      setUrlSelectedId(firstId);
      const chosen = list.find((c) => c.id === firstId) ?? list[0];
      const laps = chosen?.laps ?? topLaps;
      const textFromLaps = laps.length ? laps.map((n) => n.toFixed(3)).join("\n") : value.manualText;

      onChange({
        ...value,
        manualText: textFromLaps,
        sourceKind: "url",
        sourceDetail: url,
        parserId,
        urlLapRows: lapRows,
      });
      setUrlMessage(message);
    } catch {
      setUrlMessage("Request failed.");
    } finally {
      setUrlBusy(false);
    }
  }

  function applyUrlCandidate(id: string) {
    setUrlSelectedId(id);
    const row = urlCandidates.find((c) => c.id === id);
    if (!row) return;
    onChange({
      ...value,
      manualText: row.laps.map((n) => n.toFixed(3)).join("\n"),
      sourceKind: "url",
      sourceDetail: urlInput.trim() || value.sourceDetail,
      parserId: value.parserId,
      urlLapRows: null,
    });
  }

  function toggleUrlLapFlag(index: number) {
    const rows = value.urlLapRows;
    if (!rows?.length) return;
    const next = rows.map((r, i) =>
      i === index ? { ...r, isFlagged: !r.isFlagged } : r
    );
    onChange({
      ...value,
      urlLapRows: next,
      manualText: next.map((r) => r.time.toFixed(3)).join("\n"),
    });
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4 space-y-3">
      <div className="text-xs font-mono text-muted-foreground">Lap times</div>
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
            className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-secondary/40 file:px-2 file:py-1"
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
            Paste an <span className="text-foreground/90">https</span> link.{" "}
            <span className="text-foreground/90">LiveRC race results</span> (
            <code className="text-foreground/80">…/results/?p=view_race_result&id=…</code>) need your{" "}
            <span className="text-foreground/90">driver name</span> as on the sheet. Other URLs use JSON/heuristics as
            before.
          </p>
          <div className="flex flex-col gap-2 max-w-lg">
            <label className="text-[11px] font-mono text-muted-foreground" htmlFor="url-driver-name">
              Driver name (LiveRC race result)
            </label>
            <input
              id="url-driver-name"
              type="text"
              className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
              placeholder="e.g. Jordan Caruso"
              value={urlDriverName}
              onChange={(e) => setUrlDriverName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              className="flex-1 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
              placeholder="https://…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              aria-label="Timing page URL"
            />
            <button
              type="button"
              disabled={urlBusy}
              className={cn(
                "rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs font-medium hover:bg-secondary/50 transition shrink-0",
                urlBusy && "opacity-60 pointer-events-none"
              )}
              onClick={() => void fetchUrlPreview()}
            >
              {urlBusy ? "Fetching…" : "Fetch preview"}
            </button>
          </div>
          {urlCandidates.length > 1 ? (
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-muted-foreground" htmlFor="url-candidate">
                Driver / lap list
              </label>
              <select
                id="url-candidate"
                className="w-full max-w-md rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none"
                value={urlSelectedId}
                onChange={(e) => applyUrlCandidate(e.target.value)}
              >
                {urlCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.laps.length} laps)
                  </option>
                ))}
              </select>
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
          {value.urlLapRows && value.urlLapRows.length > 0 ? (
            <div className="rounded-md border border-border/80 bg-secondary/20 overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground font-mono">
                    <th className="py-1.5 px-2">#</th>
                    <th className="py-1.5 px-2">Time</th>
                    <th className="py-1.5 px-2">Note</th>
                    <th className="py-1.5 px-2">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {value.urlLapRows.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-border/50",
                        row.isFlagged && "bg-amber-950/30 dark:bg-amber-950/40"
                      )}
                    >
                      <td className="py-1 px-2 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="py-1 px-2 font-mono tabular-nums">{formatLap(row.time)}</td>
                      <td className="py-1 px-2">
                        {row.isOutlierWarning ? (
                          <span className="text-amber-600 dark:text-amber-400" title={row.warningReason ?? ""}>
                            Median outlier
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1 px-2">
                        <button
                          type="button"
                          className={cn(
                            "rounded border px-2 py-0.5 text-[10px] font-medium transition",
                            row.isFlagged
                              ? "border-amber-500 bg-amber-500/20 text-amber-800 dark:text-amber-200"
                              : "border-border bg-secondary/30 hover:bg-secondary/50"
                          )}
                          onClick={() => toggleUrlLapFlag(i)}
                        >
                          {row.isFlagged ? "Flagged" : "Flag"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "csv" ? (
        <p className="text-[11px] text-muted-foreground">CSV import will use the same confirmation step as manual entry.</p>
      ) : null}

      <div className="space-y-1">
        <label className="text-xs font-mono text-muted-foreground" htmlFor="lap-times-edit">
          Laps (edit before save)
        </label>
        <textarea
          id="lap-times-edit"
          className="h-32 w-full resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none font-mono"
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
              urlLapRows: tab === "url" ? null : value.urlLapRows,
            });
          }}
          aria-label="Lap times"
        />
      </div>

      <div className="rounded-md border border-border/60 bg-secondary/15 px-3 py-2 text-[11px] space-y-1">
        <div className="font-mono text-muted-foreground">Preview</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-foreground">
          <span>
            Count: <span className="font-mono">{metrics.lapCount}</span>
          </span>
          <span>
            Best: <span className="font-mono">{formatLap(metrics.bestLap)}</span>
          </span>
          <span>
            Avg top 5: <span className="font-mono">{formatLap(metrics.averageTop5)}</span>
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
      </div>
    </div>
  );
}

export function defaultLapIngestValue(): LapIngestFormValue {
  return { ...DEFAULT_VALUE };
}
