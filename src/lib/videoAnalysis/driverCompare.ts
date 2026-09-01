/**
 * Driver-vs-driver sector compare from one video (SECTOR_COMPARE_NORTH_STAR, step 1).
 *
 * "You could pick a few drivers and get the best or average of each sector and be able to watch
 * it — then you're not judging on an outlier. Here's where I'm on average slower, here's where
 * I'm on average faster, why? And who did the best of this sector — click on it, watch how they
 * did it." — the driver, 2026-08-28.
 *
 * What a driver's sector is here: every lap's time between two consecutive lines, from the
 * crossings the video gave us. The headline is the **top-5 average** (mean of the five fastest
 * clean laps — race pace, the ruling he reversed to after using the prototype); best lap is the
 * toggle. A lap more than a quarter off that driver's own median for the segment is a detection
 * artefact or a crash and is kept out of both.
 *
 * Who has sectors: the two drivers the video was read for, from their marks; and everyone else
 * the field matching handed crossings to along the way — partial, unconfirmed by any tap, and
 * said so (`trust: "assigned"`). Same video only: the systematic errors cancel, nothing needs
 * calibrating.
 */

import type { SectorLineInfo } from "@/lib/manualVideoAnalysis/sectors";
import { primaryTimingSession } from "@/lib/manualVideoAnalysis/sessionModel";
import { predictSfStartTime } from "@/lib/manualVideoAnalysis/sync";
import type { ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { assignToField, type FieldDriver } from "./findCrossings/field";
import { realLaps, SF_LINE_KEY, targetId } from "./findCrossings/fromSession";
import type { RefinableResult } from "./findCrossings/refine";
import { EVEN_SEGMENT_THRESHOLD_SEC, type SegmentWindow } from "./lapCompare";
import { compareCarsFromManualSession } from "./manualCompareAdapter";

export type CompareBasis = "top5" | "best";

/** "confirmed": the driver's car was tapped and scanned. "assigned": the field matching's word. */
export type DriverTrust = "confirmed" | "assigned";

export type DriverLap = {
  lapNumber: number;
  lapTimeSec: number;
  /** Video time of the lap's start line crossing. */
  startSec: number;
  endSec: number;
  /** lineKey -> seconds after the lap start (cumulative split). */
  splits: Record<string, number>;
};

export type CompareDriver = {
  key: string;
  name: string;
  role?: "me" | "competitor";
  trust: DriverTrust;
  laps: DriverLap[];
};

export type SegmentDef = {
  key: string;
  /** "S1", "S2", … in track order — the sector that ENDS at that line. */
  name: string;
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
};

export type SegmentTime = {
  lapNumber: number;
  sec: number;
  window: SegmentWindow;
  /** More than a quarter off this driver's own median for the segment. */
  suspect: boolean;
};

export type SegmentStats = {
  times: SegmentTime[];
  /** Laps that count. */
  clean: SegmentTime[];
  /** Mean of the five fastest clean laps (fewer when fewer exist). Null with nothing clean. */
  top5: number | null;
  best: SegmentTime | null;
  median: number | null;
  sd: number | null;
};

export type StoryCard = {
  segment: SegmentDef;
  rival: CompareDriver;
  /** Mine minus theirs on the basis: positive = I am slower. */
  deltaSec: number;
  mine: number;
  theirs: number;
  sentence: string;
};

/** How many clean laps the average is taken over. */
export const TOP_N = 5;
/** A segment time this far off the driver's own median for the segment is not a lap. */
export const SUSPECT_FRACTION = 0.25;

const SF_SHORT = "SF";

function shortLabel(line: SectorLineInfo): string {
  return line.lineKey === SF_LINE_KEY ? SF_SHORT : line.label;
}

/** The segments between consecutive lines, start line to start line, in track order. */
export function segmentDefs(lines: SectorLineInfo[]): SegmentDef[] {
  const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
  const sf = sorted.find((l) => l.lineKey === SF_LINE_KEY);
  const corners = sorted.filter((l) => l.lineKey !== SF_LINE_KEY);
  if (!sf || corners.length === 0) return [];
  const seq = [sf, ...corners, sf];
  const out: SegmentDef[] = [];
  for (let i = 0; i + 1 < seq.length; i++) {
    const from = seq[i]!;
    const to = seq[i + 1]!;
    out.push({
      key: `${i === 0 ? "start" : from.lineKey}-${i + 1 === seq.length - 1 ? "end" : to.lineKey}`,
      name: `S${i + 1}`,
      fromKey: i === 0 ? "start" : from.lineKey,
      toKey: i + 1 === seq.length - 1 ? "end" : to.lineKey,
      fromLabel: shortLabel(from),
      toLabel: shortLabel(to),
    });
  }
  return out;
}

function splitOf(lap: DriverLap, key: string): number | undefined {
  if (key === "start") return 0;
  if (key === "end") return lap.lapTimeSec;
  return lap.splits[key];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Every lap's time through one segment for one driver, with the artefacts flagged. */
export function segmentStats(driver: CompareDriver, seg: SegmentDef): SegmentStats {
  const raw: Array<Omit<SegmentTime, "suspect">> = [];
  for (const lap of driver.laps) {
    const a = splitOf(lap, seg.fromKey);
    const b = splitOf(lap, seg.toKey);
    if (a == null || b == null || !(b > a)) continue;
    raw.push({
      lapNumber: lap.lapNumber,
      sec: b - a,
      window: { startSec: lap.startSec + a, endSec: lap.startSec + b },
    });
  }
  if (raw.length === 0) return { times: [], clean: [], top5: null, best: null, median: null, sd: null };
  const med = median(raw.map((r) => r.sec));
  const times: SegmentTime[] = raw.map((r) => ({
    ...r,
    suspect: Math.abs(r.sec - med) > SUSPECT_FRACTION * med,
  }));
  const clean = times.filter((t) => !t.suspect).sort((x, y) => x.sec - y.sec);
  const top = clean.slice(0, TOP_N);
  const top5 = top.length ? top.reduce((s, t) => s + t.sec, 0) / top.length : null;
  const cleanMed = clean.length ? median(clean.map((t) => t.sec)) : null;
  const sd =
    clean.length > 1 && cleanMed != null
      ? Math.sqrt(clean.reduce((s, t) => s + (t.sec - cleanMed) ** 2, 0) / (clean.length - 1))
      : null;
  return { times, clean, top5, best: clean[0] ?? null, median: cleanMed, sd };
}

/** The figure a cell shows on the chosen basis. */
export function valueOn(stats: SegmentStats, basis: CompareBasis): number | null {
  return basis === "top5" ? stats.top5 : (stats.best?.sec ?? null);
}

/** The lap whose clip stands for the figure: the best clean lap either way. */
export function lapBehind(stats: SegmentStats): SegmentTime | null {
  return stats.best;
}

function driverKey(d: { key: string; role: string }): string {
  return d.role === "other" ? d.key : d.role;
}

/** Names come off the timing site shouting and bracketed; the screen should not. */
export function displayName(raw: string): string {
  const s = raw.replace(/^\[|\]$/g, "").trim();
  if (!s) return "Driver";
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Everyone this video can say something about.
 *
 * The two scanned drivers come from their marks (the same path the lap compare uses). The rest
 * come from the saved scan: every candidate every window saw, given back to the field matching,
 * which hands each one to the driver who was due there. A rival's lap is on the video clock by
 * the shared race anchor, exactly as the scan placed them.
 */
export function buildCompareDrivers(
  session: ManualVideoSessionV2,
  lines: SectorLineInfo[]
): CompareDriver[] {
  const primary = primaryTimingSession(session);
  if (!primary) return [];

  const out: CompareDriver[] = [];
  const cars = compareCarsFromManualSession(session, lines);
  for (const car of cars) {
    const role = car.carId === 1 ? "me" : "competitor";
    const d = primary.drivers.find((x) => x.role === role);
    out.push({
      key: role,
      name: role === "me" ? "You" : displayName(d?.driverName ?? car.carLabel),
      role,
      trust: "confirmed",
      laps: car.laps.map((l) => ({
        lapNumber: l.lapIndex,
        lapTimeSec: l.lapTimeSec,
        startSec: l.startSec,
        endSec: l.endSec,
        splits: l.splits,
      })),
    });
  }

  // The rest of the field, from the saved scan. Nothing without a race anchor: without it a
  // rival's laps are not on the video clock at all.
  const rows = session.lastScan?.rows ?? [];
  if (rows.length && primary.isOnVideo && primary.sync.anchor) {
    const field: FieldDriver[] = [];
    for (const d of primary.drivers) {
      const lapStarts: FieldDriver["lapStarts"] = [];
      for (const lap of realLaps(d.laps)) {
        const s = predictSfStartTime(d, lap.lapNumber, primary);
        if (s != null) lapStarts.push({ lapNumber: lap.lapNumber, startSec: s });
      }
      if (lapStarts.length) {
        field.push({
          key: driverKey(d),
          name: d.driverName,
          role: d.role === "other" ? undefined : d.role,
          lapStarts,
        });
      }
    }
    const results: RefinableResult[] = rows.map((r) => ({
      id: targetId(r.driverRole, r.lapNumber, r.lineKey),
      lineKey: r.lineKey,
      lapNumber: r.lapNumber,
      centerSec: r.videoTimeSec ?? r.candidates[0]?.t ?? 0,
      detectedSec: r.videoTimeSec,
      quality: null,
      candidates: r.candidates,
      source: r.source ?? "unconfirmed",
    }));
    const assignment = assignToField({ results, field, sfKey: SF_LINE_KEY });

    for (const d of primary.drivers) {
      if (d.role !== "other") continue;
      const fd = field.find((f) => f.key === d.key);
      if (!fd) continue;
      const byLap = new Map<number, Record<string, number>>();
      for (const [line, xs] of assignment.fieldCrossings) {
        for (const x of xs) {
          if (x.key !== d.key) continue;
          const start = fd.lapStarts.find((l) => l.lapNumber === x.lapNumber)?.startSec;
          if (start == null) continue;
          const split = x.t - start;
          if (!(split > 0)) continue;
          const splits = byLap.get(x.lapNumber) ?? {};
          // Two candidates for one slot cannot happen (one slot, one candidate); guard anyway.
          if (splits[line] == null) splits[line] = split;
          byLap.set(x.lapNumber, splits);
        }
      }
      const laps: DriverLap[] = [];
      for (const lap of realLaps(d.laps)) {
        const splits = byLap.get(lap.lapNumber);
        const startSec = fd.lapStarts.find((l) => l.lapNumber === lap.lapNumber)?.startSec;
        if (!splits || startSec == null || !(lap.lapTimeSec > 0)) continue;
        laps.push({
          lapNumber: lap.lapNumber,
          lapTimeSec: lap.lapTimeSec,
          startSec,
          endSec: startSec + lap.lapTimeSec,
          splits,
        });
      }
      if (laps.length) {
        out.push({ key: d.key, name: displayName(d.driverName), trust: "assigned", laps });
      }
    }
  }

  return out.sort((a, b) => {
    if (a.role === "me") return -1;
    if (b.role === "me") return 1;
    if (a.trust !== b.trust) return a.trust === "confirmed" ? -1 : 1;
    return b.laps.length - a.laps.length;
  });
}

/* ------------------------------------------------------------------------------------------
 * The stint sheet (2026-08-28 evening, "there should only ever be one block of times… a base
 * that's blank, and an overlay that's coloured, never more than one table, only one driver's
 * table at a time"). Same grammar as the lap sheet: the BASE is you and stays flat; the OVERLAY
 * is one driver whose laps fill the table, every cell tinted by its gap to the base.
 * ---------------------------------------------------------------------------------------- */

/** What "you" means on the sheet: your top-5 average, your best lap, or your same lap number. */
export type BaseKind = "top5" | "best" | "same";

export type LapRow = {
  lapNumber: number;
  lapTimeSec: number;
  /** The whole lap on the video clock. */
  window: SegmentWindow;
  /** One per segment in track order; null where a crossing is missing. */
  cells: Array<SegmentTime | null>;
  /** Every segment present and none of them suspect: a lap that can be a reference. */
  clean: boolean;
};

/** One row per lap, lap order, from the per-segment stats (`segmentStats` for every segment). */
export function lapRows(driver: CompareDriver, segStats: SegmentStats[]): LapRow[] {
  return [...driver.laps]
    .sort((a, b) => a.lapNumber - b.lapNumber)
    .map((lap) => {
      const cells = segStats.map((st) => st.times.find((t) => t.lapNumber === lap.lapNumber) ?? null);
      return {
        lapNumber: lap.lapNumber,
        lapTimeSec: lap.lapTimeSec,
        window: { startSec: lap.startSec, endSec: lap.endSec },
        cells,
        clean: cells.every((c) => c != null && !c.suspect),
      };
    });
}

/** The quickest clean lap — the one "best lap" means everywhere on the sheet. */
export function bestLap(rows: LapRow[]): LapRow | null {
  let best: LapRow | null = null;
  for (const r of rows) if (r.clean && (best == null || r.lapTimeSec < best.lapTimeSec)) best = r;
  return best;
}

/**
 * The base figure for each segment, for the overlay's lap `lapNumber` (only "same" cares).
 * Null where the base has nothing there — a cell then shows "—" rather than a made-up gap.
 */
export function baseValues(
  kind: BaseKind,
  meStats: SegmentStats[],
  meRows: LapRow[],
  lapNumber: number | null
): Array<number | null> {
  if (kind === "top5") return meStats.map((st) => st.top5);
  const row = kind === "best" ? bestLap(meRows) : meRows.find((r) => r.lapNumber === lapNumber) ?? null;
  return meStats.map((_, i) => row?.cells[i]?.sec ?? null);
}

/** The base's whole-lap figure on the same terms; null when any segment is missing. */
export function baseLapTotal(
  kind: BaseKind,
  meStats: SegmentStats[],
  meRows: LapRow[],
  lapNumber: number | null
): number | null {
  if (kind === "top5") {
    const vals = meStats.map((st) => st.top5);
    return vals.every((v): v is number => v != null) ? vals.reduce((s, v) => s + v, 0) : null;
  }
  const row = kind === "best" ? bestLap(meRows) : meRows.find((r) => r.lapNumber === lapNumber) ?? null;
  return row?.lapTimeSec ?? null;
}

export type GhostClip = { lapNumber: number; sec: number; window: SegmentWindow };

/**
 * The clip that stands for the base in the player. A single lap is itself; an average has no
 * footage, so it plays your clean lap closest to that average — for one segment the closest
 * segment time, for a whole lap the closest lap time.
 */
export function ghostClip(
  kind: BaseKind,
  meStats: SegmentStats[],
  meRows: LapRow[],
  seg: number | "lap",
  lapNumber: number | null
): GhostClip | null {
  const fromRow = (row: LapRow | null): GhostClip | null => {
    if (!row) return null;
    if (seg === "lap") return { lapNumber: row.lapNumber, sec: row.lapTimeSec, window: row.window };
    const c = row.cells[seg];
    return c ? { lapNumber: c.lapNumber, sec: c.sec, window: c.window } : null;
  };
  if (kind === "best") return fromRow(bestLap(meRows));
  if (kind === "same") return fromRow(meRows.find((r) => r.lapNumber === lapNumber) ?? null);
  if (seg === "lap") {
    const target = baseLapTotal("top5", meStats, meRows, null);
    if (target == null) return null;
    let pick: LapRow | null = null;
    for (const r of meRows) {
      if (!r.clean) continue;
      if (pick == null || Math.abs(r.lapTimeSec - target) < Math.abs(pick.lapTimeSec - target)) pick = r;
    }
    return fromRow(pick);
  }
  const st = meStats[seg];
  if (!st || st.top5 == null) return null;
  let pick: SegmentTime | null = null;
  for (const t of st.clean) {
    if (pick == null || Math.abs(t.sec - st.top5) < Math.abs(pick.sec - st.top5)) pick = t;
  }
  return pick ? { lapNumber: pick.lapNumber, sec: pick.sec, window: pick.window } : null;
}

export type SectorLeader = { driver: CompareDriver; sec: number };

/** Who holds each sector on the top-5 average — the leaderboard as one chip per sector. */
export function sectorLeaders(
  drivers: CompareDriver[],
  segments: SegmentDef[],
  stats: (d: CompareDriver, s: SegmentDef) => SegmentStats
): Array<SectorLeader | null> {
  return segments.map((s) => {
    let lead: SectorLeader | null = null;
    for (const d of drivers) {
      const v = stats(d, s).top5;
      if (v != null && (lead == null || v < lead.sec)) lead = { driver: d, sec: v };
    }
    return lead;
  });
}

function fmt(sec: number): string {
  return `${Math.abs(sec).toFixed(3)}s`;
}

/**
 * Where each rival beats you and where you beat them, biggest first. Even sectors (within
 * `EVEN_SEGMENT_THRESHOLD_SEC`) are kept — quiet rows on the screen — but sort last.
 */
export function storyCards(
  me: CompareDriver,
  rivals: CompareDriver[],
  segments: SegmentDef[],
  basis: CompareBasis
): StoryCard[] {
  const cards: StoryCard[] = [];
  for (const rival of rivals) {
    for (const segment of segments) {
      const mine = valueOn(segmentStats(me, segment), basis);
      const theirs = valueOn(segmentStats(rival, segment), basis);
      if (mine == null || theirs == null) continue;
      const deltaSec = mine - theirs;
      const per = basis === "top5" ? " a lap" : "";
      const sentence =
        deltaSec <= -EVEN_SEGMENT_THRESHOLD_SEC
          ? `You take ${fmt(deltaSec)}${per} out of ${rival.name} through ${segment.name}`
          : deltaSec >= EVEN_SEGMENT_THRESHOLD_SEC
            ? `${rival.name} takes ${fmt(deltaSec)}${per} out of you through ${segment.name}`
            : `${segment.name} is even with ${rival.name}`;
      cards.push({ segment, rival, deltaSec, mine, theirs, sentence });
    }
  }
  return cards.sort((a, b) => Math.abs(b.deltaSec) - Math.abs(a.deltaSec));
}
