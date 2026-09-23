/**
 * LAPS — every lap of every driver in the timed sessions the driver was in, as the Engineer
 * reads them (founder call 2026-09-22: "the results and every lap time of every driver so that
 * it can interpret it with all the information that a person would have if they went through
 * and looked").
 *
 * Measured before building (production, the founder's busiest day — SA State Titles Saturday,
 * 15 sessions, 761 laps): about 5,400 characters, ~1,700 tokens. The KB alone is ~14K tokens, so
 * a whole day's laps is small change, and a three-day meeting is ~2,400 tokens.
 *
 * Under each driver a few figures are worked out HERE, in code, from those same laps — the model
 * is bad at adding up 18 laps × 10 drivers in its head, and a confident wrong number is worse than
 * none. Round 06 proved it (2026-09-23): the one figure left to the model — the founder's last five
 * laps against Tim Hilyear's over five heats — came back 0.91 when it is 0.68, "where am I losing
 * time to Tim" missed a 1.3 s first lap, and the answers never knew who won a heat. So the block
 * also works out what a person reads off a results page and a lap chart: the finishing order and
 * gaps where the laps carry it, the average without slow laps, the first and last five, how the
 * other drivers moved against their own day (the track), and — when the question names a driver —
 * the two of you lap by lap. It still gets the raw laps: the lap they binned, the two-lap dip after
 * a marshal, are things a person reads off the list.
 *
 * Facts only. Nothing here says how to read a session; a wrong answer is a wrong or missing
 * fact on this block (north star §5, "driver data ships as facts, never instructions").
 *
 * Pure: no server imports, so the tests feed it hand-made sessions.
 */
import { isBelievableBest } from "@/lib/engineer/fieldPace";

export type LapsDriver = {
  name: string;
  /** The driver asking — their chip, their saved timing-site name, or a lap-for-lap match. */
  isMe: boolean;
  laps: number[];
};

export type LapsSession = {
  /** "A2-Main", "Heat 2", "Practice" — what the timing site called it, shortened. */
  label: string;
  className: string | null;
  /** The track's clock, "10:42"; null when the timing site gave no time. */
  clock: string | null;
  dateYmd: string;
  /** Every driver on the sheet, in the sheet's own order. Practice is one driver: the asker. */
  drivers: LapsDriver[];
  /** The driver's run this sheet belongs to, when there is one. */
  linkedRunId?: string | null;
};

/** Past this many sessions the earliest are dropped and the block says so. */
export const MAX_LAPS_SESSIONS = 40;
/** A ceiling on the block's size — ~9K tokens — so a long range can never crowd the KB out. */
export const MAX_LAPS_CHARS = 30_000;

/**
 * A lap far SHORTER than the driver's own median is not a lap: a race result's first lap is the
 * run from the grid to the line (7.11 in an 18-second class on the founder's SA sheet), and a
 * cut is the same shape. The list still shows it; the figures leave it out.
 */
export const PARTIAL_LAP_FRACTION = 0.6;
/**
 * A lap more than this over the driver's own median is a mistake, a marshal or a stop — a slow
 * lap. It stays in the total and the best five minutes, and out of the average without slow laps.
 * On the founder's SA heats every lap he or a rival binned sat 7–18% over; a clean lap within 2%.
 */
export const SLOW_LAP_FRACTION = 0.05;

const fmt = (v: number): string => v.toFixed(2);
const fmtDelta = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

