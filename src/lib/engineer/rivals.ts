/**
 * You against ONE other driver, session by session (founder call 2026-09-14: "I'd want to be
 * able to compare to individual drivers"). Pure: fed the runs' field sheets, prints facts and
 * the arithmetic — never a verdict.
 *
 * Two pieces: a short RIVALS summary the filter block always carries when any run has a field
 * (the drivers you shared the most sessions with, and your average gap to each), and a full
 * VS <driver> section when the question names one. A session where either side's best lap is
 * a cut (fieldPace.ts) is shown, marked, and left out of every average — a 11.48 in a 15.9
 * field would otherwise hand the Engineer a "3 s quicker" that never happened.
 *
 * Sign convention: you minus them, so negative = you were quicker.
 */
import type { FieldEntrant, FieldPace } from "@/lib/engineer/fieldPace";
import { nameTokens } from "@/lib/engineer/nameMatch";

export type RivalRun = {
  dateYmd: string;
  clock: string | null;
  trackName: string | null;
  session: string | null;
  field: FieldPace | null;
};

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
}

function fmtDelta(v: number): string {
  const s = Math.abs(v).toFixed(2);
  return v > 0 ? `+${s}` : v < 0 ? `-${s}` : "0.00";
}

function fmtDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return `${ymd} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}`;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One key per person: "tim hilyear" whatever the sheet's spelling or case. */
export function driverKey(name: string): string {
  return nameTokens(name).join(" ");
}

type Pair = { run: RivalRun; me: FieldEntrant; them: FieldEntrant };

function pairsWith(runs: RivalRun[], key: string): Pair[] {
  const out: Pair[] = [];
  for (const run of runs) {
    if (!run.field) continue;
    const me = run.field.entrants.find((e) => e.isMe);
    const them = run.field.entrants.find((e) => !e.isMe && driverKey(e.name) === key);
    if (me && them) out.push({ run, me, them });
  }
  return out;
}

function clean(p: Pair): boolean {
  return !p.me.cut && !p.them.cut && p.me.best != null && p.them.best != null;
}

function averages(pairs: Pair[]): { n: number; best: number | null; top5: number | null; quicker: number } | null {
  const ok = pairs.filter(clean);
  if (ok.length === 0) return null;
  const dBest = ok.map((p) => (p.me.best as number) - (p.them.best as number));
  const dTop5 = ok.filter((p) => p.me.top5 != null && p.them.top5 != null).map((p) => (p.me.top5 as number) - (p.them.top5 as number));
  return {
    n: ok.length,
    best: mean(dBest),
    top5: dTop5.length ? mean(dTop5) : null,
    quicker: dBest.filter((d) => d < 0).length,
  };
}

/** Every other driver on the runs' sheets, keyed, with their display name as the sheet spells it. */
export function driversOnSheets(runs: RivalRun[]): Array<{ key: string; name: string; sessions: number }> {
  const seen = new Map<string, { name: string; sessions: number }>();
  for (const run of runs) {
    for (const e of run.field?.entrants ?? []) {
      if (e.isMe) continue;
      const key = driverKey(e.name);
      if (!key) continue;
      const cur = seen.get(key);
      if (cur) cur.sessions++;
      else seen.set(key, { name: e.name, sessions: 1 });
    }
  }
  return [...seen.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/** How many rivals the summary names. */
const MAX_RIVALS = 6;

export function renderRivalsSummary(runs: RivalRun[]): string | null {
  const drivers = driversOnSheets(runs).filter((d) => d.sessions >= 2).slice(0, MAX_RIVALS);
  if (drivers.length === 0) return null;
  const lines: string[] = [];
  for (const d of drivers) {
    const avg = averages(pairsWith(runs, d.key));
    if (!avg) continue;
    lines.push(
      `${d.name} — ${d.sessions} shared session${d.sessions === 1 ? "" : "s"}: best lap ${fmtDelta(avg.best as number)} on average${avg.top5 != null ? `, top 5 ${fmtDelta(avg.top5)}` : ""}; you were quicker on best lap in ${avg.quicker} of ${avg.n}${avg.n < d.sessions ? ` (${d.sessions - avg.n} left out for a cut lap)` : ""}`
    );
  }
  if (lines.length === 0) return null;
  return [
    "RIVALS — the drivers who shared the most timed sessions with you in this filter, and your gap to",
    "each (you minus them: negative = you were quicker). Name one to see it session by session.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * VS <driver>: every shared session with both drivers' best and top 5 and the gaps, then the
 * averages and, across more than one day, a line per day.
 */
export function renderRivalSection(runs: RivalRun[], key: string): string | null {
  const pairs = pairsWith(runs, key);
  if (pairs.length === 0) return null;
  const name = pairs[0].them.name;
  const multiTrack = new Set(pairs.map((p) => p.run.trackName)).size > 1;
  const lines = pairs.map(({ run, me, them }) => {
    const bits = [
      fmtDay(run.dateYmd),
      run.clock,
      multiTrack ? (run.trackName ?? "no track") : null,
      run.session,
      `you best ${fmt(me.best)} top5 ${fmt(me.top5)}`,
      `${name} best ${fmt(them.best)} top5 ${fmt(them.top5)}`,
      me.best != null && them.best != null ? `→ best ${fmtDelta(me.best - them.best)}` : null,
      me.top5 != null && them.top5 != null ? `top5 ${fmtDelta(me.top5 - them.top5)}` : null,
      me.cut ? "(your best is a cut lap — not averaged)" : them.cut ? `(${name}'s best is a cut lap — not averaged)` : null,
    ].filter(Boolean);
    return bits.join("  ");
  });

  const avg = averages(pairs);
  const summary = avg
    ? `Across ${avg.n} clean shared session${avg.n === 1 ? "" : "s"}: best lap ${fmtDelta(avg.best as number)} on average${avg.top5 != null ? `, top 5 ${fmtDelta(avg.top5)}` : ""}; you were quicker on best lap in ${avg.quicker} of ${avg.n}.`
    : "No clean shared session — every one has a cut lap on one side.";

  const days = new Map<string, Pair[]>();
  for (const p of pairs) days.set(p.run.dateYmd, [...(days.get(p.run.dateYmd) ?? []), p]);
  const dayLines: string[] = [];
  if (days.size > 1) {
    for (const [day, list] of days) {
      const a = averages(list);
      if (!a) continue;
      dayLines.push(`${fmtDay(day)}: ${a.n} session${a.n === 1 ? "" : "s"}, best ${fmtDelta(a.best as number)}${a.top5 != null ? `, top 5 ${fmtDelta(a.top5)}` : ""}`);
    }
  }

  return [
    `VS ${name.toUpperCase()} — every timed session you both ran in this filter. Gaps are you minus ${name}: negative = you`,
    "were quicker. A session with a cut lap on either side is shown but left out of the averages.",
    "",
    ...lines,
    "",
    summary,
    ...(dayLines.length > 0 ? ["", ...dayLines] : []),
  ].join("\n");
}
