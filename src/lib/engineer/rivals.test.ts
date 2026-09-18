/**
 * Run: `npm run test:engineer-history`.
 *
 * The rival section is the arithmetic a driver would otherwise ask the model to do across
 * thirty sheets — and the cut-lap rule is what keeps a 3-second "gap" that never happened out
 * of the averages.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FieldPace } from "@/lib/engineer/fieldPace";
import { driversOnSheets, renderRivalSection, renderRivalsSummary, type RivalRun } from "@/lib/engineer/rivals";

function sheet(rows: Array<[string, number | null, number | null, boolean?]>): FieldPace {
  return {
    n: rows.length,
    rank: 1,
    gapBestToP1: 0,
    gapTop5ToP1: 0,
    gapBestToMedian: 0,
    gapTop5ToMedian: 0,
    entrants: rows.map(([name, best, top5, cut]) => ({ name, isMe: name === "Me", best, top5, cut: cut ?? false })),
  };
}

function run(dateYmd: string, clock: string, field: FieldPace | null, over: Partial<RivalRun> = {}): RivalRun {
  return { dateYmd, clock, trackName: "SA", session: null, field, ...over };
}

const RUNS: RivalRun[] = [
  run("2026-09-12", "10:00", sheet([["Me", 17.39, 17.58], ["Tim Hilyear", 17.80, 17.89], ["Bob Jones", 18.0, 18.2]])),
  run("2026-09-12", "12:00", sheet([["Me", 17.70, 17.92], ["Tim Hilyear", 17.90, 18.03]])),
  run("2026-09-13", "10:00", sheet([["Me", 11.48, 14.97, true], ["Tim Hilyear", 14.69, 15.97], ["Bob Jones", 15.1, 15.3]])),
  run("2026-09-13", "12:00", null),
];

test("the rivals summary names who you raced most, averaged over clean sessions only", () => {
  const drivers = driversOnSheets(RUNS);
  assert.deepEqual(drivers.map((d) => [d.name, d.sessions]), [["Tim Hilyear", 3], ["Bob Jones", 2]]);
  const s = renderRivalsSummary(RUNS) ?? "";
  assert.match(s, /^RIVALS/);
  // Tim: (17.39-17.80 = -0.41) and (17.70-17.90 = -0.20) → -0.305 → prints -0.30 (the cut session is out); top5 (-0.31, -0.11) → -0.21
  assert.match(s, /Tim Hilyear — 3 shared sessions: best lap -0\.30 on average, top 5 -0\.21; you were quicker on best lap in 2 of 2 \(1 left out for a cut lap\)/);
  assert.match(s, /Bob Jones — 2 shared sessions: best lap -0\.61 on average, top 5 -0\.62; you were quicker on best lap in 1 of 1 \(1 left out for a cut lap\)/);
  assert.equal(renderRivalsSummary([RUNS[3]]), null);
});

test("VS a driver lists every shared session, marks the cut, and averages the clean ones", () => {
  const s = renderRivalSection(RUNS, "tim hilyear") ?? "";
  assert.match(s, /^VS TIM HILYEAR/);
  assert.match(s, /2026-09-12 Sat {2}10:00 {2}you best 17\.39 top5 17\.58 {2}Tim Hilyear best 17\.80 top5 17\.89 {2}→ best -0\.41 {2}top5 -0\.31/);
  assert.match(s, /2026-09-13 Sun {2}10:00 {2}you best 11\.48 top5 14\.97 {2}Tim Hilyear best 14\.69 top5 15\.97 {2}→ best -3\.21 {2}top5 -1\.00 {2}\(your best is a cut lap — not averaged\)/);
  assert.match(s, /Across 2 clean shared sessions: best lap -0\.30 on average, top 5 -0\.21; you were quicker on best lap in 2 of 2\./);
  assert.match(s, /2026-09-12 Sat: 2 sessions, best -0\.30, top 5 -0\.21/);
  assert.ok(!/2026-09-13 Sun: /.test(s), "a day with no clean session has no day line");
  assert.equal(renderRivalSection(RUNS, "nobody here"), null);
});
