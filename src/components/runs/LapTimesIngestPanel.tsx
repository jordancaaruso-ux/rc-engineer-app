"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { clientId } from "@/lib/clientId";
import {
  describePostedDay,
  resolveScanStatus,
  type ScanStatus,
  type ScanStatusAction,
} from "@/lib/lapImport/scanStatusCopy";
import { parseManualLapText } from "@/lib/lapSession/parseManual";
import type { LapSourceKind } from "@/lib/lapSession/types";
import type { LapImportLapRow, LapUrlSessionDriver } from "@/lib/lapUrlParsers/types";
import { formatLap } from "@/lib/runLaps";
import type { LapRow } from "@/lib/lapAnalysis";
import {
  computeMistakeLaps,
  formatMistakeLapDetail,
  getAverageTopN,
  getBestLap,
  getIncludedLapDashboardMetrics,
  getIncludedLaps,
} from "@/lib/lapAnalysis";
import { LapTimeGraph } from "@/components/runs/LapTimeGraph";
import { haptic } from "@/lib/haptics";
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
import {
  SOURCE_LABELS,
  type LapDiscoverySessionRow,
  type LapDiscoveryStatus,
} from "@/lib/lapWatch/lapDiscoveryStatus";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import {
  orderBlocksByTrackTime,
  primaryRowsAcrossBlocks,
} from "@/lib/lapImport/blockLapRows";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Eyebrow } from "@/components/ui/panel";
import { PagedCard } from "@/components/ui/PagedCard";
import {
  TrackTimingSourceNotice,
  type TrackTimingUrls,
} from "@/components/runs/TrackTimingSourceNotice";
import {
  MyRcmPdfImportCard,
  myRcmPdfSessionDrivers,
  type MyRcmPdfImportResponse,
} from "@/components/runs/MyRcmPdfImportCard";
import {
  MYRCM_PDF_PARSER_ID,
  isMyRcmHostUrl,
  myRcmPdfSourceFileName,
} from "@/lib/lapUrlParsers/myRcmPdfSource";

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
  /**
   * The timing imports attached to this run, each mapping to a persisted
   * `ImportedLapTimeSession`. Usually one; a session split by a quick break comes
   * back from the timing site as two entries and the driver attaches both, so the
   * run's laps are these blocks joined in on-track order.
   */
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

/**
 * What to print where a block's source would otherwise be its URL. A PDF import has no URL —
 * its `sourceUrl` is a synthetic `myrcm-pdf://…` fingerprint — so it shows the file's name.
 */
function describeBlockSource(block: UrlImportBlock): string {
  const fileName = myRcmPdfSourceFileName(block.sourceUrl);
  return fileName ? `MyRCM PDF · ${fileName}` : block.sourceUrl;
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

/**
 * The run's laps as text, joined across every attached import in on-track order
 * — the same list the save path sends. Mirrors into the manual box so switching
 * tabs shows the whole run, not just its first half.
 */
function primaryLapTextFromFirstBlock(blocks: UrlImportBlock[]): string {
  const rows = primaryRowsAcrossBlocks(blocks);
  if (rows.length === 0) return "";
  return rows.map((r) => r.lapTimeSeconds.toFixed(3)).join("\n");
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

/**
 * One parsed session, ready to attach.
 *
 * Both doors return this: `/api/lap-time-sessions/import` after a fetch from the timing site, and
 * `/api/lap-time-sessions/[id]` reading a parse this account already stored.
 */
type ImportResultRow = {
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

/** A session already imported once, and what it is currently filed under (`/api/laps/scan-day-url`). */
type ImportedSessionRow = ScanDayCandidate & {
  importedSessionId: string;
  linkedRunLabel: string | null;
};

const RECENT_RUNS_COLLAPSED = 3;
const RECENT_RUNS_MAX = 10;
/**
 * Segment order on the source rail. Fixed rather than derived from the rows so the segments do not
 * reshuffle underneath a driver between two scans of the same day.
 */
const SOURCE_FILTER_ORDER: readonly LapTimingSource[] = ["liverc", "speedhive", "myrcm"];
/**
 * How much of the day's list to draw when nothing matched. Long enough to find yourself in a club
 * day's practice rounds, short enough that the card stays a card — the server caps it at 60.
 */
const SESSIONS_TODAY_SHOWN = 12;

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

/** Human name for a timing provider — one spelling, used by every row that names a source. */
function timingSourceLabel(source: LapTimingSource | null | undefined): string | null {
  if (source === "speedhive") return "Speedhive";
  if (source === "liverc") return "LiveRC";
  if (source === "myrcm") return "MyRCM";
  return null;
}

function timingSourceLabelFromParserId(parserId: string | null | undefined): string | null {
  return timingSourceLabel(timingSourceFromParserId(parserId ?? ""));
}

function SessionImportListRow({
  title,
  when,
  bestLapSeconds,
  timingSource,
  actionLabel,
  disabled,
  onClick,
  note,
}: {
  title: string;
  when: string | null;
  bestLapSeconds: number | null;
  timingSource?: "liverc" | "speedhive" | "myrcm";
  actionLabel: string;
  disabled?: boolean;
  onClick: () => void;
  note?: string | null;
}) {
  // Time first: with a split run the driver picks the halves apart by when each
  // one ran, so it must be the thing the eye lands on, not a trailing detail.
  const meta = [when, timingSourceLabel(timingSource)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border border-border bg-surface-runna px-2.5 py-2 text-left transition hover:bg-surface-runna-inset",
        disabled && "opacity-60 pointer-events-none"
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{title}</span>
        {meta ? <span className="mt-0.5 block truncate text-[11px] text-faint">{meta}</span> : null}
        {/* Its own line, not appended to the meta: where a session is currently filed is the whole
            decision on this row, and glued onto the timestamp it was the half that got truncated. */}
        {note ? (
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
            {note}
          </span>
        ) : null}
      </span>
      {bestLapSeconds != null ? (
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className="text-[9px] font-medium uppercase tracking-wide text-faint">Best</span>
          <span className="fig-stat font-medium text-foreground">
            {formatLap(bestLapSeconds)}
          </span>
        </span>
      ) : null}
      <span className="shrink-0 rounded-full border border-primary-ink/45 bg-accent/5 px-3 py-1 text-[11px] font-bold text-primary-ink">
        {actionLabel}
      </span>
    </button>
  );
}

/**
 * Reveal driver for the landing readout: 0 → 1 over ~340ms, restarted whenever
 * `key` changes so each import plays its own. Returns 1 immediately under
 * reduce-motion, which leaves every dependent style at its final value.
 */
function useLandingReveal(key: string | null): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!key) {
      setProgress(0);
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setProgress(1);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start == null) start = now;
      const p = Math.min(1, (now - start) / 340);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setProgress(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return progress;
}

/** Ease-out so figures decelerate into their final value rather than snapping. */
function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

/** A figure counting into place. Held at `tabular-nums` so the digits never jitter. */
function RevealFigure({ label, value, progress }: { label: string; value: number | null; progress: number }) {
  const shown = value == null ? null : value * (0.985 + 0.015 * easeOutCubic(progress));
  return (
    <div className="min-w-0 flex-1">
      <div className="type-data-label">{label}</div>
      <div className="fig-tile text-foreground">{shown == null ? "—" : formatLap(shown)}</div>
    </div>
  );
}

/**
 * The Laps step's completion moment.
 *
 * Replaces the automatic jump to the next step, which had to go so a second
 * timing session could be attached. The jump was carrying a real load — without
 * it the step went empty and stranded the driver — so this fills the step
 * instead: the run's laps drawn, its figures counted in, one line of meaning,
 * and the forward action the jump used to perform, now taken deliberately.
 */
function LapsLandedReadout({
  rows,
  improvedBy,
  sourceLabel,
  revealKey,
}: {
  rows: LapRow[];
  /** Set when this import lowered the run's best lap — the one thing worth saying in green. */
  improvedBy: number | null;
  sourceLabel: string | null;
  revealKey: string | null;
}) {
  const progress = useLandingReveal(revealKey);
  const metrics = getIncludedLapDashboardMetrics(rows);

  // Same trace, same derivation as the Sessions expanded view — one lap graph in
  // the product, not a second one that happens to plot the same numbers.
  const mistakeAnalysis = useMemo(() => computeMistakeLaps(rows), [rows]);
  const mistakeLapNumbers = useMemo(
    () => new Set(mistakeAnalysis.mistakes.map((m) => m.lapNumber)),
    [mistakeAnalysis.mistakes]
  );
  const mistakeDetailByLapNumber = useMemo(
    () => new Map(mistakeAnalysis.mistakes.map((m) => [m.lapNumber, formatMistakeLapDetail(m)])),
    [mistakeAnalysis.mistakes]
  );
  const bestLapNumbers = useMemo(() => {
    if (metrics.bestLap == null) return new Set<number>();
    const eps = 0.0005;
    return new Set(
      getIncludedLaps(rows)
        .filter((l) => Math.abs(l.lapTimeSeconds - metrics.bestLap!) <= eps)
        .map((l) => l.lapNumber)
    );
  }, [rows, metrics.bestLap]);

  return (
    <div
      className="space-y-2.5 rounded-xl border border-border bg-card p-3 transition-opacity duration-300"
      style={{ opacity: 0.35 + 0.65 * progress }}
    >
      {/* Same floor the Sessions view uses — two points is not a trace. */}
      {rows.length >= 3 ? (
        <LapTimeGraph
          rows={rows}
          bestLapNumbers={bestLapNumbers}
          mistakeLapNumbers={mistakeLapNumbers}
          mistakeDetailByLapNumber={mistakeDetailByLapNumber}
          medianSeconds={null}
        />
      ) : null}

      <div className="flex gap-3 border-t border-border pt-2">
        <RevealFigure label="Best" value={metrics.bestLap} progress={progress} />
        <RevealFigure label="Median" value={metrics.median} progress={progress} />
        <div className="min-w-0 flex-1">
          <div className="type-data-label">Laps</div>
          <div className="fig-tile text-foreground">{metrics.lapCount}</div>
        </div>
      </div>

      <p
        className={cn(
          "flex items-center gap-1.5 text-[12px] transition-opacity duration-200",
          improvedBy != null ? "text-gain" : "text-muted-foreground"
        )}
        style={{ opacity: progress > 0.5 ? 1 : 0 }}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            improvedBy != null ? "bg-gain" : "bg-muted-foreground"
          )}
        />
        {improvedBy != null
          ? `Best lap improved by ${improvedBy.toFixed(3)}s — it came from this session.`
          : `Laps in${sourceLabel ? ` from ${sourceLabel}` : ""}.`}
      </p>
    </div>
  );
}

