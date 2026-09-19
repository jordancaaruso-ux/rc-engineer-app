"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Flag } from "lucide-react";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { SectorClipPlayer } from "@/components/videoAnalysis/SectorClipPlayer";
import { mappableLines } from "@/components/videoAnalysis/SectorLineMap";
import { getDeltaStyle, resolveDeltaTintRange } from "@/lib/lapAnalysis";
import type { SectorLineInfo } from "@/lib/manualVideoAnalysis/sectors";
import type { ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { cn } from "@/lib/utils";
import {
  bestLap,
  buildCompareDrivers,
  idealLap,
  lapRows,
  sectorLeaders,
  segmentDefs,
  segmentStats,
  TOP_N,
  type CompareDriver,
  type LapRow,
  type SegmentDef,
  type SegmentStats,
  type SegmentTime,
} from "@/lib/videoAnalysis/driverCompare";
import { SF_LINE_KEY } from "@/lib/videoAnalysis/findCrossings/fromSession";
import { formatSignedDeltaSec, type SegmentWindow } from "@/lib/videoAnalysis/lapCompare";

/**
 * The sector board (SECTOR_COMPARE_NORTH_STAR; reworked 2026-08-28, and again 2026-09-02).
 *
 * Rows are YOUR laps — every one the scan read. Above them sits the lap you are reading them
 * against: one of a rival's laps (their best until you tap another, or their best through every
 * sector stitched together), or, with nobody chosen, your own best lap. Every cell is tinted by
 * its gap to that reference, from your side: positive is you slower, red.
 *
 * Tap any cell and the player shows it: what you tapped is solid, the reference through the
 * same sector is the ghost, so a tap is always a real lap against a real lap. The top-5 average
 * used to be the base and it cannot be a video ("the base, top five average, is impossible as a
 * video" — the driver, 2026-09-02); it survives as one footer row of numbers.
 *
 * The player runs the whole width of the page, the sheet below it.
 */

/** What the sheet is read against: one of the rival's laps, or their best through every sector. */
type RefPick = number | "ideal";

/** What plays: one of your laps, your best-sectors footer, or the reference itself. */
type Watch = { row: number | "best" | "ref"; seg: number | "lap" };

type Clip = { label: string; sec: number; window: SegmentWindow; lapNumber: number };

type Reference = {
  /** Whose lap it is, for the clip labels. */
  who: string;
  label: string;
  cells: Array<SegmentTime | null>;
  /** The whole-lap figure; null for the stitched ideal with a sector missing. */
  total: number | null;
  /** The whole lap on the video clock; null for the stitched ideal, which never happened. */
  window: SegmentWindow | null;
  lapNumber: number | null;
  mine: boolean;
};

function fmt(sec: number): string {
  return sec.toFixed(3);
}

/** The quickest lap with anything on it — a fallback when no lap is clean. */
function quickestWithAnything(rows: LapRow[]): LapRow | null {
  return (
    [...rows].filter((r) => r.cells.some(Boolean)).sort((a, b) => a.lapTimeSec - b.lapTimeSec)[0] ?? null
  );
}

function clipOf(row: LapRow, seg: number | "lap", who: string): Clip | null {
  if (seg === "lap") {
    return { label: `${who} L${row.lapNumber}`, sec: row.lapTimeSec, window: row.window, lapNumber: row.lapNumber };
  }
  const c = row.cells[seg];
  return c ? { label: `${who} L${c.lapNumber}`, sec: c.sec, window: c.window, lapNumber: c.lapNumber } : null;
}

function clipOfTime(t: SegmentTime | null, who: string): Clip | null {
  return t ? { label: `${who} L${t.lapNumber}`, sec: t.sec, window: t.window, lapNumber: t.lapNumber } : null;
}

export function DriverComparePanel({
  session,
  lines,
  videoUrl,
}: {
  session: ManualVideoSessionV2;
  lines: SectorLineInfo[];
  /** The analysed video, for the player. Null: the sheet shows, nothing plays. */
  videoUrl: string | null;
}) {
  const drivers = useMemo(() => buildCompareDrivers(session, lines), [session, lines]);
  const segments = useMemo(() => segmentDefs(lines), [lines]);
  const me = drivers.find((d) => d.role === "me") ?? null;
  const rivals = useMemo(() => drivers.filter((d) => d.role !== "me"), [drivers]);

  // Every figure once.
  const stats = useMemo(() => {
    const m = new Map<string, SegmentStats>();
    for (const d of drivers) for (const s of segments) m.set(`${d.key}|${s.key}`, segmentStats(d, s));
    return m;
  }, [drivers, segments]);
  const statFor = (d: CompareDriver, s: SegmentDef) => stats.get(`${d.key}|${s.key}`)!;
  const statsOf = (d: CompareDriver) => segments.map((s) => statFor(d, s));

  // The confirmed rival is the one you read against from the start; "None" is your own best lap.
  const [overlayKey, setOverlayKey] = useState<string | null>(
    () => (rivals.find((r) => r.trust === "confirmed") ?? rivals[0])?.key ?? null
  );
  /** Which of their laps; null = their best lap. */
  const [refPick, setRefPick] = useState<RefPick | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [swapped, setSwapped] = useState(false);

  const overlay = overlayKey ? (rivals.find((r) => r.key === overlayKey) ?? null) : null;

  const meStats = useMemo(() => (me ? segments.map((s) => stats.get(`${me.key}|${s.key}`)!) : []), [me, stats, segments]);
  const meRows = useMemo(() => (me ? lapRows(me, meStats) : []), [me, meStats]);
  const myBest = useMemo(() => bestLap(meRows), [meRows]);
  const overlayStats = useMemo(
    () => (overlay ? segments.map((s) => stats.get(`${overlay.key}|${s.key}`)!) : []),
    [overlay, stats, segments]
  );
  const overlayRows = useMemo(() => (overlay ? lapRows(overlay, overlayStats) : []), [overlay, overlayStats]);
  const overlayBest = useMemo(() => bestLap(overlayRows), [overlayRows]);
  const leaders = useMemo(
    () => sectorLeaders(drivers, segments, (d, s) => stats.get(`${d.key}|${s.key}`)!),
    [drivers, segments, stats]
  );

  // ---- the reference -----------------------------------------------------------------------
  const ref: Reference | null = (() => {
    if (overlay) {
      if (refPick === "ideal") {
        const ideal = idealLap(overlayStats);
        return {
          who: overlay.name,
          label: `${overlay.name} · best sectors`,
          cells: ideal.cells,
          total: ideal.total,
          window: null,
          lapNumber: null,
          mine: false,
        };
      }
      const row =
        (typeof refPick === "number" ? overlayRows.find((r) => r.lapNumber === refPick) : null) ??
        overlayBest ??
        quickestWithAnything(overlayRows);
      if (!row) return null;
      return {
        who: overlay.name,
        label: `${overlay.name} L${row.lapNumber}`,
        cells: row.cells,
        total: row.lapTimeSec,
        window: row.window,
        lapNumber: row.lapNumber,
        mine: false,
      };
    }
    const row = myBest ?? quickestWithAnything(meRows);
    if (!row) return null;
    return {
      who: "You",
      label: `You L${row.lapNumber}`,
      cells: row.cells,
      total: row.lapTimeSec,
      window: row.window,
      lapNumber: row.lapNumber,
      mine: true,
    };
  })();

  // The tint scale comes from the gaps actually on the sheet, as the lap sheet does it.
  const tintRange = (() => {
    if (!ref) return 0;
    const deltas: number[] = [];
    for (const row of meRows) {
      row.cells.forEach((c, i) => {
        const rv = ref.cells[i]?.sec ?? null;
        if (c && !c.suspect && rv != null) deltas.push(c.sec - rv);
      });
    }
    return resolveDeltaTintRange(deltas);
  })();

  if (!me || segments.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <span className="type-data-label">Sector board</span>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {segments.length === 0
            ? "Draw at least one sector line besides the start line to compare sectors."
            : "Your laps have no sector crossings yet — scan them first."}
        </p>
      </div>
    );
  }

  // ---- what plays ------------------------------------------------------------------------
  // Nothing tapped yet: your best lap, whole, against the reference. The player is the headline
  // and never sits empty while there is a lap to show.
  const defaultRow = myBest ?? quickestWithAnything(meRows);
  const shown: Watch | null =
    watch &&
    (watch.row === "best" ||
      (watch.row === "ref" && ref && (watch.seg !== "lap" || ref.window)) ||
      (typeof watch.row === "number" && meRows.some((r) => r.lapNumber === watch.row)))
      ? watch
      : defaultRow
        ? { row: defaultRow.lapNumber, seg: "lap" }
        : null;

  const refClip = (seg: number | "lap"): Clip | null => {
    if (!ref) return null;
    if (seg === "lap") {
      return ref.window && ref.total != null && ref.lapNumber != null
        ? { label: ref.label, sec: ref.total, window: ref.window, lapNumber: ref.lapNumber }
        : null;
    }
    return clipOfTime(ref.cells[seg] ?? null, ref.who);
  };

  // Your side and theirs, whichever was tapped. With nobody chosen both are yours, and the
  // reference through the same sector is your best — never the same clip twice.
  let mine: Clip | null = null;
  let other: Clip | null = null;
  if (shown) {
    const seg = shown.seg;
    if (shown.row === "ref") {
      other = refClip(seg);
      mine = seg === "lap" ? (myBest ? clipOf(myBest, "lap", "You") : null) : clipOfTime(meStats[seg]?.best ?? null, "You");
    } else if (shown.row === "best") {
      mine = seg === "lap" ? (myBest ? clipOf(myBest, "lap", "You") : null) : clipOfTime(meStats[seg]?.best ?? null, "You");
      other = refClip(seg);
    } else {
      const row = meRows.find((r) => r.lapNumber === shown.row);
      mine = row ? clipOf(row, seg, "You") : null;
      other = refClip(seg);
    }
    if (!overlay && mine && other && mine.lapNumber === other.lapNumber) {
      if (seg === "lap") {
        const alt = meRows
          .filter((r) => r.clean && r.lapNumber !== mine!.lapNumber)
          .sort((a, b) => a.lapTimeSec - b.lapTimeSec)[0];
        other = alt ? clipOf(alt, "lap", "You") : null;
      } else {
        other = clipOfTime(meStats[seg]?.clean.find((t) => t.lapNumber !== mine!.lapNumber) ?? null, "You");
      }
    }
  }

  // What you tapped is solid; the reference is the ghost. Tapping the reference row makes THEIR
  // lap solid and yours the ghost. Swap flips it.
  const tappedTheirs = shown?.row === "ref";
  const solid = (swapped ? !tappedTheirs : tappedTheirs) ? other : mine;
  const ghost = solid === mine ? other : mine;

  // The gap from your side, whatever is solid: you minus them. Positive = you are slower = red.
  const gap = mine && other ? mine.sec - other.sec : null;
  const segName = shown && shown.seg !== "lap" ? (segments[shown.seg]?.name ?? "") : "whole lap";

  // The split, drawn on the picture. Every line stays on screen; the two that bound what is
  // playing are lit, so "watch S2" also answers "where is S2". A whole-lap clip lights them all.
  const mapLines = mappableLines(lines);
  const watchedSeg = shown && shown.seg !== "lap" ? (segments[shown.seg] ?? null) : null;
  // segmentDefs names the lap start "start" and the lap end "end" — both are the S/F line.
  const boundKey = (key: string | undefined) =>
    key == null ? null : key === "start" || key === "end" ? SF_LINE_KEY : key;
  // Sector lines as ticks on a whole-lap clip, so the driver can see which corner the gap opened at.
  const ticksFor = (clip: Clip | null): number[] | undefined => {
    if (!clip || !shown || shown.seg !== "lap") return undefined;
    const rows = clip === mine ? meRows : overlayRows;
    const row = rows.find((r) => r.lapNumber === clip.lapNumber);
    return row?.cells.slice(0, -1).flatMap((c) => (c ? [c.window.endSec - clip.window.startSec] : []));
  };

  const player = (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
      {solid && videoUrl ? (
        <SectorClipPlayer
          videoUrl={videoUrl}
          aWindow={solid.window}
          bWindow={ghost?.window ?? solid.window}
          aLabel={`${solid.label} · ${fmt(solid.sec)}`}
          bLabel={ghost ? `${ghost.label} · ${fmt(ghost.sec)}` : "—"}
          fit="window"
          ticks={ticksFor(solid)}
          lines={mapLines}
          fromKey={boundKey(watchedSeg?.fromKey)}
          toKey={boundKey(watchedSeg?.toKey)}
        />
      ) : solid ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          Attach the video to watch this.
        </p>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          Tap any time in the table to watch it.
        </p>
      )}
      {solid ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <div className="min-w-0 space-y-0.5 text-[12px] leading-snug">
            <p>
              <span className="micro-caps text-faint">Solid</span>{" "}
              <span className="font-semibold text-foreground">{solid.label}</span>
              <span className="text-muted-foreground">
                {" "}
                · {segName} · {fmt(solid.sec)}
              </span>
            </p>
            <p>
              <span className="micro-caps text-faint">Ghost</span>{" "}
              {ghost ? (
                <>
                  <span className="font-semibold text-foreground">{ghost.label}</span>
                  <span className="text-muted-foreground"> · {fmt(ghost.sec)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">nothing to ghost here</span>
              )}
            </p>
            {gap != null && mine && other ? (
              <p
                className={cn(
                  "fig-stat tabular-nums",
                  gap > 0 ? "text-destructive" : gap < 0 ? "text-gain" : "text-muted-foreground"
                )}
              >
                {formatSignedDeltaSec(gap)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  {overlay
                    ? `you're ${gap > 0 ? "slower" : gap < 0 ? "faster" : "level"} than ${other.label} here`
                    : `${mine.label} is ${gap > 0 ? "slower" : gap < 0 ? "faster" : "level"} than ${other.label}`}
                </span>
              </p>
            ) : null}
          </div>
          {ghost ? (
            <button
              type="button"
              onClick={() => setSwapped((s) => !s)}
              className={cn(chipToggleClass(swapped), "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]")}
            >
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
              Swap solid / ghost
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  // ---- the table ---------------------------------------------------------------------------
  const isWatched = (row: Watch["row"], seg: Watch["seg"]) => shown != null && shown.row === row && shown.seg === seg;

  const tap = (row: Watch["row"], seg: Watch["seg"]) => {
    setSwapped(false);
    setWatch({ row, seg });
  };

  /** One of your cells: the time, tinted by its gap to the reference through the same sector. */
  const cell = (
    key: string,
    value: number | null,
    refValue: number | null,
    row: Watch["row"],
    seg: Watch["seg"],
    opts: { suspect?: boolean; title?: string; canWatch?: boolean } = {}
  ) => {
    // Read from YOUR side: you minus them, so positive = you are slower here = red. ("Red
    // should always be user is slower; green looked like I'm fast.")
    const delta = value != null && refValue != null ? value - refValue : null;
    const style = delta != null && !opts.suspect ? getDeltaStyle(delta, tintRange) : undefined;
    const watched = isWatched(row, seg);
    const canWatch = opts.canWatch ?? true;
    return (
      <td
        key={key}
        className={cn("border-b border-border/60 p-0 align-middle", opts.suspect && "shadow-[inset_0_0_0_1px_var(--faint)]")}
        style={style}
      >
        <button
          type="button"
          disabled={value == null || !canWatch}
          onClick={() => tap(row, seg)}
          title={opts.title}
          className={cn(
            "flex h-11 w-full min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none transition-shadow disabled:cursor-default",
            watched
              ? "shadow-[inset_0_0_0_2px_var(--foreground)] font-semibold"
              : value != null && canWatch
                ? "hover:shadow-[inset_0_0_0_2px_var(--foreground)]"
                : ""
          )}
        >
          {value == null ? (
            <span className="text-faint">—</span>
          ) : delta != null ? (
            <>
              <span className={cn("text-[12.5px]", opts.suspect ? "text-muted-foreground" : "text-foreground")}>
                {formatSignedDeltaSec(delta)}
              </span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">{fmt(value)}</span>
            </>
          ) : (
            // The reference has nothing here to measure against: the time, quietly, no gap.
            <span className="text-[12.5px] text-muted-foreground" title="Nothing to compare against here">
              {fmt(value)}
            </span>
          )}
        </button>
      </td>
    );
  };

  /** A reference cell: the plain time. Tapping it plays THEIR sector, with yours as the ghost. */
  const refCell = (key: string, t: SegmentTime | null, seg: Watch["seg"], canWatch = true) => {
    const watched = isWatched("ref", seg);
    return (
      <td key={key} className="border-b border-border p-0 align-middle">
        <button
          type="button"
          disabled={t == null || !canWatch}
          onClick={() => tap("ref", seg)}
          className={cn(
            "flex h-11 w-full min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none transition-shadow disabled:cursor-default",
            watched
              ? "shadow-[inset_0_0_0_2px_var(--foreground)] font-semibold"
              : t != null && canWatch
                ? "hover:shadow-[inset_0_0_0_2px_var(--foreground)]"
                : ""
          )}
        >
          {t == null ? (
            <span className="text-faint">—</span>
          ) : (
            <>
              <span className="text-[12.5px] text-foreground">{fmt(t.sec)}</span>
              {ref && ref.lapNumber == null ? (
                <span className="mt-0.5 text-[10px] text-muted-foreground">L{t.lapNumber}</span>
              ) : null}
            </>
          )}
        </button>
      </td>
    );
  };

  const sumOf = (xs: Array<number | null>) =>
    xs.every((v): v is number => v != null) ? xs.reduce((s, v) => s + v, 0) : null;
  const myIdeal = idealLap(meStats);
  const myAvgSum = sumOf(meStats.map((st) => st.top5));
  const overlayAvgSum = overlay ? sumOf(overlayStats.map((st) => st.top5)) : null;

  const lapTotalCell = (key: string, value: number | null, refValue: number | null, watched: boolean) => {
    const delta = value != null && refValue != null ? value - refValue : null;
    return (
      <td
        key={key}
        className={cn("border-b border-border/60 p-0 align-middle", watched && "shadow-[inset_0_0_0_2px_var(--foreground)]")}
        style={delta != null ? getDeltaStyle(delta, tintRange) : undefined}
      >
        <span className="flex h-11 min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none">
          {value == null ? (
            <span className="text-faint">—</span>
          ) : delta != null ? (
            <>
              <span className="text-[12.5px] text-foreground">{formatSignedDeltaSec(delta)}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">{fmt(value)}</span>
            </>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">{fmt(value)}</span>
          )}
        </span>
      </td>
    );
  };

  const table = (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-secondary/40">
            <th className="sticky left-0 z-[2] border-b border-r border-border bg-secondary px-2.5 py-2 text-left micro-caps text-faint">
              Your laps
            </th>
            {segments.map((s) => (
              <th key={s.key} className="border-b border-border px-2.5 py-2 text-right micro-caps text-faint">
                {s.name}
                <span className="block text-[9.5px] font-normal normal-case tracking-normal text-faint">
                  {s.fromLabel} → {s.toLabel}
                </span>
              </th>
            ))}
            <th className="border-b border-border px-2.5 py-2 text-right micro-caps text-faint">Lap</th>
          </tr>
        </thead>
        <tbody>
          {/* The reference, pinned above your laps: the lap every cell below is read against. */}
          {ref ? (
            <tr className="bg-secondary/60">
              <th
                scope="row"
                className="sticky left-0 z-[1] border-b border-r border-border bg-secondary p-0 text-left align-middle"
              >
                <button
                  type="button"
                  disabled={!ref.window}
                  onClick={() => tap("ref", "lap")}
                  className={cn(
                    "flex h-11 w-full flex-col items-start justify-center px-2.5 text-left tabular-nums leading-none transition-shadow disabled:cursor-default",
                    isWatched("ref", "lap")
                      ? "shadow-[inset_0_0_0_2px_var(--foreground)]"
                      : ref.window
                        ? "hover:shadow-[inset_0_0_0_2px_var(--foreground)]"
                        : ""
                  )}
                  title={ref.window ? "Watch the whole lap" : undefined}
                >
                  <span className="text-[12.5px] font-semibold text-foreground">{ref.label}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {ref.mine ? "your best lap · the reference" : "the reference"}
                  </span>
                </button>
              </th>
              {ref.cells.map((c, i) => refCell(`ref-${i}`, c, i))}
              <td className="border-b border-border p-0 align-middle">
                <span className="flex h-11 min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none">
                  {ref.total == null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className="text-[12.5px] font-semibold text-foreground">{fmt(ref.total)}</span>
                  )}
                </span>
              </td>
            </tr>
          ) : null}
          {meRows.map((row) => {
            const isBest = myBest?.lapNumber === row.lapNumber;
            const lapWatched = isWatched(row.lapNumber, "lap");
            // Your best lap IS the reference when nobody is chosen: it shows plain, no gap to itself.
            const self = ref?.mine && ref.lapNumber === row.lapNumber;
            return (
              <tr key={row.lapNumber}>
                <th
                  scope="row"
                  className="sticky left-0 z-[1] border-b border-r border-border/60 bg-card p-0 text-left align-middle"
                >
                  <button
                    type="button"
                    onClick={() => tap(row.lapNumber, "lap")}
                    className={cn(
                      "flex h-11 w-full flex-col items-start justify-center px-2.5 text-left tabular-nums leading-none transition-shadow",
                      lapWatched
                        ? "shadow-[inset_0_0_0_2px_var(--foreground)]"
                        : "hover:shadow-[inset_0_0_0_2px_var(--foreground)]"
                    )}
                    title="Watch the whole lap"
                  >
                    <span className="text-[12.5px] font-semibold text-foreground">
                      L{row.lapNumber} · {fmt(row.lapTimeSec)}
                    </span>
                    {isBest ? <span className="mt-0.5 text-[10px] text-muted-foreground">best lap</span> : null}
                  </button>
                </th>
                {row.cells.map((c, i) =>
                  cell(`${row.lapNumber}-${i}`, c?.sec ?? null, self ? null : (ref?.cells[i]?.sec ?? null), row.lapNumber, i, {
                    suspect: c?.suspect,
                    title: c?.suspect
                      ? "A quarter off your own median here — left out of the figures"
                      : undefined,
                  })
                )}
                {lapTotalCell(`${row.lapNumber}-lap`, row.lapTimeSec, self ? null : (ref?.total ?? null), lapWatched)}
              </tr>
            );
          })}
          {/* Your best through each sector — each one a real lap, so each one plays. */}
          <tr className="bg-secondary/50">
            <th
              scope="row"
              className="sticky left-0 z-[1] border-r border-border bg-secondary px-2.5 text-left align-middle"
            >
              <span className="block text-[12px] font-medium text-muted-foreground">Best sectors</span>
              <span className="block text-[10px] text-faint">yours, any lap</span>
            </th>
            {myIdeal.cells.map((c, i) => cell(`best-${i}`, c?.sec ?? null, ref?.cells[i]?.sec ?? null, "best", i))}
            {lapTotalCell("best-lap", myIdeal.total, ref?.total ?? null, false)}
          </tr>
          {/* Race pace, as numbers: your top-5 average against theirs. Nothing to watch here —
              an average is not a lap. */}
          <tr className="bg-secondary/50">
            <th
              scope="row"
              className="sticky left-0 z-[1] border-r border-border bg-secondary px-2.5 text-left align-middle"
            >
              <span className="block text-[12px] font-medium text-muted-foreground">Top-{TOP_N} avg</span>
              {overlay ? <span className="block text-[10px] text-faint">vs {overlay.name}&apos;s</span> : null}
            </th>
            {meStats.map((st, i) =>
              cell(`avg-${i}`, st.top5, overlay ? (overlayStats[i]?.top5 ?? null) : null, "best", i, { canWatch: false })
            )}
            {lapTotalCell("avg-lap", myAvgSum, overlayAvgSum, false)}
          </tr>
        </tbody>
      </table>
    </div>
  );

  // ---- controls ----------------------------------------------------------------------------
  // Their laps, quickest first, for the chip row. Only laps with a crossing on them.
  const theirLapChips = overlay
    ? [...overlayRows]
        .filter((r) => r.cells.some(Boolean))
        .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
        .slice(0, 12)
    : [];
  const activeRefLap = ref && !ref.mine ? ref.lapNumber : null;

  const controls = (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="w-16 shrink-0 micro-caps text-faint">Against</span>
        <button
          type="button"
          onClick={() => {
            setOverlayKey(null);
            setRefPick(null);
            setWatch(null);
            setSwapped(false);
          }}
          className={cn(chipToggleClass(overlay == null), "px-2.5 py-1 text-[11px]")}
        >
          My best lap
        </button>
        {rivals.map((r) => {
          const ideal = idealLap(statsOf(r)).total;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setOverlayKey(r.key);
                setRefPick(null);
                setWatch(null);
                setSwapped(false);
              }}
              className={cn(chipToggleClass(overlayKey === r.key), "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px]")}
            >
              <span>{r.name}</span>
              {r.trust === "assigned" ? (
                <Flag className="h-3 w-3 text-faint" aria-label="not confirmed — placed by the field matching" />
              ) : null}
              {ideal != null ? <span className="text-[10px] text-faint">{fmt(ideal)} ideal</span> : null}
            </button>
          );
        })}
        {rivals.length === 0 ? (
          <span className="text-[11.5px] text-muted-foreground">Nobody else has sector crossings on this video yet.</span>
        ) : null}
      </div>
      {overlay ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-16 shrink-0 micro-caps text-faint">Their lap</span>
          <button
            type="button"
            onClick={() => {
              setRefPick("ideal");
              setWatch(null);
              setSwapped(false);
            }}
            className={cn(chipToggleClass(refPick === "ideal"), "px-2.5 py-1 text-[11px]")}
          >
            Best sectors
          </button>
          {theirLapChips.map((r) => (
            <button
              key={r.lapNumber}
              type="button"
              onClick={() => {
                setRefPick(r.lapNumber);
                setWatch(null);
                setSwapped(false);
              }}
              className={cn(
                chipToggleClass(refPick !== "ideal" && activeRefLap === r.lapNumber),
                "px-2.5 py-1 text-[11px] tabular-nums"
              )}
            >
              L{r.lapNumber} · {fmt(r.lapTimeSec)}
              {overlayBest?.lapNumber === r.lapNumber ? <span className="ml-1 text-[10px] text-faint">best</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {/* The leaderboard as a line: who holds each sector on the average. Tap one and that
          driver's best through it is what plays, against your best through it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="w-16 shrink-0 micro-caps text-faint">Fastest</span>
        {leaders.map((l, i) =>
          l ? (
            <button
              key={segments[i]!.key}
              type="button"
              onClick={() => {
                setSwapped(false);
                if (l.driver.role === "me") {
                  setWatch({ row: "best", seg: i });
                  return;
                }
                const best = statFor(l.driver, segments[i]!).best;
                setOverlayKey(l.driver.key);
                setRefPick(best?.lapNumber ?? null);
                setWatch({ row: "ref", seg: i });
              }}
              className={cn(
                "inline-flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 text-[11px] tabular-nums hover:shadow-[inset_0_0_0_1px_var(--foreground)]",
                l.driver.role === "me"
                  ? "border-foreground/40 bg-muted text-foreground"
                  : "border-border bg-secondary text-foreground"
              )}
            >
              <span className="micro-caps text-faint">{segments[i]!.name}</span>
              <span>{l.driver.role === "me" ? "You" : l.driver.name}</span>
              <span className="text-muted-foreground">{fmt(l.sec)}</span>
            </button>
          ) : null
        )}
      </div>
    </div>
  );

  return (
    // The player across the whole page, the sheet under it (founder call 2026-09-02: "make the
    // compare page video take up the whole width — put the table below"). The player is still
    // capped by the window's height inside `SectorClipPlayer`, so the controls stay on screen.
    <div className="space-y-3">
      {player}
      {controls}
      {meRows.length ? (
        table
      ) : (
        <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-[12px] text-muted-foreground">
          Your laps have no sector crossings yet.
        </p>
      )}
      {/* The explanatory caption under the board came off on 2026-08-29 (founder call): the
          colours, the outlined cells and the flag say it on the sheet itself. */}
    </div>
  );
}
