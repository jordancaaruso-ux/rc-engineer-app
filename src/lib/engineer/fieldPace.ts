/**
 * Your pace against the rest of the field, per run — the one comparison that cancels the
 * track's own movement, because everyone in the session drove the same surface at the same
 * time (founder call 2026-09-14: "relative laptimes to everyone else — that would be where
 * the real value is").
 *
 * The figures come from the timing sheet the run was imported from (`fieldStatsJson` on the
 * ImportedLapTimeSession — every entrant's best, top 5, top 10, written on import and by the
 * backfill script). Nothing is re-derived from the model's side: rank, gap to the fastest
 * driver, gap to the field's MEDIAN, all arithmetic done here. Sign convention is the app's:
 * positive = slower than the reference (you minus them). The middle of the field is a median,
 * never a mean — one broken transponder would drag a mean across the whole session — and the
 * fields have said so since 2026-09-18; they were named `…ToMean` while holding a median.
 *
 * The pure part (`fieldPaceFromStats`) has no server imports so the block builders' tests
 * can feed it hand-made sheets; the loader below is server-only.
 */
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";
import type { ImportedSessionFieldStatsV1 } from "@/lib/lapImport/computeImportedSessionFieldStats";

export type FieldPace = {
  /** Entrants with a believable best lap in the session. */
  n: number;
  /** 1 = fastest best lap in the session. */
  rank: number | null;
  /** Your best lap minus the fastest driver's best lap; 0.00 = you were fastest. */
  gapBestToP1: number | null;
  /** Your top-5 average minus the best top-5 average in the field. */
  gapTop5ToP1: number | null;
  /** Your best lap minus the field's median best lap; negative = faster than the middle of the field. */
  gapBestToMedian: number | null;
  /** Your top-5 average minus the field's median top-5 average; the debrief's "vs field median". */
  gapTop5ToMedian: number | null;
  /**
   * Every entrant on the sheet, you included, so a named rival can be compared run by run
   * (rivals.ts). `cut` = a best lap implausibly under that driver's own top-5 (a cut or a
   * timing glitch); such a row is shown but never averaged.
   */
  entrants: FieldEntrant[];
};

export type FieldEntrant = {
  name: string;
  isMe: boolean;
  best: number | null;
  top5: number | null;
  cut: boolean;
};

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * A best lap far under the same driver's own top-5 average is a cut or a timing glitch (a 12.66
 * in a 15.9 field, seen on a real sheet), not pace. It is dropped from the P1 reference and the
 * rank rather than handed to the Engineer as "3.2 s off the front".
 */
function believableBest(d: { bestLapSeconds: number | null; avgTop5Seconds: number | null }): boolean {
  if (!finite(d.bestLapSeconds)) return false;
  if (!finite(d.avgTop5Seconds)) return true;
  return isBelievableBest(d.bestLapSeconds, d.avgTop5Seconds);
}

/**
 * The slack for "that best lap is not pace", shared with the LAPS block (lapsBlock.ts) so the laps
 * and the RIVALS table judge a lap the same way: a best more than max(0.75 s, 4%) under a reference —
 * here the same driver's own best-five average (the stored stats carry no laps); the LAPS block,
 * which has every lap, measures against the next three. Rhys Marshall's 16.17 opening lap in an 18.2 heat (SA,
 * 2026-09-12) was left out here and counted as his best in the laps — the Engineer then skipped his
 * real 17.98 and got his practice gap wrong.
 */