/** One attached import: when it ran, what it did, and a way to drop just this one. */
function AttachedSessionStrip({
  title,
  when,
  lapCount,
  bestLapSeconds,
  medianSeconds,
  sourceLabel,
  isFocused,
  selectable,
  onFocus,
  onRemove,
}: {
  title: string;
  when: string | null;
  lapCount: number;
  bestLapSeconds: number | null;
  medianSeconds: number | null;
  sourceLabel: string | null;
  isFocused: boolean;
  selectable: boolean;
  onFocus: () => void;
  onRemove: () => void;
}) {
  // Time first and source last: when the line has to truncate at 390px, the
  // provider is the least useful thing on it and the time is the whole point.
  const meta = [when, `${lapCount} lap${lapCount === 1 ? "" : "s"}`, sourceLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-md border px-2.5 py-2 transition",
        isFocused && selectable
          ? "border-primary-ink/50 bg-accent/10"
          : "border-border bg-surface-runna"
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        disabled={!selectable}
        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
      >
        <span className="w-full truncate text-[13px] font-semibold text-foreground">{title}</span>
        {meta ? <span className="fig-cell mt-0.5 w-full truncate text-faint">{meta}</span> : null}
      </button>
      {bestLapSeconds != null ? (
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className="type-data-label">Best</span>
          <span className="fig-stat font-medium text-foreground">{formatLap(bestLapSeconds)}</span>
        </span>
      ) : null}
      {medianSeconds != null ? (
        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className="type-data-label">Median</span>
          <span className="fig-stat font-medium text-foreground">{formatLap(medianSeconds)}</span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${title}`}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] leading-none text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
      >
        ×
      </button>
    </div>
  );
}

/**
 * The confirm before laps move off another run.
 *
 * A set of laps can only be filed under one run, so this says which run it would leave and what
 * that run does and doesn't lose — it keeps its own lap times; it only stops being the run linked
 * to this timing session. It scrolls itself into view because the card can be taller than the
 * screen and the wizard's bottom dock sits over the last of it.
 */
function MoveLapsConfirm({
  row,
  busy,
  onConfirm,
  onCancel,
}: {
  row: ImportedSessionRow;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Move these laps to this run?"
      className="mt-1 rounded-md border border-border bg-surface-runna-inset p-2.5"
    >
      <p className="text-[12px] font-semibold text-foreground">Move these laps to this run?</p>
      <p className="mt-1 text-[11px] text-muted-foreground text-pretty">
        {row.linkedRunLabel
          ? `They're currently filed under ${row.linkedRunLabel}. That run keeps its lap times — it just stops being the one linked to this timing session.`
          : "They're currently filed under another run. That run keeps its lap times — it just stops being the one linked to this timing session."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center rounded-md primary-face bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-60"
          onClick={onConfirm}
        >
          {busy ? "Moving…" : "Move them here"}
        </button>
        {row.linkedRunId ? (
          <Link
            href={`/runs/${row.linkedRunId}`}
            className="inline-flex items-center rounded-md border border-border bg-surface-runna px-2.5 py-1 text-[11px] font-semibold transition hover:bg-surface-runna-inset"
          >
            Open that run
          </Link>
        ) : null}
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-border bg-surface-runna px-2.5 py-1 text-[11px] font-semibold transition hover:bg-surface-runna-inset"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One fix, as a control.
 *
 * The point of the whole state rework: every empty card now ends in something pressable. "Open the
 * timing page" is the load-bearing one — it opens the exact page the scan just read, so a driver
 * can see for themselves whether the track is posting and what name they're printed under, instead
 * of taking our word for it.
 */
function ScanStatusActionButton({
  action,
  busy,
  trackId,
  onRetry,
  onPaste,
}: {
  action: ScanStatusAction;
  busy: boolean;
  trackId: string | null;
  onRetry: () => void;
  onPaste: () => void;
}) {
  const base =
    "inline-flex items-center rounded-md border border-border bg-surface-runna px-2.5 py-1 text-[11px] font-semibold transition hover:bg-surface-runna-inset";
  const primary =
    "inline-flex items-center rounded-md primary-face bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:brightness-95";

  switch (action.kind) {
    case "settings":
      return (
        <Link href="/settings" className={primary}>
          Check timing details
        </Link>
      );
    case "track":
      return (
        <Link href={trackId ? `/tracks/${trackId}` : "/tracks"} className={primary}>
          Add a timing page
        </Link>
      );
    case "retry":
      return (
        <button type="button" className={primary} disabled={busy} onClick={onRetry}>
          {busy ? "Checking…" : "Check again"}
        </button>
      );
    case "paste":
      return (
        <button type="button" className={base} onClick={onPaste}>
          Paste a link
        </button>
      );
    case "timingPage":
      return (
        <a href={action.url} target="_blank" rel="noopener noreferrer" className={base}>
          Open {SOURCE_LABELS[action.source]} page
        </a>
      );
  }
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
  eventMyRcmUrl,
  onSaveEventMyRcmUrl,
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
   * This meeting's page on MyRCM (`Event.myRcmUrl`), when the driver saved one. Read for exactly
   * one thing: the PDF door's "Open MyRCM" opens it, so the trip to download a result starts on
   * their own class rather than MyRCM's front page. Never fetched — see `myRcmPdfSource.ts`.
   */
  eventMyRcmUrl?: string | null;
  /**
   * Save that page onto the meeting, from beside the button that uses it. Absent when there is
   * no meeting to hang it on — the lap-analysis library takes MyRCM files with no event at all.
   */
  onSaveEventMyRcmUrl?: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  /** "Add another timing session" sends the driver straight back to the paste box. */
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  /** Last manually scanned discovery URL (a LiveRC day/event page) — lets Refresh re-scan it. */
  const manualScanUrlRef = useRef<string | null>(null);
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  /** A MyRCM page pasted into the URL box — it opens the PDF door rather than going to the server. */
  const [myRcmPastedUrl, setMyRcmPastedUrl] = useState<string | null>(null);
  const [dayScanBusy, setDayScanBusy] = useState(false);
  const [dayScanStatus, setDayScanStatus] = useState<ScanStatus | null>(null);
  const [dayScanCandidates, setDayScanCandidates] = useState<ScanDayCandidate[] | null>(null);
  const [dayScanIndexKind, setDayScanIndexKind] = useState<"practice" | "results" | null>(null);
  const [dayScanHasDriverName, setDayScanHasDriverName] = useState<boolean>(true);
  const [scanTotals, setScanTotals] = useState<{ total: number; unimported: number } | null>(null);
  const [showAllRecentRuns, setShowAllRecentRuns] = useState(false);
  /**
   * Which timing source the picker is narrowed to. A track carrying both a LiveRC page and a
   * MYLAPS one returns one merged stream, and on a race day the three rows above the fold can
   * easily all be from the site you weren't racing on.
   *
   * Reset to "all" by every scan (see `scanDayUrl`) rather than remembered: a refresh can bring
   * back a source that was quiet a minute ago, and a session arriving into a bucket the driver
   * isn't looking at reads exactly like a scan that found nothing.
   */
  const [sourceFilter, setSourceFilter] = useState<LapTimingSource | "all">("all");
  /** Unimported sessions completed before today (first-scan backlog) — collapsed by default. */
  const [dayScanOlderCandidates, setDayScanOlderCandidates] = useState<ScanDayCandidate[] | null>(null);
  const [dayScanOlderTotal, setDayScanOlderTotal] = useState(0);
  const [showOlderSessions, setShowOlderSessions] = useState(false);
  /** The day's list from the timing site, ours or not — only ever offered when nothing matched. */
  const [sessionsToday, setSessionsToday] = useState<LapDiscoverySessionRow[]>([]);
  const [sessionsTodayDayIso, setSessionsTodayDayIso] = useState<string | null>(null);
  const [showSessionsToday, setShowSessionsToday] = useState(false);
  /** Sessions here this driver has imported before — the way back to laps already pulled in. */
  const [importedCandidates, setImportedCandidates] = useState<ImportedSessionRow[]>([]);
  const [showAlreadyImported, setShowAlreadyImported] = useState(false);
  /**
   * A set of laps can only be filed under one run, so taking one that is on another run has to say
   * so first. Held as the row itself: the confirm names the run it would come off.
   */
  const [moveConfirmRow, setMoveConfirmRow] = useState<ImportedSessionRow | null>(null);
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

  // Every attached import, earliest on track first. A run split by a quick break
  // holds two; the ordinary run holds one and every list below is of length 1.
  const attachedBlocks = useMemo(
    () => orderBlocksByTrackTime(value.urlImportBlocks),
    [value.urlImportBlocks]
  );
  const attachedUrls = useMemo(
    () => new Set(attachedBlocks.map((b) => b.sourceUrl.trim()).filter(Boolean)),
    [attachedBlocks]
  );

  // Which attached import the driver-picker and lap ticks below are editing.
  // Defaults to the one just imported, which is the one they are looking at.
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  // The import that just landed — drives the completion moment's one-shot reveal.
  // Held rather than derived so it plays once per import, not on every re-render.
  const [landedBlockId, setLandedBlockId] = useState<string | null>(null);
  const activeImportBlock = useMemo(() => {
    if (attachedBlocks.length === 0) return null;
    // Falls back to the first half, not the last: a fresh import sets the focus
    // explicitly, so this default only decides what an edit opens on.
    return attachedBlocks.find((b) => b.blockId === focusedBlockId) ?? attachedBlocks[0] ?? null;
  }, [attachedBlocks, focusedBlockId]);

  const hasLinkedLapImport = attachedBlocks.length > 0;

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
  //
  // Sessions already attached to this run are filtered out: they are shown above
  // as their own strip, with the × that takes them back off. Leaving them here
  // too drew the same session twice, and the second copy could not be acted on.
  const mergedImportCandidates = useMemo<ImportPickerCandidate[]>(() => {
    const byUrl = new Map<string, ImportPickerCandidate>();
    for (const c of sortedEventRaceSessions) {
      const url = c.sessionUrl.trim();
      if (!url || attachedUrls.has(url)) continue;
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
      if (!url || byUrl.has(url) || attachedUrls.has(url)) continue;
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
  }, [sortedEventRaceSessions, sortedDayScanCandidates, attachedUrls]);

  // Backlog list (unimported sessions from before today) — collapsed behind "Show older sessions".
  const olderPickerRows = useMemo<ImportPickerCandidate[]>(() => {
    if (!dayScanOlderCandidates?.length) return [];
    const seenUrls = new Set(mergedImportCandidates.map((c) => c.sessionUrl.trim()));
    return sortSessionsNewestFirst(
      dayScanOlderCandidates.filter(
        (c) =>
          c.sessionUrl.trim() &&
          !seenUrls.has(c.sessionUrl.trim()) &&
          !attachedUrls.has(c.sessionUrl.trim())
      ),
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
  }, [dayScanOlderCandidates, mergedImportCandidates, attachedUrls]);

  /**
   * The segments the source rail offers, in one fixed order so they never reshuffle between scans.
   *
   * Built from the track's saved timing sites UNIONED with the sources actually present, not from
   * the rows alone. A saved site that came back empty still has to appear carrying its `0`:
   * dropping it reads as "we never looked there", when the truth is "we looked and it was quiet",
   * and that is the answer the driver taps it for. The union half also keeps a source that was
   * never a saved track site on the rail: MyRCM rows imported before 2026-08-26 stay findable even
   * though nothing new can arrive from there any more.
   */
  const filterSourceCounts = useMemo(() => {
    const counts = new Map<LapTimingSource, number>();
    if (hasLiveRcTrack) counts.set("liverc", 0);
    if (hasSpeedhiveTrack) counts.set("speedhive", 0);
    for (const row of mergedImportCandidates) {
      if (!row.timingSource) continue;
      counts.set(row.timingSource, (counts.get(row.timingSource) ?? 0) + 1);
    }
    // Older rows earn a segment but not a count — the number on the rail has to agree with the
    // number in the header, and the header counts what is in the list above the fold.
    for (const row of olderPickerRows) {
      if (row.timingSource && !counts.has(row.timingSource)) counts.set(row.timingSource, 0);
    }
    return SOURCE_FILTER_ORDER.filter((source) => counts.has(source)).map((source) => ({
      source,
      count: counts.get(source) ?? 0,
    }));
  }, [hasLiveRcTrack, hasSpeedhiveTrack, mergedImportCandidates, olderPickerRows]);

  /** One source is not a choice — the rail only earns its line when there are two to pick between. */
  const showSourceFilter = filterSourceCounts.length > 1;

  const matchesSourceFilter = useCallback(
    (source: LapTimingSource | null | undefined) => sourceFilter === "all" || source === sourceFilter,
    [sourceFilter]
  );

  // Filtering happens here, BEFORE the collapse slice below. The other way round and
  // "Show more sessions (4 more)" counts rows the filter has already taken out.
  const visibleImportCandidates = useMemo(
    () => mergedImportCandidates.filter((row) => matchesSourceFilter(row.timingSource)),
    [mergedImportCandidates, matchesSourceFilter]
  );

  const visibleOlderPickerRows = useMemo(
    () => olderPickerRows.filter((row) => matchesSourceFilter(row.timingSource)),
    [olderPickerRows, matchesSourceFilter]
  );

  /**
   * The filter emptied a list that has rows in it. Not reachable by tapping — a source with no
   * rows is an inert segment — but importing the last session from the selected source gets you
   * here, and the generic "check your driver name" copy would be a lie about what happened.
   */
  const sourceFilterHidEverything =
    sourceFilter !== "all" &&
    visibleImportCandidates.length === 0 &&
    mergedImportCandidates.length > 0;

  const canExpandImportRows = visibleImportCandidates.length > RECENT_RUNS_COLLAPSED;

  /**
   * Already-imported sessions, minus whatever this run is holding right now.
   *
   * The scan only knows what the database knows, so a session imported a minute ago and sitting in
   * the form above still comes back as "not on a run" — offering the driver laps they are already
   * looking at. Same rule the main picker list follows, and the same bug it was written to end.
   */
  const importedPickerRows = useMemo(
    () =>
      importedCandidates.filter(
        (row) => !attachedUrls.has(row.sessionUrl.trim()) && matchesSourceFilter(row.timingSource)
      ),
    [importedCandidates, attachedUrls, matchesSourceFilter]
  );

  /**
   * The day's list, whoever it belongs to. Filtered alongside everything else: it sits inside the
   * same panel under the same header, so a rail saying "Speedhive" while this expander offers
   * LiveRC rows would make the segment mean nothing.
   */
  const visibleSessionsToday = useMemo(
    () => sessionsToday.filter((row) => matchesSourceFilter(row.source)),
    [sessionsToday, matchesSourceFilter]
  );

  /**
   * "today" or the day the list is really from. LiveRC answers with the most recent day that has
   * any sessions on it, which at a club track is often days ago.
   */
  const sessionsDayLabel = useMemo(() => {
    const day = describePostedDay(sessionsTodayDayIso);
    if (!day) return "today";
    return day.isToday ? "today" : day.label;
  }, [sessionsTodayDayIso]);

  // Total for the status line — the track scan may report more unimported sessions
  // than it returns rows for. The scan counted anything attached since as still
  // unimported, so take those back off or the header reads one higher than the list.
  // With a source selected the list IS the total: `scanTotals` counts every source at once, so
  // letting it win here would print a number the segment below could never account for.
  const importPickerTotal =
    sourceFilter === "all"
      ? Math.max(mergedImportCandidates.length, (scanTotals?.unimported ?? 0) - attachedUrls.size)
      : visibleImportCandidates.length;

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
        title: "This track has no timing page saved",
        detail:
          "Add its LiveRC or MYLAPS page once and we'll look there every time you log a run here.",
        actions: [{ kind: "track" }, { kind: "paste" }],
      });
      return;
    }
    setDayScanBusy(true);
    setDayScanStatus(null);
    setDayScanIndexKind(null);
    setScanTotals(null);
    setShowAllRecentRuns(false);
    // Back to "all" for the incoming list. A scan can return a source that was empty last time,
    // and a new session landing behind an unselected segment looks like nothing was found.
    setSourceFilter("all");
    setDayScanOlderCandidates(null);
    setDayScanOlderTotal(0);
    setShowOlderSessions(false);
    setSessionsToday([]);
    setSessionsTodayDayIso(null);
    setShowSessionsToday(false);
    setImportedCandidates([]);
    setShowAlreadyImported(false);
    setMoveConfirmRow(null);
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
        // The server's own error text stays in the logs: at a race track, "fetch failed:
        // ETIMEDOUT" is not something a driver can do anything with.
        setDayScanStatus({
          title: "Couldn't check the timing site just now",
          detail: "Try again in a minute, or paste a link straight to your session.",
          actions: [{ kind: "retry" }, { kind: "paste" }],
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
      const status = ((data as { status?: unknown }).status ?? null) as LapDiscoveryStatus | null;
      const importedRows = Array.isArray((data as { importedCandidates?: unknown }).importedCandidates)
        ? ((data as { importedCandidates: ImportedSessionRow[] }).importedCandidates)
        : [];
      setDayScanIndexKind(ik === "results" || ik === "practice" ? ik : null);
      setDayScanHasDriverName(hasDriver);
      setDayScanCandidates(candidates);
      setDayScanOlderCandidates(olderCandidates);
      setDayScanOlderTotal(olderCount);
      setSessionsToday(Array.isArray(status?.sessionsToday) ? status.sessionsToday : []);
      setSessionsTodayDayIso(typeof status?.postedDayIso === "string" ? status.postedDayIso : null);
      setImportedCandidates(importedRows);
      setScanTotals({ total: totalCandidates, unimported: unimportedCount });
      setDayScanStatus(
        resolveScanStatus({
          status,
          scanMessage,
          totalCandidates,
          unimportedCount,
          candidateCount: candidates.length,
          olderCount,
          importedCount: importedRows.length,
        })
      );
    } catch {
      setDayScanStatus({
        title: "Couldn't check the timing site just now",
        detail: "Try again in a minute, or paste a link straight to your session.",
        actions: [{ kind: "retry" }, { kind: "paste" }],
      });
    } finally {
      setDayScanBusy(false);
    }
  }

  /**
   * Importing a second session now *adds* it, so there is nothing to confirm —
   * the old "this will replace your import" warning only earned its keep when a
   * run could hold one. Re-importing a URL already attached refreshes that one
   * in place rather than attaching it twice.
   */
  function alreadyAttached(targetUrl: string): boolean {
    const next = targetUrl.trim();
    return Boolean(next) && attachedUrls.has(next);
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
    setFocusedBlockId(null);
    setLandedBlockId(null);
    setUrlMessage(null);
  }

  /** Detach one attached import, leaving the others (and the run) alone. */
  function removeImportBlock(blockId: string) {
    const nextBlocks = value.urlImportBlocks.filter((b) => b.blockId !== blockId);
    if (nextBlocks.length === 0) {
      clearImport();
      return;
    }
    const ordered = orderBlocksByTrackTime(nextBlocks);
    onChange({
      ...value,
      urlImportBlocks: nextBlocks,
      manualText: primaryLapTextFromFirstBlock(nextBlocks),
      sourceDetail:
        ordered.length === 1 ? ordered[0]!.sourceUrl : `${ordered.length} timing sessions`,
      parserId: ordered[0]?.parserId ?? value.parserId,
      urlLapRows: ordered.length === 1 ? ordered[0]!.urlLapRows ?? null : null,
    });
    if (focusedBlockId === blockId) setFocusedBlockId(null);
    if (landedBlockId === blockId) setLandedBlockId(null);
    setActivePreviewKey(null);
  }

  async function importFromSessionUrl(sessionUrl: string) {
    if (alreadyAttached(sessionUrl)) {
      setUrlMessage("That session is already attached to this run.");
      return;
    }
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
    if (alreadyAttached(url)) {
      setUrlMessage("That session is already attached to this run.");
      return;
    }
    await runUrlImport(url);
  }

  async function runUrlImport(url: string) {
    if (isMyRcmHostUrl(url)) {
      // Never sent: myrcm.ch is on the fetch denylist, and the paste is the driver telling us
      // where they raced. Answer with the file door below rather than "not supported".
      setMyRcmPastedUrl(url);
      setUrlMessage(null);
      setUrlInput("");
      haptic("light");
      return;
    }
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

      type SuccessRow = ImportResultRow;

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

      attachImportRow(successes[0]!, url);
      setDayScanCandidates((prev) =>
        prev ? prev.map((c) => (c.sessionUrl === url ? { ...c, alreadyImported: true } : c)) : prev
      );
      void loadEventRaceSessions();
      // Deliberately does NOT advance the wizard any more. Jumping to the next
      // step made a second import impossible to reach, so the step now completes
      // in place — see the landing readout below, which carries the forward
      // action the jump used to perform.
    } catch {
      setUrlMessage("Request failed.");
    } finally {
      setUrlBusy(false);
    }
  }

  /**
   * Attach one parsed session to the run being logged.
   *
   * Shared by the two ways laps arrive: a fresh fetch from the timing site, and a session already
   * stored on this account being picked up again. Both hand over the same row shape, so the driver
   * picking, lap ticks and split-run ordering below can't drift between them.
   */
  function attachImportRow(
    row: ImportResultRow,
    fallbackUrl: string,
    opts?: {
      /**
       * The row that is theirs, decided by the server — or `null` for "nobody matched, make
       * them pick". Passing the key at all switches off the P1 fallback: a MyRCM result has no
       * driver id and no transponder, so guessing a row would file someone else's laps as theirs.
       */
      primaryDriverId: string | null;
    }
  ) {
    {
      const url = fallbackUrl;
      const parserId = row.parserId ?? "http_timing_v1";
      const combinedMessage = row.message ?? null;

      const sessionDriversRaw = row.sessionDrivers ?? [];
      const sessionDrivers = Array.isArray(sessionDriversRaw)
        ? sessionDriversRaw.filter((d) => d && typeof d.driverId === "string" && Array.isArray(d.laps))
        : [];
      const topLaps = row.laps ?? [];
      const lapRowsFromApi = row.lapRows;

      const autoSelectIds = opts
        ? opts.primaryDriverId && sessionDrivers.some((d) => d.driverId === opts.primaryDriverId)
          ? [opts.primaryDriverId]
          : []
        : sessionDrivers.length === 0
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
        blockId: clientId(),
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

      // Add, don't replace: a run split by a break holds both halves. Re-importing
      // a session already attached refreshes it in place, so a driver correcting a
      // bad parse doesn't end up with the same laps counted twice.
      const existingIdx = value.urlImportBlocks.findIndex(
        (b) =>
          b.sourceUrl.trim() === newBlock.sourceUrl.trim() ||
          (b.importedSessionId && b.importedSessionId === newBlock.importedSessionId)
      );
      const nextBlocks =
        existingIdx >= 0
          ? value.urlImportBlocks.map((b, i) => (i === existingIdx ? newBlock : b))
          : [...value.urlImportBlocks, newBlock];
      const ordered = orderBlocksByTrackTime(nextBlocks);

      onChange({
        ...value,
        manualText: primaryLapTextFromFirstBlock(nextBlocks),
        sourceKind: "url",
        sourceDetail:
          ordered.length === 1 ? newBlock.sourceUrl : `${ordered.length} timing sessions`,
        parserId: newBlock.parserId ?? "liverc_deterministic_v1",
        // The form-level warnings array only makes sense for a single import;
        // with a split run each block carries its own and the save path reads those.
        urlLapRows: ordered.length === 1 ? newBlock.urlLapRows ?? null : null,
        urlImportBlocks: nextBlocks,
      });
      const pid = newBlock.selectedDriverIds?.[0];
      if (pid) {
        setActivePreviewKey(`${newBlock.blockId}:${pid}`);
      }
      setFocusedBlockId(newBlock.blockId);
      if (sessionDrivers.length > 0) {
        setLandedBlockId(newBlock.blockId);
        haptic("light");
      }
      setUrlInput("");
      setUrlMessage(combinedMessage);
    }
  }

  /**
   * A MyRCM result the driver uploaded as a PDF, accepted by the server. Same attach as every
   * other import from here on — the response is reshaped into the row the URL door hands over.
   */
  function attachMyRcmPdf(res: MyRcmPdfImportResponse) {
    attachImportRow(
      {
        success: true,
        importedSessionId: res.importedSessionId,
        recordedAt: res.recordedAt,
        sessionCompletedAtIso: res.sessionCompletedAtIso,
        sessionCompletedAtDbIso: res.sessionCompletedAtDbIso,
        parserId: res.parserId,
        laps: res.laps,
        sessionDrivers: myRcmPdfSessionDrivers(res),
        sessionHint: { name: res.session.name },
        url: res.sourceUrl,
      },
      res.sourceUrl,
      { primaryDriverId: res.matchedDriverId }
    );
    setMyRcmPastedUrl(null);
  }

  /** The attached block a PDF import landed as, by the session the server minted for it. */
  function blockForImportedSession(importedSessionId: string): UrlImportBlock | null {
    return value.urlImportBlocks.find((b) => b.importedSessionId === importedSessionId) ?? null;
  }

  /**
   * Take laps this account already holds, without going back to the timing site.
   *
   * This is the way back to a session imported once already — the run it was on was deleted, or
   * abandoned, or it simply never got attached. Reading the stored parse rather than re-importing
   * the URL is the point: it still works when the club's server is asleep or the meeting page has
   * been taken down, which is exactly when a driver is trying to salvage the run.
   */
  async function takeStoredImport(row: ImportedSessionRow) {
    if (alreadyAttached(row.sessionUrl)) {
      setUrlMessage("That session is already attached to this run.");
      return;
    }
    setUrlBusy(true);
    setUrlMessage(null);
    try {
      const res = await fetch(`/api/lap-time-sessions/${encodeURIComponent(row.importedSessionId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlMessage((data as { error?: string })?.error || "Couldn't open those laps.");
        return;
      }
      const importRow = (data as { importRow?: ImportResultRow }).importRow;
      if (!importRow?.importedSessionId) {
        setUrlMessage("Couldn't read those laps — import the session again instead.");
        return;
      }
      attachImportRow(importRow, row.sessionUrl);
      // Off the "already imported" list and onto the run: it is drawn as an attached strip above
      // now, and leaving it in both places was how the same session got acted on twice.
      setImportedCandidates((prev) => prev.filter((c) => c.importedSessionId !== row.importedSessionId));
      setMoveConfirmRow(null);
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

  function statsForDriver(
    block: UrlImportBlock,
    d: LapUrlSessionDriver
  ): { bestLap: number | null; avgTop10: number | null; median: number | null; lapCount: number } {
    const rows =
      block.driverLapRowsByDriverId?.[d.driverId] ??
      d.laps.map((t, i) => ({
        lapNumber: i + 1,
        lapTimeSeconds: t,
        isIncluded: true,
      }));
    // Median comes from the same included-laps pass as the rest, so an excluded
    // lap can never count toward one figure and not another.
    const metrics = getIncludedLapDashboardMetrics(rows);
    return {
      bestLap: getBestLap(rows),
      avgTop10: getAverageTopN(rows, 10),
      median: metrics.median,
      lapCount: metrics.lapCount,
    };
  }

  /** The run's laps as saved: every attached import joined, on-track order. */
  const mergedRunRows = useMemo(
    () => primaryRowsAcrossBlocks(attachedBlocks),
    [attachedBlocks]
  );
  /**
   * How much the import that just landed lowered the run's best lap — null when
   * it didn't, or when it's the only one attached. This is the whole point of the
   * feature made visible: the quick lap that lived in the half you'd have lost.
   */
  const landedImprovedBy = useMemo(() => {
    if (!landedBlockId || attachedBlocks.length < 2) return null;
    const withLanded = getBestLap(mergedRunRows);
    const without = getBestLap(
      primaryRowsAcrossBlocks(attachedBlocks.filter((b) => b.blockId !== landedBlockId))
    );
    if (withLanded == null || without == null) return null;
    const delta = without - withLanded;
    return delta > 0.0005 ? delta : null;
  }, [landedBlockId, attachedBlocks, mergedRunRows]);

  const landedBlockIsAttached = useMemo(
    () => Boolean(landedBlockId && attachedBlocks.some((b) => b.blockId === landedBlockId)),
    [landedBlockId, attachedBlocks]
  );

  // Visible slice of the merged list (collapsed/expanded). Nothing attached to the
  // run reaches here — the list is only what you have not taken yet.
  const importPickerRows = useMemo(
    () =>
      visibleImportCandidates.slice(0, showAllRecentRuns ? RECENT_RUNS_MAX : RECENT_RUNS_COLLAPSED),
    [visibleImportCandidates, showAllRecentRuns]
  );

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
    <div className="space-y-3">
      {/* Card one: what this run's laps ARE. Its own card, not a band sitting on
          top of the importer — reading the laps you already have shouldn't feel
          like part of choosing what to add next. Above the importer either way,
          because these belong to the run, not to whichever method found them. */}
      {attachedBlocks.length > 0 ? (
        <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Laps on this run</Eyebrow>
            {isUrlTab(tab) ? (
              <button
                type="button"
                className="ml-auto shrink-0 rounded-md border border-border bg-surface-runna px-3 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-runna-inset hover:text-foreground transition"
                onClick={clearImport}
              >
                {attachedBlocks.length > 1 ? "Clear all" : "Clear import"}
              </button>
            ) : null}
          </div>
          {/* Earliest on track first. With one attached this is a single row —
              the strip is the run's laps, not a list UI. */}
          <div className="space-y-1.5">
            {attachedBlocks.map((block) => {
              // No fallback to P1: a block with nothing picked (a MyRCM PDF whose names
              // matched nobody) must not be drawn as if the winner's laps were theirs.
              const primaryId = block.selectedDriverIds?.[0] ?? null;
              const driver = primaryId
                ? block.sessionDrivers.find((d) => d.driverId === primaryId) ?? null
                : null;
              const stats = driver ? statsForDriver(block, driver) : null;
              return (
                <AttachedSessionStrip
                  key={block.blockId}
                  // Name only — the time is the meta line's job, and carrying it
                  // in both truncated each to uselessness at 390px.
                  title={
                    driver
                      ? driver.driverName
                      : block.sessionDrivers.length > 0
                        ? "Pick your name"
                        : describeBlockSource(block)
                  }
                  when={formatImportedSessionTime(
                    blockLabelTimeIso(block),
                    blockTimeFormatOpts(block)
                  )}
                  lapCount={stats?.lapCount ?? 0}
                  bestLapSeconds={stats?.bestLap ?? null}
                  medianSeconds={stats?.median ?? null}
                  sourceLabel={timingSourceLabelFromParserId(block.parserId)}
                  isFocused={activeImportBlock?.blockId === block.blockId}
                  selectable={attachedBlocks.length > 1}
                  onFocus={() => setFocusedBlockId(block.blockId)}
                  onRemove={() => removeImportBlock(block.blockId)}
                />
              );
            })}
          </div>

          <LapsLandedReadout
            rows={mergedRunRows}
            improvedBy={landedImprovedBy}
            sourceLabel={timingSourceLabelFromParserId(
              attachedBlocks[attachedBlocks.length - 1]?.parserId ?? null
            )}
            revealKey={landedBlockIsAttached ? landedBlockId : "settled"}
          />
        </SurfaceCard>
      ) : null}

      {/* Card two: where laps come from. Separate surface so the tabs read as a
          tool you reach for, not as more of the run's own record. */}
      <SurfaceCard variant="panel" overflowHidden={false} contentClassName="space-y-3">
        <Eyebrow>{hasLinkedLapImport ? "Import more laps" : "Add lap times"}</Eyebrow>
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
              {/*
                Which site's sessions to show. Only drawn when the track really has more than one
                to choose between — most tracks carry a LiveRC page or a MYLAPS one, not both, and
                there a rail would be a control with a single real option.

                A source that was searched and came back with nothing keeps its segment and shows
                `0`, greyed and untappable: that is the answer, and it is worth more here than an
                empty list reached by a tap.
              */}
              {showSourceFilter ? (
                <SegmentedControl<LapTimingSource | "all">
                  size="sm"
                  ariaLabel="Timing source"
                  segmentClassName="px-2 py-1 text-[11px]"
                  value={sourceFilter}
                  onChange={(next) => {
                    setSourceFilter(next);
                    // A narrower list starts collapsed again, or "Show fewer sessions" sits under
                    // three rows offering to hide nothing.
                    setShowAllRecentRuns(false);
                  }}
                  options={[
                    {
                      value: "all",
                      label: (
                        <>
                          All
                          <span className="font-normal tabular-nums opacity-70">
                            {mergedImportCandidates.length}
                          </span>
                        </>
                      ),
                      ariaLabel: `All sources, ${mergedImportCandidates.length} sessions`,
                    },
                    ...filterSourceCounts.map(({ source, count }) => ({
                      value: source,
                      label: (
                        <>
                          {timingSourceLabel(source)}
                          <span className="font-normal tabular-nums opacity-70">{count}</span>
                        </>
                      ),
                      ariaLabel: `${timingSourceLabel(source) ?? source}, ${count} session${
                        count === 1 ? "" : "s"
                      }`,
                      disabled: count === 0,
                    })),
                  ]}
                />
              ) : null}
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
                      ? "We need your MYLAPS transponder number and/or your name on MYLAPS to find your sessions at this track."
                      : "We need your driver name (LiveRC, and/or a Speedhive transponder / name) to find your sessions at this track."}
                  </p>
                  <Link
                    href="/settings"
                    className="mt-2 inline-flex items-center rounded-md primary-face bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition hover:brightness-95"
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
                          // Named on every row while the list is mixed; dropped once a source is
                          // selected, where the rail above has already said it seven times.
                          timingSource={sourceFilter === "all" ? row.timingSource : undefined}
                          actionLabel={row.alreadyImported ? "Import again" : "Import"}
                          disabled={urlBusy}
                          onClick={() => void importFromSessionUrl(row.sessionUrl)}
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
                        : // Counted off the FILTERED list, like the slice above it. Off the merged
                          // one this offered "(4 more)" on a source that only had one left to show.
                          `Show more sessions (${
                            Math.min(RECENT_RUNS_MAX, visibleImportCandidates.length) -
                            RECENT_RUNS_COLLAPSED
                          } more)`}
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
              {/*
                Emptied by the filter, not by the scan — the last session from the selected source
                has just been taken onto this run. Says so, and offers the way back, rather than
                sending the driver to Settings to fix a driver name that was never wrong.
              */}
              {!eventRaceBusy && !dayScanBusy && sourceFilterHidEverything ? (
                <div className="px-3 py-4 text-center">
                  <p className="text-sm font-semibold text-foreground text-balance">
                    Nothing left from {timingSourceLabel(sourceFilter as LapTimingSource)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground text-pretty">
                    There are still {mergedImportCandidates.length} session
                    {mergedImportCandidates.length === 1 ? "" : "s"} from the other sources.
                  </p>
                  <button
                    type="button"
                    className="mt-2.5 rounded-md border border-border bg-surface-runna px-3 py-1.5 text-[11px] font-medium transition hover:bg-surface-runna-inset"
                    onClick={() => {
                      setSourceFilter("all");
                      setShowAllRecentRuns(false);
                    }}
                  >
                    Show all sessions
                  </button>
                </div>
              ) : null}
              {!eventRaceBusy && !dayScanBusy && mergedImportCandidates.length === 0 ? (
                (() => {
                  const status: ScanStatus = dayScanStatus ??
                    (eventRaceHint
                      ? { title: "No sessions to import yet", detail: eventRaceHint, actions: [] }
                      : {
                          title: "No sessions found yet",
                          detail:
                            "Check your driver name and transponder number in Settings, or add a LiveRC or MYLAPS page to this track.",
                          actions: [{ kind: "settings" }, { kind: "track" }],
                        });
                  return (
                    <div className="px-3 py-4 text-center">
                      <p className="text-sm font-semibold text-foreground text-balance">
                        {status.title}
                      </p>
                      {status.detail ? (
                        <p className="mt-1 text-xs text-muted-foreground text-pretty">{status.detail}</p>
                      ) : null}
                      {status.actions.length > 0 ? (
                        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                          {status.actions.map((action) => (
                            <ScanStatusActionButton
                              key={action.kind === "timingPage" ? `page:${action.url}` : action.kind}
                              action={action}
                              busy={dayScanBusy}
                              trackId={trackId ?? null}
                              onRetry={() => void refreshImportSources()}
                              onPaste={() => {
                                // "Paste a link" is only offered where the automatic scan failed,
                                // so it has to land on the tab that takes a URL by hand.
                                selectTab("url-manual");
                                urlInputRef.current?.focus();
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}
              {!dayScanBusy && visibleOlderPickerRows.length > 0 ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-runna-inset transition"
                    onClick={() => setShowOlderSessions((prev) => !prev)}
                  >
                    {showOlderSessions
                      ? "Hide older sessions"
                      : // `dayScanOlderTotal` is the server's count across every source at once, so
                        // it can only be quoted while the list is unfiltered.
                        `Show older sessions (${
                          sourceFilter === "all" ? dayScanOlderTotal : visibleOlderPickerRows.length
                        })`}
                  </button>
                  {showOlderSessions ? (
                    <>
                      <ul className="space-y-1">
                        {visibleOlderPickerRows.map((row) => (
                          <li key={row.key}>
                            <SessionImportListRow
                              title={row.title}
                              when={row.when}
                              bestLapSeconds={row.bestLapSeconds}
                              timingSource={sourceFilter === "all" ? row.timingSource : undefined}
                              actionLabel="Import"
                              disabled={urlBusy}
                              onClick={() => void importFromSessionUrl(row.sessionUrl)}
                            />
                          </li>
                        ))}
                      </ul>
                      {sourceFilter === "all" && dayScanOlderTotal > olderPickerRows.length ? (
                        <p className="ui-label-meta">
                          Showing the {olderPickerRows.length} most recent of {dayScanOlderTotal} older sessions.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {/*
                The day's list, whoever it belongs to — LiveRC only, and only when nothing of ours
                matched. It is the escape hatch from a name the track prints differently: find your
                own session, take it, then fix the name in Settings so the next one finds itself.
                Behind a tap, never automatic — the old card printed five strangers' names at you.
              */}
              {!dayScanBusy && visibleSessionsToday.length > 0 ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-runna-inset transition"
                    onClick={() => setShowSessionsToday((prev) => !prev)}
                  >
                    {showSessionsToday
                      ? `Hide the sessions from ${sessionsDayLabel}`
                      : `See the sessions from ${sessionsDayLabel} (${visibleSessionsToday.length})`}
                  </button>
                  {showSessionsToday ? (
                    <>
                      <p className="ui-label-meta">
                        Everything posted at this track {sessionsDayLabel}. If one of these is yours,
                        take it — then fix your name in Settings so the next one finds itself.
                      </p>
                      <ul className="space-y-1">
                        {visibleSessionsToday.slice(0, SESSIONS_TODAY_SHOWN).map((row) => (
                          <li key={`today:${row.sessionId}`}>
                            <SessionImportListRow
                              title={row.label}
                              when={[
                                formatSessionWhen(row.sessionCompletedAtIso, null, row.source),
                                row.detail,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              bestLapSeconds={null}
                              timingSource={sourceFilter === "all" ? row.source : undefined}
                              actionLabel="Import"
                              disabled={urlBusy}
                              onClick={() => void importFromSessionUrl(row.sessionUrl)}
                            />
                          </li>
                        ))}
                      </ul>
                      {visibleSessionsToday.length > SESSIONS_TODAY_SHOWN ? (
                        <p className="ui-label-meta">
                          Showing {SESSIONS_TODAY_SHOWN} of {visibleSessionsToday.length}.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {/*
                Sessions imported before. These used to be filtered out entirely, which made a lap
                set feel spent once used — import a session, make a mess of the run, start over, and
                the laps were gone from the list. They never were: the import survives the run.
              */}
              {!dayScanBusy && importedPickerRows.length > 0 ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="w-full rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-runna-inset transition"
                    onClick={() => setShowAlreadyImported((prev) => !prev)}
                  >
                    {showAlreadyImported
                      ? "Hide sessions you've already imported"
                      : `Show sessions you've already imported (${importedPickerRows.length})`}
                  </button>
                  {showAlreadyImported ? (
                    <ul className="space-y-1">
                      {importedPickerRows.map((row) => (
                        <li key={`imported:${row.importedSessionId}`}>
                          <SessionImportListRow
                            title={row.driverName?.trim() || "Session"}
                            when={formatSessionWhen(
                              row.sessionCompletedAtIso,
                              row.sessionTime,
                              row.timingSource
                            )}
                            note={row.linkedRunLabel ? `On ${row.linkedRunLabel}` : "Not on a run"}
                            bestLapSeconds={row.bestLapSeconds ?? null}
                            timingSource={sourceFilter === "all" ? row.timingSource : undefined}
                            // Laps sitting loose are simply taken. Laps filed under another run get
                            // the confirm first, because taking them moves them off it.
                            actionLabel={row.linkedRunId ? "Use here" : "Use these laps"}
                            disabled={urlBusy}
                            onClick={() => {
                              if (row.linkedRunId) setMoveConfirmRow(row);
                              else void takeStoredImport(row);
                            }}
                          />
                          {/*
                            The confirm opens against the row it belongs to, not at the foot of the
                            card. Rendered after the list it sat below the fold behind the wizard's
                            bottom dock, so on a phone "Use here" looked like it did nothing.
                          */}
                          {moveConfirmRow?.importedSessionId === row.importedSessionId ? (
                            <MoveLapsConfirm
                              row={moveConfirmRow}
                              busy={urlBusy}
                              onConfirm={() => void takeStoredImport(moveConfirmRow)}
                              onCancel={() => setMoveConfirmRow(null)}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
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
                straight in.
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
            Paste a LiveRC or Speedhive session URL to import laps. MyRCM results come in as a
            file — see below.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="url-import-input"
              ref={urlInputRef}
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
                  <div className="text-[11px] text-muted-foreground break-all">
                    {describeBlockSource(activeImportBlock)}
                  </div>
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
                        <ul className="tabular-nums text-xs max-h-48 overflow-y-auto rounded-md border border-border bg-surface-runna p-2 space-y-1">
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
            Upload a screenshot or photo of a lap list or timing screen. We read the laps out of
            it into the box below — always check them before saving.
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
              Model confidence: <span className="tabular-nums text-foreground/90">{photoConfidence}</span>
            </p>
          ) : null}
          {photoNote ? <p className="text-[11px] text-muted-foreground">{photoNote}</p> : null}
        </div>
            ),
          },
        ]}
      />

      {/* The MyRCM door. Below the tabs, not among them: it only matters to drivers who race
          on MyRCM, and it opens itself when one of them pastes a MyRCM link above. */}
      {isUrlTab(tab) ? (
        <MyRcmPdfImportCard
          pastedUrl={myRcmPastedUrl}
          openUrl={isMyRcmHostUrl(eventMyRcmUrl) ? eventMyRcmUrl!.trim() : null}
          onSaveOpenUrl={onSaveEventMyRcmUrl}
          hasImported={attachedBlocks.some((b) => b.parserId === MYRCM_PDF_PARSER_ID)}
          onImported={attachMyRcmPdf}
          selectedDriverIdFor={(sid) => blockForImportedSession(sid)?.selectedDriverIds?.[0] ?? null}
          onPickDriver={(sid, driverId) => {
            const block = blockForImportedSession(sid);
            if (!block) return;
            selectPrimaryDriverForBlock(block.blockId, driverId, 0);
            setFocusedBlockId(block.blockId);
            setActivePreviewKey(`${block.blockId}:${driverId}`);
            haptic("light");
          }}
        />
      ) : null}

      {!isUrlTab(tab) ? (
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground" htmlFor="lap-times-edit">
            Laps (edit before save)
          </label>
          <textarea
            id="lap-times-edit"
            className="h-32 w-full resize-none rounded-md border border-border bg-surface-runna-inset px-3 py-2 fig-stat outline-none tabular-nums"
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
                        <ul className="tabular-nums text-xs max-h-48 overflow-y-auto rounded-md border border-border bg-surface-runna p-2 space-y-1">
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
    </div>
  );
}

export function defaultLapIngestValue(): LapIngestFormValue {
  return { ...DEFAULT_VALUE };
}
