"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Flag } from "lucide-react";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { SectorClipPlayer } from "@/components/videoAnalysis/SectorClipPlayer";
import { getDeltaStyle, resolveDeltaTintRange } from "@/lib/lapAnalysis";
import type { SectorLineInfo } from "@/lib/manualVideoAnalysis/sectors";
import type { ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { cn } from "@/lib/utils";
import {
  baseLapTotal,
  baseValues,
  bestLap,
  buildCompareDrivers,
  ghostClip,
  lapRows,
  sectorLeaders,
  segmentDefs,
  segmentStats,
  TOP_N,
  type BaseKind,
  type CompareDriver,
  type GhostClip,
  type SegmentDef,
  type SegmentStats,
  type SegmentTime,
} from "@/lib/videoAnalysis/driverCompare";
import { formatSignedDeltaSec, type SegmentWindow } from "@/lib/videoAnalysis/lapCompare";

/**
 * The sector board (SECTOR_COMPARE_NORTH_STAR, reworked 2026-08-28 evening over five artifact
 * rounds): the video at the top, ONE table under it.
 *
 * The table is the lap sheet's grammar. The BASE is you — your top-5 average, your best lap, or
 * your same lap number — and it never wears a colour. The OVERLAY is one driver, or nobody: their
 * laps fill the rows and every cell is tinted by its gap to the base. Never two drivers, never two
 * tables. Tap a sector cell to watch that sector, tap a lap time to watch the whole lap; the
 * overlay driver is solid and the base is the ghost, every time, so there is never a question of
 * which car is you. "Fastest" above the table is the leaderboard boiled down to one chip per
 * sector — tap it and that driver becomes the overlay with their best through it loaded.
 */

type Watch = {
  driverKey: string;
  /** A lap number, or the footer rows: the driver's best through the sector / their average pace. */
  lap: number | "best" | "avg";
  /** A segment index, or the whole lap. */
  seg: number | "lap";
};

type Clip = { label: string; sec: number; window: SegmentWindow; lapNumber: number };

const BASE_LABEL: Record<BaseKind, string> = {
  top5: `your top-${TOP_N} average`,
  best: "your best lap",
  same: "your same lap",
};

function fmt(sec: number): string {
  return sec.toFixed(3);
}

/** The clean lap whose time through the segment is closest to the driver's top-5 average. */
function closestToAverage(st: SegmentStats): SegmentTime | null {
  if (st.top5 == null) return null;
  let pick: SegmentTime | null = null;
  for (const t of st.clean) {
    if (pick == null || Math.abs(t.sec - st.top5) < Math.abs(pick.sec - st.top5)) pick = t;
  }
  return pick;
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

  const [base, setBase] = useState<BaseKind>("top5");
  // The confirmed rival is the overlay from the start; "None" is your own laps, plain.
  const [overlayKey, setOverlayKey] = useState<string | null>(
    () => (rivals.find((r) => r.trust === "confirmed") ?? rivals[0])?.key ?? null
  );
  const [watch, setWatch] = useState<Watch | null>(null);
  const [swapped, setSwapped] = useState(false);

  const overlay = overlayKey ? (rivals.find((r) => r.key === overlayKey) ?? null) : null;
  const shownDriver = overlay ?? me;

  const meStats = useMemo(() => (me ? segments.map((s) => stats.get(`${me.key}|${s.key}`)!) : []), [me, stats, segments]);
  const meRows = useMemo(() => (me ? lapRows(me, meStats) : []), [me, meStats]);
  const shownStats = useMemo(
    () => (shownDriver ? segments.map((s) => stats.get(`${shownDriver.key}|${s.key}`)!) : []),
    [shownDriver, stats, segments]
  );
  const shownRows = useMemo(() => (shownDriver ? lapRows(shownDriver, shownStats) : []), [shownDriver, shownStats]);
  const shownBest = useMemo(() => bestLap(shownRows), [shownRows]);
  const myBest = useMemo(() => bestLap(meRows), [meRows]);
  const leaders = useMemo(
    () => sectorLeaders(drivers, segments, (d, s) => stats.get(`${d.key}|${s.key}`)!),
    [drivers, segments, stats]
  );

  // The tint scale comes from the gaps actually on the sheet, as the lap sheet does it.
  const tintRange = useMemo(() => {
    if (!overlay) return 0;
    const deltas: number[] = [];
    for (const row of shownRows) {
      const b = baseValues(base, meStats, meRows, row.lapNumber);
      row.cells.forEach((c, i) => {
        const bv = b[i];
        if (c && !c.suspect && bv != null) deltas.push(c.sec - bv);
      });
    }
    return resolveDeltaTintRange(deltas);
  }, [overlay, shownRows, base, meStats, meRows]);

  if (!me || !shownDriver || segments.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <span className="type-data-label">Sector board</span>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {segments.length === 0
            ? "Draw at least one sector line besides the start line to compare sectors."
            : "Your laps have no sector crossings yet — mark or scan them first."}
        </p>
      </div>
    );
  }

  // ---- what plays ------------------------------------------------------------------------
  // Nothing tapped yet: the overlay's best lap, whole. The player is the headline and never
  // sits empty while there is a lap to show.
  // No clean lap (a sector missing on every lap): the quickest lap with anything on it.
  const defaultRow =
    shownBest ??
    [...shownRows].filter((r) => r.cells.some(Boolean)).sort((a, b) => a.lapTimeSec - b.lapTimeSec)[0] ??
    shownRows[0] ??
    null;
  const shown: Watch | null =
    watch && watch.driverKey === shownDriver.key
      ? watch
      : defaultRow
        ? { driverKey: shownDriver.key, lap: defaultRow.lapNumber, seg: "lap" }
        : null;

  const who = shownDriver.role === "me" ? "You" : shownDriver.name;

  const solid: Clip | null = (() => {
    if (!shown) return null;
    if (shown.lap === "best" || shown.lap === "avg") {
      if (shown.seg === "lap") return null;
      const st = shownStats[shown.seg];
      const t = shown.lap === "best" ? (st?.best ?? null) : st ? closestToAverage(st) : null;
      return t ? { label: `${who} L${t.lapNumber}`, sec: t.sec, window: t.window, lapNumber: t.lapNumber } : null;
    }
    const row = shownRows.find((r) => r.lapNumber === shown.lap);
    if (!row) return null;
    if (shown.seg === "lap") {
      return { label: `${who} L${row.lapNumber}`, sec: row.lapTimeSec, window: row.window, lapNumber: row.lapNumber };
    }
    const c = row.cells[shown.seg];
    return c ? { label: `${who} L${c.lapNumber}`, sec: c.sec, window: c.window, lapNumber: c.lapNumber } : null;
  })();

  // The ghost is the base, on the same terms as the cell: the footer rows compare best to best
  // and average to average; a lap row compares to whatever the base chip says. Watching your own
  // laps with no overlay, the ghost avoids being the same clip twice.
  const ghost: { clip: GhostClip; label: string } | null = (() => {
    if (!shown || !solid) return null;
    const seg = shown.seg;
    let g: GhostClip | null = null;
    let label = BASE_LABEL[base];
    if (shown.lap === "best" && seg !== "lap") {
      const t = meStats[seg]?.best ?? null;
      g = t ? { lapNumber: t.lapNumber, sec: t.sec, window: t.window } : null;
      label = "your best through it";
    } else if (shown.lap === "avg" && seg !== "lap") {
      g = ghostClip("top5", meStats, meRows, seg, null);
      label = BASE_LABEL.top5;
    } else {
      g = ghostClip(base, meStats, meRows, seg, typeof shown.lap === "number" ? shown.lap : null);
    }
    if (g && !overlay && g.lapNumber === solid.lapNumber) {
      // Same lap both sides: take the next best of yours instead.
      if (seg === "lap") {
        const alt = meRows
          .filter((r) => r.clean && r.lapNumber !== solid.lapNumber)
          .sort((a, b) => a.lapTimeSec - b.lapTimeSec)[0];
        g = alt ? { lapNumber: alt.lapNumber, sec: alt.lapTimeSec, window: alt.window } : null;
      } else {
        const alt = meStats[seg]?.clean.find((t) => t.lapNumber !== solid.lapNumber) ?? null;
        g = alt ? { lapNumber: alt.lapNumber, sec: alt.sec, window: alt.window } : null;
      }
      label = "your next best";
    }
    return g ? { clip: g, label } : null;
  })();

  const segName = shown && shown.seg !== "lap" ? (segments[shown.seg]?.name ?? "") : "whole lap";
  // The gap from your side, whatever is solid: with an overlay it is you (the ghost) minus them;
  // on your own laps it is this lap minus your base. Positive = you are slower = red.
  const gap = solid && ghost ? (overlay ? ghost.clip.sec - solid.sec : solid.sec - ghost.clip.sec) : null;
  const solidTicks =
    shown && solid && shown.seg === "lap" && typeof shown.lap === "number"
      ? shownRows
          .find((r) => r.lapNumber === shown.lap)
          ?.cells.slice(0, -1)
          .flatMap((c) => (c ? [c.window.endSec - solid.window.startSec] : []))
      : undefined;

  const ghostAsClip: Clip | null = ghost
    ? { label: `You L${ghost.clip.lapNumber}`, sec: ghost.clip.sec, window: ghost.clip.window, lapNumber: ghost.clip.lapNumber }
    : null;
  const aClip = swapped && ghostAsClip ? ghostAsClip : solid;
  const bClip = swapped && ghostAsClip ? solid : ghostAsClip;

  const player = (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
      {aClip && videoUrl ? (
        <SectorClipPlayer
          videoUrl={videoUrl}
          aWindow={aClip.window}
          bWindow={bClip?.window ?? aClip.window}
          aLabel={`${aClip.label} · ${fmt(aClip.sec)}`}
          bLabel={bClip ? `${bClip.label} · ${fmt(bClip.sec)}` : "—"}
          fit="window"
          ticks={swapped ? undefined : solidTicks}
        />
      ) : aClip ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          Attach the video to watch this.
        </p>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          Tap any time in the table to watch it.
        </p>
      )}
      {aClip ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <div className="min-w-0 space-y-0.5 text-[12px] leading-snug">
            <p>
              <span className="micro-caps text-faint">Solid</span>{" "}
              <span className="font-semibold text-foreground">{aClip.label}</span>
              <span className="text-muted-foreground">
                {" "}
                · {segName} · {fmt(aClip.sec)}
              </span>
            </p>
            <p>
              <span className="micro-caps text-faint">Ghost</span>{" "}
              {bClip ? (
                <>
                  <span className="font-semibold text-foreground">
                    {swapped ? bClip.label : `${ghost!.label} (L${bClip.lapNumber})`}
                  </span>
                  <span className="text-muted-foreground"> · {fmt(bClip.sec)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">nothing of yours to ghost here</span>
              )}
            </p>
            {gap != null && solid ? (
              <p
                className={cn(
                  "fig-stat tabular-nums",
                  gap > 0 ? "text-destructive" : gap < 0 ? "text-gain" : "text-muted-foreground"
                )}
              >
                {formatSignedDeltaSec(gap)}
                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                  {overlay
                    ? `you're ${gap > 0 ? "slower" : gap < 0 ? "faster" : "level"} than ${solid.label} here`
                    : `${solid.label} is ${gap > 0 ? "slower" : gap < 0 ? "faster" : "level"} than ${ghost!.label}`}
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
  const isWatched = (lap: Watch["lap"], seg: Watch["seg"]) => shown != null && shown.lap === lap && shown.seg === seg;

  const tap = (lap: Watch["lap"], seg: Watch["seg"]) => {
    setSwapped(false);
    setWatch({ driverKey: shownDriver.key, lap, seg });
  };

  /** One cell: the overlay's gap to the base, tinted; or your own plain time with no overlay. */
  const cell = (
    key: string,
    value: number | null,
    baseValue: number | null,
    lap: Watch["lap"],
    seg: Watch["seg"],
    opts: { suspect?: boolean; title?: string } = {}
  ) => {
    // Read from YOUR side: base − theirs, so positive = you are slower here = red. ("Red should
    // always be user is slower; green looked like I'm fast.")
    const delta = overlay && value != null && baseValue != null ? baseValue - value : null;
    const style = delta != null && !opts.suspect ? getDeltaStyle(delta, tintRange) : undefined;
    const watched = isWatched(lap, seg);
    return (
      <td
        key={key}
        className={cn("border-b border-border/60 p-0 align-middle", opts.suspect && "shadow-[inset_0_0_0_1px_var(--faint)]")}
        style={style}
      >
        <button
          type="button"
          disabled={value == null}
          onClick={() => tap(lap, seg)}
          title={opts.title}
          className={cn(
            "flex h-11 w-full min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none transition-shadow disabled:cursor-default",
            watched
              ? "shadow-[inset_0_0_0_2px_var(--foreground)] font-semibold"
              : value != null
                ? "hover:shadow-[inset_0_0_0_2px_var(--foreground)]"
                : ""
          )}
        >
          {value == null ? (
            <span className="text-faint">—</span>
          ) : overlay && delta != null ? (
            <>
              <span className={cn("text-[12.5px]", opts.suspect ? "text-muted-foreground" : "text-foreground")}>
                {formatSignedDeltaSec(delta)}
              </span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">{fmt(value)}</span>
            </>
          ) : overlay ? (
            // The base has nothing here to measure against: the time, quietly, no gap.
            <span className="text-[12.5px] text-muted-foreground" title="Nothing of yours here to compare against">
              {fmt(value)}
            </span>
          ) : (
            <span className={cn("text-[12.5px]", opts.suspect ? "text-muted-foreground" : "text-foreground")}>
              {fmt(value)}
            </span>
          )}
        </button>
      </td>
    );
  };

  const sumOf = (xs: Array<number | null>) =>
    xs.every((v): v is number => v != null) ? xs.reduce((s, v) => s + v, 0) : null;
  const overlayBestSum = sumOf(shownStats.map((st) => st.best?.sec ?? null));
  const overlayAvgSum = sumOf(shownStats.map((st) => st.top5));
  const myBestSum = sumOf(meStats.map((st) => st.best?.sec ?? null));
  const myAvgSum = baseLapTotal("top5", meStats, meRows, null);

  const footer = (
    label: string,
    sub: string,
    lap: "best" | "avg",
    values: Array<number | null>,
    mine: Array<number | null>,
    sum: number | null,
    mySum: number | null
  ) => (
    <tr className="bg-secondary/50">
      <th
        scope="row"
        className="sticky left-0 z-[1] border-r border-border bg-secondary px-2.5 text-left align-middle"
      >
        <span className="block text-[12px] font-medium text-muted-foreground">{label}</span>
        {overlay ? <span className="block text-[10px] text-faint">{sub}</span> : null}
      </th>
      {values.map((v, i) => cell(`f-${lap}-${i}`, v, mine[i] ?? null, lap, i))}
      <td
        className="p-0 align-middle"
        style={overlay && sum != null && mySum != null ? getDeltaStyle(mySum - sum, tintRange) : undefined}
      >
        <span className="flex h-11 min-w-[5.25rem] flex-col items-end justify-center px-2.5 text-right tabular-nums leading-none">
          {sum == null ? (
            <span className="text-faint">—</span>
          ) : overlay && mySum != null ? (
            <>
              <span className="text-[12.5px] text-foreground">{formatSignedDeltaSec(mySum - sum)}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">{fmt(sum)}</span>
            </>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">{fmt(sum)}</span>
          )}
        </span>
      </td>
    </tr>
  );

  const table = (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-secondary/40">
            <th className="sticky left-0 z-[2] border-b border-r border-border bg-secondary px-2.5 py-2 text-left micro-caps text-faint">
              {overlay ? `${overlay.name}'s laps` : "Your laps"}
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
          {shownRows.map((row) => {
            const b = baseValues(base, meStats, meRows, row.lapNumber);
            const bl = baseLapTotal(base, meStats, meRows, row.lapNumber);
            const isBest = shownBest?.lapNumber === row.lapNumber;
            const lapWatched = isWatched(row.lapNumber, "lap");
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
                  cell(`${row.lapNumber}-${i}`, c?.sec ?? null, b[i] ?? null, row.lapNumber, i, {
                    suspect: c?.suspect,
                    title: c?.suspect
                      ? "A quarter off this driver's own median here — left out of the figures"
                      : undefined,
                  })
                )}
                {cell(`${row.lapNumber}-lap`, row.lapTimeSec, bl, row.lapNumber, "lap", {
                  // A lap with a doubtful sector in it is a doubtful lap; a lap with a missing
                  // crossing is just a lap with a hole.
                  suspect: row.cells.some((c) => c?.suspect),
                })}
              </tr>
            );
          })}
          {footer(
            "Best sectors",
            "vs your best sectors",
            "best",
            shownStats.map((st) => st.best?.sec ?? null),
            meStats.map((st) => st.best?.sec ?? null),
            overlayBestSum,
            myBestSum
          )}
          {footer(
            `Top-${TOP_N} avg`,
            `vs ${BASE_LABEL.top5}`,
            "avg",
            shownStats.map((st) => st.top5),
            meStats.map((st) => st.top5),
            overlayAvgSum,
            myAvgSum
          )}
        </tbody>
      </table>
    </div>
  );

  // ---- controls ----------------------------------------------------------------------------
  const baseChips: Array<{ kind: BaseKind; label: string }> = [
    { kind: "top5", label: `You · top-${TOP_N} average` },
    { kind: "best", label: myBest ? `You · best lap L${myBest.lapNumber}` : "You · best lap" },
    { kind: "same", label: "You · same lap number" },
  ];

  return (
    <div className="space-y-3">
      {player}

      <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-16 shrink-0 micro-caps text-faint">Base</span>
          {baseChips.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => setBase(c.kind)}
              className={cn(chipToggleClass(base === c.kind), "px-2.5 py-1 text-[11px]", !overlay && "opacity-60")}
              title={!overlay ? "With no overlay the base only chooses the ghost" : undefined}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-16 shrink-0 micro-caps text-faint">Overlay</span>
          <button
            type="button"
            onClick={() => {
              setOverlayKey(null);
              setWatch(null);
              setSwapped(false);
            }}
            className={cn(chipToggleClass(overlay == null), "px-2.5 py-1 text-[11px]")}
          >
            None · just my laps
          </button>
          {rivals.map((r) => {
            const ideal = sumOf(statsOf(r).map((st) => st.best?.sec ?? null));
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setOverlayKey(r.key);
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
        {/* The leaderboard as a line: who holds each sector on the average. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="w-16 shrink-0 micro-caps text-faint">Fastest</span>
          {leaders.map((l, i) =>
            l ? (
              <button
                key={segments[i]!.key}
                type="button"
                onClick={() => {
                  setSwapped(false);
                  setOverlayKey(l.driver.role === "me" ? null : l.driver.key);
                  setWatch({ driverKey: l.driver.key, lap: "best", seg: i });
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

      {shownRows.length ? (
        table
      ) : (
        <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-[12px] text-muted-foreground">
          {overlay
            ? `${overlay.name} has no sector crossings on this video yet.`
            : "Your laps have no sector crossings yet."}
        </p>
      )}

      <p className="text-[10.5px] leading-relaxed text-faint">
        {overlay
          ? `Every gap is yours: red = you are slower than ${overlay.name} there (against ${BASE_LABEL[base]}), green = you are faster, deeper = more; the small grey figure is ${overlay.name}'s actual time. `
          : "Your own laps, plain. Pick an overlay to colour the sheet. "}
        An outlined cell is a quarter off the driver&rsquo;s own median there and is left out of the figures.{" "}
        <Flag className="inline h-2.5 w-2.5" aria-hidden /> means nobody tapped that car: their times come
        from what the scan&rsquo;s windows happened to see, and may be partial.
      </p>
    </div>
  );
}