/** 312.46 → "5:12.46". */
function fmtTotal(seconds: number): string {
  const r = Math.round(seconds * 100) / 100;
  const m = Math.floor(r / 60);
  return `${m}:${(r - m * 60).toFixed(2).padStart(5, "0")}`;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest-rank percentile of a sorted list. */
function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

type LapKind = "short" | "slow" | "lap";

/**
 * Each lap's kind, in the order driven. Short: under PARTIAL_LAP_FRACTION of the median, or a best
 * more than the RIVALS table's slack (fieldPace.ts `isBelievableBest`: 0.75 s or 4%) quicker than
 * the driver's next-best lap — Rhys Marshall's 16.17 opening lap in an 18.2 heat, 1.81 clear of his
 * 17.98. Measured against the next-best lap, not a best five or three: a six-lap race with two crash
 * laps, or a warm-up practice run, puts slow laps in any average and made real laps look impossible.
 * And only when that next-best lap is itself an ordinary one (no slower than the median): Tomas
 * Buratovich's two-lap heat, 18.51 then a 24.55 crash, has no lap to judge the 18.51 against.
 * Slow: over the median of the real laps by more than SLOW_LAP_FRACTION.
 */
function classifyLaps(laps: readonly number[]): LapKind[] {
  const valid = laps.map((v) => Number.isFinite(v) && v > 0);
  const values = laps.filter((_, i) => valid[i]);
  if (values.length === 0) return laps.map(() => "short");
  const floor = (median(values) as number) * PARTIAL_LAP_FRACTION;
  const short = new Set<number>();
  laps.forEach((v, i) => {
    if (!valid[i] || v < floor) short.add(i);
  });
  for (let pass = 0; pass < 2; pass++) {
    const kept = laps.map((v, i) => ({ v, i })).filter(({ i }) => !short.has(i));
    if (kept.length < 3) break;
    const sorted = [...kept].sort((a, b) => a.v - b.v);
    if (sorted[1].v > (median(kept.map((x) => x.v)) as number)) break;
    if (isBelievableBest(sorted[0].v, sorted[1].v)) break;
    short.add(sorted[0].i);
  }
  const real = laps.filter((_, i) => !short.has(i));
  const slowOver = real.length > 0 ? (median(real) as number) * (1 + SLOW_LAP_FRACTION) : Infinity;
  return laps.map((v, i) => (short.has(i) ? "short" : v > slowOver ? "slow" : "lap"));
}

export type LapsFigures = {
  /** Every lap on the sheet, short ones included — what the timing site counts. */
  lapCount: number;
  /** The sum of every lap, short ones included: the driver's time for the session. */
  total: number;
  best: number;
  top5: number;
  median: number;
  /** Mean of the laps that are neither short nor slow; null when none are left. */
  cleanAverage: number | null;
  /** The slow laps, in the order driven. */
  slowLaps: number[];
  /**
   * Median of the first five and of the last five real laps; null under ten. With how many of each
   * five were slow laps, said beside them: Tim Hilyear's three slow laps at the end of the founder's
   * last SA heat made his "last five" 20.05, which read as fade. Leaving slow laps out instead cost
   * the other question — "where am I losing time" then lost the 1.3 s first lap (2026-09-23).
   */
  firstFive: number | null;
  lastFive: number | null;
  lastFiveVsFirstFive: number | null;
  slowInFirstFive: number;
  slowInLastFive: number;
  /** 90th-percentile lap minus 10th-percentile lap; null under five laps. */
  spread: number | null;
  /** How many real laps the figures are made of — a best five needs five. */
  counted: number;
  /** Laps left out of every figure but the total — from the grid, a cut, a timing glitch. */
  shortLaps: number;
};

/** The figures under a driver's laps. Null when there are no real laps. */
export function lapsFigures(laps: readonly number[]): LapsFigures | null {
  const kinds = classifyLaps(laps);
  const real = laps.filter((_, i) => kinds[i] !== "short");
  if (real.length === 0) return null;
  const sorted = [...real].sort((a, b) => a - b);
  const clean = laps.filter((_, i) => kinds[i] === "lap");
  const realKinds = kinds.filter((k) => k !== "short");
  const firstFive = real.length >= 10 ? median(real.slice(0, 5)) : null;
  const lastFive = real.length >= 10 ? median(real.slice(-5)) : null;
  const all = laps.filter((v) => Number.isFinite(v) && v > 0);
  return {
    lapCount: all.length,
    total: all.reduce((a, b) => a + b, 0),
    best: sorted[0],
    top5: mean(sorted.slice(0, Math.min(5, sorted.length))),
    median: median(real) as number,
    cleanAverage: clean.length > 0 ? mean(clean) : null,
    slowLaps: laps.filter((_, i) => kinds[i] === "slow"),
    firstFive,
    lastFive,
    lastFiveVsFirstFive: firstFive != null && lastFive != null ? lastFive - firstFive : null,
    slowInFirstFive: real.length >= 10 ? realKinds.slice(0, 5).filter((k) => k === "slow").length : 0,
    slowInLastFive: real.length >= 10 ? realKinds.slice(-5).filter((k) => k === "slow").length : 0,
    spread: real.length >= 5 ? percentile(sorted, 0.9) - percentile(sorted, 0.1) : null,
    counted: real.length,
    shortLaps: all.length - real.length,
  };
}

type Row = { driver: LapsDriver; figures: LapsFigures | null; place: number | null; gap: string | null };

/**
 * The finishing order where the laps carry it: most laps, then least time. A race with a short
 * lap on anyone's sheet keeps no places — a lap from the grid is not the same distance for every
 * car, so laps and time no longer rank them — and the drivers stay in the sheet's order.
 */
function placeRows(s: LapsSession): { rows: Row[]; placed: boolean } {
  const rows: Row[] = s.drivers.map((d) => ({ driver: d, figures: lapsFigures(d.laps), place: null, gap: null }));
  if (rows.length < 2 || rows.some((r) => !r.figures || r.figures.shortLaps > 0)) return { rows, placed: false };
  const sorted = [...rows].sort(
    (a, b) => b.figures!.lapCount - a.figures!.lapCount || a.figures!.total - b.figures!.total
  );
  const win = sorted[0].figures!;
  sorted.forEach((r, i) => {
    r.place = i + 1;
    if (i === 0) return;
    const down = win.lapCount - r.figures!.lapCount;
    r.gap = down > 0 ? `${down} lap${down === 1 ? "" : "s"} down` : `+${(r.figures!.total - win.total).toFixed(2)}`;
  });
  return { rows: sorted, placed: true };
}

const nameKey = (name: string): string => name.trim().toUpperCase().replace(/\s+/g, " ");

/**
 * For each race session: the other drivers' best five that session against their own average best
 * five across that day's races, the middle of them. People who drove the same track at the same
 * time, each measured against themselves, so a quick driver and a slow one count alike. Needs a
 * day of three races or more, a driver in three of them with a full race in each (ten real laps —
 * a six-lap heat that ended in crashes puts crash laps in the best five and skews that driver's
 * whole day), and three such drivers in the session.
 */
function trackMoves(sessions: readonly LapsSession[]): Map<LapsSession, { move: number; drivers: number }> {
  const out = new Map<LapsSession, { move: number; drivers: number }>();
  const byDay = new Map<string, LapsSession[]>();
  for (const s of sessions) {
    if (s.drivers.length < 2) continue;
    if (!byDay.has(s.dateYmd)) byDay.set(s.dateYmd, []);
    byDay.get(s.dateYmd)!.push(s);
  }
  for (const day of byDay.values()) {
    if (day.length < 3) continue;
    const top5 = new Map<string, Map<LapsSession, number>>();
    for (const s of day) {
      for (const d of s.drivers) {
        if (d.isMe) continue;
        const f = lapsFigures(d.laps);
        if (!f || f.counted < 10) continue;
        const k = nameKey(d.name);
        if (!top5.has(k)) top5.set(k, new Map());
        top5.get(k)!.set(s, f.top5);
      }
    }
    const dayAverage = new Map<string, number>();
    for (const [k, m] of top5) if (m.size >= 3) dayAverage.set(k, mean([...m.values()]));
    for (const s of day) {
      const deltas: number[] = [];
      for (const [k, avg] of dayAverage) {
        const v = top5.get(k)!.get(s);
        if (v != null) deltas.push(v - avg);
      }
      if (deltas.length >= 3) out.set(s, { move: median(deltas) as number, drivers: deltas.length });
    }
  }
  return out;
}

/**
 * The track's movement per race, keyed by the driver's run on that sheet — what the day block
 * takes out of a tyre set's run-to-run change. The same figure the LAPS block prints.
 */
export function lapsTrackMoveByRun(sessions: readonly LapsSession[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [s, m] of trackMoves(sessions)) if (s.linkedRunId) out.set(s.linkedRunId, m.move);
  return out;
}

/** " (2 slow)" beside a five with slow laps in it; nothing beside a clean five. */
function slowNote(n: number): string {
  return n > 0 ? ` (${n} slow)` : "";
}

function renderDriver(r: Row): string[] {
  const d = r.driver;
  // A practice page names nobody: its one driver is the asker, and "you" is the whole name.
  const who = d.isMe ? (d.name.trim().toLowerCase() === "you" ? "you" : `${d.name} (you)`) : d.name;
  const f = r.figures;
  if (!f) return [`  ${who}: no laps`];
  const place = r.place != null ? `P${r.place} ` : "";
  const result = `${f.lapCount} lap${f.lapCount === 1 ? "" : "s"} ${fmtTotal(f.total)}${r.gap ? `, ${r.gap}` : ""}`;
  const figures = [
    `best ${fmt(f.best)}`,
    `top5 ${fmt(f.top5)}`,
    `median ${fmt(f.median)}`,
    f.cleanAverage != null && f.slowLaps.length > 0 ? `average without slow laps ${fmt(f.cleanAverage)}` : f.cleanAverage != null ? `average ${fmt(f.cleanAverage)}` : null,
    f.firstFive != null && f.lastFive != null
      ? `first five ${fmt(f.firstFive)}${slowNote(f.slowInFirstFive)} → last five ${fmt(f.lastFive)}${slowNote(f.slowInLastFive)} (${fmtDelta(f.lastFive - f.firstFive)})`
      : null,
    f.spread != null ? `spread ${fmt(f.spread)}` : null,
    f.slowLaps.length > 0 ? `slow lap${f.slowLaps.length === 1 ? "" : "s"} ${f.slowLaps.map(fmt).join(", ")}` : null,
    f.shortLaps > 0 ? `${f.shortLaps} short lap${f.shortLaps === 1 ? "" : "s"} left out` : null,
  ].filter(Boolean);
  return [`  ${place}${who} · ${result}: ${d.laps.map(fmt).join(" ")}`, `      ${figures.join(" · ")}`];
}

function renderSession(
  s: LapsSession,
  multiDay: boolean,
  move: { move: number; drivers: number } | undefined
): string[] {
  const n = s.drivers.length;
  const { rows, placed } = placeRows(s);
  const head = [
    multiDay ? s.dateYmd : null,
    s.clock ?? "time unknown",
    `${s.label}${s.className ? ` · ${s.className}` : ""}`,
    `(${n} driver${n === 1 ? "" : "s"}${n > 1 ? (placed ? ", in finishing order" : ", no places: a short lap on the sheet") : ""})`,
    move ? `the other drivers against their own day ${fmtDelta(move.move)} (${move.drivers} drivers)` : null,
  ]
    .filter(Boolean)
    .join("  ");
  return [head, ...rows.flatMap(renderDriver)];
}

/**
 * You against one named driver, lap by lap, over every session you both drove: your lap minus
 * theirs and the running total, then the session's first five, last five and average without slow
 * laps side by side — and those three averaged across the sessions, so nobody has to add fifty
 * laps up in their head.
 */
function renderVs(sessions: readonly LapsSession[], rival: LapsRival, multiDay: boolean): string[] {
  const key = nameKey(rival.name);
  const shared = sessions
    .map((s) => ({ s, me: s.drivers.find((d) => d.isMe), them: s.drivers.find((d) => !d.isMe && nameKey(d.name) === key) }))
    .filter((x): x is { s: LapsSession; me: LapsDriver; them: LapsDriver } => x.me != null && x.them != null);
  if (shared.length === 0) return [];
  const theirName = shared[0].them.name;
  const lines: string[] = [
    `YOU AGAINST ${theirName} ("${rival.word}" in the question), LAP BY LAP — the ${shared.length} session${shared.length === 1 ? "" : "s"} you both drove, worked out in code. "Your lap minus theirs" is lap by lap (negative = you were quicker that lap); the running total adds those up (negative = you were ahead over those laps); "—" is a short lap on either side, left out of the total.`,
    "",
  ];
  const firsts: number[] = [];
  const lasts: number[] = [];
  const cleans: number[] = [];
  for (const { s, me, them } of shared) {
    const fm = lapsFigures(me.laps);
    const ft = lapsFigures(them.laps);
    const { rows, placed } = placeRows(s);
    const rowOf = (d: LapsDriver) => rows.find((r) => r.driver === d);
    const result = (d: LapsDriver, f: LapsFigures | null) =>
      f ? `${placed && rowOf(d)?.place != null ? `P${rowOf(d)!.place} ` : ""}${f.lapCount} laps ${fmtTotal(f.total)}` : "no laps";
    lines.push(
      `${[multiDay ? s.dateYmd : null, s.clock ?? "time unknown", s.label].filter(Boolean).join("  ")} — you ${result(me, fm)}; ${theirName} ${result(them, ft)}`
    );
    const km = classifyLaps(me.laps);
    const kt = classifyLaps(them.laps);
    const per: string[] = [];
    const running: string[] = [];
    let total = 0;
    for (let i = 0; i < Math.min(me.laps.length, them.laps.length); i++) {
      if (km[i] === "short" || kt[i] === "short") {
        per.push("—");
        running.push("—");
        continue;
      }
      const gap = me.laps[i] - them.laps[i];
      total += gap;
      per.push(fmtDelta(gap));
      running.push(fmtDelta(total));
    }
    lines.push(`  your lap minus theirs: ${per.join(" ")}`);
    lines.push(`  running total:         ${running.join(" ")}`);
    const side: string[] = [];
    if (fm?.firstFive != null && ft?.firstFive != null) {
      firsts.push(fm.firstFive - ft.firstFive);
      side.push(`first five ${fmt(fm.firstFive)}${slowNote(fm.slowInFirstFive)} v ${fmt(ft.firstFive)}${slowNote(ft.slowInFirstFive)} (${fmtDelta(fm.firstFive - ft.firstFive)})`);
    }
    if (fm?.lastFive != null && ft?.lastFive != null) {
      lasts.push(fm.lastFive - ft.lastFive);
      side.push(`last five ${fmt(fm.lastFive)}${slowNote(fm.slowInLastFive)} v ${fmt(ft.lastFive)}${slowNote(ft.slowInLastFive)} (${fmtDelta(fm.lastFive - ft.lastFive)})`);
    }
    if (fm?.cleanAverage != null && ft?.cleanAverage != null) {
      cleans.push(fm.cleanAverage - ft.cleanAverage);
      side.push(`average without slow laps ${fmt(fm.cleanAverage)} v ${fmt(ft.cleanAverage)} (${fmtDelta(fm.cleanAverage - ft.cleanAverage)})`);
    }
    if (side.length > 0) lines.push(`  ${side.join(" · ")}`);
  }
  if (shared.length > 1) {
    const avg = (xs: number[], what: string) => (xs.length > 0 ? `${what} ${fmtDelta(mean(xs))} over ${xs.length}` : null);
    const across = [
      avg(firsts, "first five"),
      avg(lasts, "last five"),
      avg(cleans, "average without slow laps"),
    ].filter(Boolean);
    if (across.length > 0) lines.push("", `Averaged across the sessions, you minus ${theirName}: ${across.join(" · ")}.`);
  }
  return lines;
}

/** A driver the question named, as their name appears on the sheets, and the word that named them. */
export type LapsRival = { name: string; word: string };

/** Every name on the multi-driver sheets but the asker's — what a question's named driver is matched against. */
export function lapsRivalNames(sessions: readonly LapsSession[]): string[] {
  const names = new Map<string, string>();
  for (const s of sessions) {
    if (s.drivers.length < 2) continue;
    for (const d of s.drivers) if (!d.isMe && d.name.trim()) names.set(nameKey(d.name), d.name);
  }
  return [...names.values()];
}

/**
 * The block. `scopeLabel` names what the sessions were taken from — "12 Sep 2026 at Radio
 * Racing Cars SA", or the range's own label. `rival` is a driver the question named: you against
 * them lap by lap closes the block. Null when there is nothing to show.
 */
export function renderLapsBlock(
  sessions: readonly LapsSession[],
  scopeLabel: string,
  opts: { rival?: LapsRival | null } = {}
): string | null {
  const withLaps = sessions.filter((s) => s.drivers.some((d) => d.laps.length > 0));
  if (withLaps.length === 0) return null;

  // Earliest first, like every other block; when over the caps the EARLIEST go, so the
  // sessions nearest the question survive.
  let kept = withLaps.slice(-MAX_LAPS_SESSIONS);
  const multiDay = new Set(kept.map((s) => s.dateYmd)).size > 1;
  const moves = trackMoves(kept);
  const bodyOf = (list: LapsSession[]) => list.flatMap((s) => [...renderSession(s, multiDay, moves.get(s)), ""]);
  let body = bodyOf(kept);
  while (kept.length > 1 && body.join("\n").length > MAX_LAPS_CHARS) {
    kept = kept.slice(1);
    body = bodyOf(kept);
  }
  const dropped = withLaps.length - kept.length;
  const anyUnmatched = kept.some((s) => s.drivers.length > 1 && !s.drivers.some((d) => d.isMe));
  const anyPractice = kept.some((s) => s.drivers.length === 1);
  const anyMoves = kept.some((s) => moves.has(s));
  const vs = opts.rival ? renderVs(kept, opts.rival, multiDay) : [];

  return [
    `LAPS — every lap of every driver in the timed sessions you were in, ${scopeLabel}. Sessions earliest first; laps in the order they were driven; the clock is the track's.${dropped > 0 ? ` The ${dropped} earliest session${dropped === 1 ? " is" : "s are"} not shown.` : ""}`,
    `Worked out in code from those laps, for each driver: laps and total time; best; the average of the best 5; the median; the average without slow laps; the median of the first five laps → of the last five (positive = slower at the end), with "(2 slow)" where slow laps sit inside a five; and the spread, the 90th-percentile lap minus the 10th.`,
    `A short lap — under ${Math.round(PARTIAL_LAP_FRACTION * 100)}% of that driver's median, or a best more than 0.75 s (or 4%) quicker than their next-best lap — is a race's opening lap from the grid, a cut or a timing glitch: listed, and left out of every figure but the total. A slow lap — more than ${Math.round(SLOW_LAP_FRACTION * 100)}% over that driver's median — is a mistake, a marshal or a stop: listed, and left out of the average without slow laps only; the total time and the day's "5min" figure carry every one.`,
    `Where no driver in a race has a short lap, the drivers are in finishing order — most laps, then least time — with their place and their gap to the winner; a race with a short lap on the sheet gets no places.`,
    ...(anyMoves
      ? [
          `"The other drivers against their own day": each other driver's best five in that race against their own average best five over the day's races, the middle of them (negative = quicker than their day). They drove the same track at the same time, so it is the track's movement — and their own tyres'.`,
        ]
      : []),
    ...(anyPractice
      ? [`A session with one driver is a practice session: the timing site keeps practice one driver per page, so only your own laps are here.`]
      : []),
    ...(anyUnmatched
      ? [`A session with more than one driver and no "(you)" is a sheet on which your row could not be told apart by name or chip.`]
      : []),
    "",
    ...body,
    ...(vs.length > 0 ? vs : []),
  ]
    .join("\n")
    .trimEnd();
}