export function isBelievableBest(best: number, avgTop5: number): boolean {
  const slack = Math.max(0.75, avgTop5 * 0.04);
  return best >= avgTop5 - slack;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function signed(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${r.toFixed(2)}` : r < 0 ? `-${Math.abs(r).toFixed(2)}` : "0.00";
}

/**
 * A best lap's rank on its sheet in words — "quickest of 10", "3rd-quickest of 12" — never "P1/10".
 * The LAPS block prints finishing places ("P1 TIMOTHY HILYEAR" — he won the SA 15:31 heat), and
 * beside it the driver's "P1/5" by best lap read as the result: the Engineer told the founder Tim
 * had him by 0.01 on best lap, when he was 0.01 quicker (round 06h, 2026-09-23).
 */
export function lapRankShort(f: Pick<FieldPace, "rank" | "n">): string | null {
  if (f.rank == null) return null;
  return f.rank === 1 ? `quickest of ${f.n}` : `${ordinal(f.rank)}-quickest of ${f.n}`;
}

/**
 * "quickest lap of 7, 0.30 clear" / "3rd-quickest lap of 12, +0.21 to the quickest". Worked from the
 * laps as the Engineer sees them, to the hundredth: from the timing site's thousandths, a 17.76 against
 * a 17.77 in the LAPS block came out "0.02 clear" here.
 */
export function lapRankWords(f: FieldPace): string | null {
  if (f.gapBestToP1 == null || f.rank == null) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const mine = f.entrants.find((e) => e.isMe)?.best ?? null;
  const others = f.entrants
    .filter((e) => !e.isMe && !e.cut && e.best != null)
    .map((e) => e.best as number)
    .sort((a, b) => a - b);
  if (f.rank === 1) {
    const clear = mine != null && others.length > 0 ? `, ${(r2(others[0]) - r2(mine)).toFixed(2)} clear` : "";
    return `quickest lap of ${f.n}${clear}`;
  }
  const gap = mine != null && others.length > 0 ? r2(mine) - r2(others[0]) : f.gapBestToP1;
  return `${ordinal(f.rank)}-quickest lap of ${f.n}, ${signed(gap)} to the quickest`;
}

function lapsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.0005) return false;
  return true;
}

/**
 * Pick "you" out of the sheet — the saved primary lap-set name first, then a lap-for-lap match
 * against the run's own laps, then the parser convention that the primary driver is stored
 * first (the same three steps the race-field view uses) — and measure the gaps.
 * Null when the session has fewer than two timed entrants.
 *
 * `guessFirstDriver: false` drops the third step: no name or lap match, no field. The debrief
 * reads it that way because on the founder's own sheets the first stored driver was the heat
 * winner, not him, on 6 of 51 heats (probe 2026-09-15). The Engineer keeps the guess.
 */
export function fieldPaceFromStats(
  stats: ImportedSessionFieldStatsV1,
  primaryNorms: readonly string[],
  runLaps: readonly number[],
  lapsByDriverId?: ReadonlyMap<string, number[]>,
  opts?: { guessFirstDriver?: boolean }
): FieldPace | null {
  const drivers = stats.drivers.filter(believableBest);
  if (drivers.length < 2) return null;

  let mine = primaryNorms.length
    ? drivers.find((d) => {
        const n = normalizeLiveRcDriverNameForMatch(d.driverName);
        return primaryNorms.some((p) => p === n || p === d.normalizedName);
      })
    : undefined;
  if (!mine && lapsByDriverId && runLaps.length > 0) {
    mine = drivers.find((d) => lapsEqual(lapsByDriverId.get(d.driverId) ?? [], runLaps as number[]));
  }
  if (!mine && opts?.guessFirstDriver !== false) {
    mine = stats.drivers[0] && believableBest(stats.drivers[0]) ? stats.drivers[0] : undefined;
  }
  if (!mine) return null;

  const bests = drivers.map((d) => d.bestLapSeconds as number);
  const top5s = drivers.map((d) => d.avgTop5Seconds).filter(finite);
  const minBest = Math.min(...bests);
  const medBest = median(bests) as number;
  const minTop5 = top5s.length ? Math.min(...top5s) : null;
  const medTop5 = median(top5s);
  const myBest = mine.bestLapSeconds as number;
  const myTop5 = finite(mine.avgTop5Seconds) ? mine.avgTop5Seconds : null;

  const me = mine;
  return {
    n: drivers.length,
    rank: bests.filter((b) => b < myBest - 1e-9).length + 1,
    gapBestToP1: myBest - minBest,
    gapTop5ToP1: myTop5 != null && minTop5 != null ? myTop5 - minTop5 : null,
    gapBestToMedian: myBest - medBest,
    gapTop5ToMedian: myTop5 != null && medTop5 != null ? myTop5 - medTop5 : null,
    entrants: stats.drivers
      .filter((d) => finite(d.bestLapSeconds) || finite(d.avgTop5Seconds))
      .map((d) => ({
        name: d.driverName,
        isMe: d === me,
        best: finite(d.bestLapSeconds) ? d.bestLapSeconds : null,
        top5: finite(d.avgTop5Seconds) ? d.avgTop5Seconds : null,
        cut: !believableBest(d),
      })),
  };
}
