/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * The range block does the arithmetic the driver would otherwise ask the model to do, and the
 * prompt forbids the model inventing a number — so the numbers here have to be right, signed
 * the app's way (positive = slower), and honest about what a tyre "run 1" means.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupTyreSets,
  renderBestAdjustedSection,
  renderBestFieldSection,
  renderDaySection,
  renderHistoryBlock,
  renderRunLines,
  renderTyreFieldSection,
  renderTyreSection,
  tyreAdjustments,
  tyreDeltaSummary,
  type HistoryRun,
} from "@/lib/engineer/historyShape";

let seq = 0;
function run(over: Partial<HistoryRun>): HistoryRun {
  seq += 1;
  return {
    id: `r${seq}`,
    dateYmd: "2026-08-01",
    clock: null,
    trackName: "Keilor",
    carId: "car-a",
    carName: "A800RR",
    session: null,
    lapCount: 20,
    best: 14.5,
    top5: 14.7,
    fiveMin: null,
    rating: null,
    tyreName: "Sorex 28",
    tyreTypeId: "sorex28",
    tyreRun: null,
    tyreAgeKnown: true,
    tyreStintId: null,
    airC: null,
    trackC: null,
    unconfirmed: false,
    tuning: {},
    field: null,
    ...over,
  };
}

/** A field where you are `gap` behind P1 out of `n`, and `gap - 0.3` off the average. */
function field(gap: number, n = 12, rank = 3) {
  return { n, rank, gapBestToP1: gap, gapTop5ToP1: gap + 0.05, gapBestToMedian: gap - 0.3, gapTop5ToMedian: gap - 0.25, entrants: [] };
}

test("the field rides on the run line, the changed line, a tyre table and a ranking of its own", () => {
  const runs = [
    run({ dateYmd: "2026-09-11", clock: "10:00", tyreRun: 1, tyreStintId: "a", best: 17.40, field: field(0.10), tuning: { toe_rear: "3" } }),
    run({ dateYmd: "2026-09-11", clock: "11:00", tyreRun: 2, tyreStintId: "a", best: 17.80, field: field(0.30), tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-12", clock: "10:00", tyreRun: 1, tyreStintId: "b", best: 17.60, field: field(0.00, 10, 1), tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-12", clock: "11:00", tyreRun: 2, tyreStintId: "b", best: 17.70, field: null, tuning: { toe_rear: "3.2" } }),
  ];
  const lines = renderRunLines(runs);
  assert.match(lines[0], /vs field P3\/12, \+0\.10 to P1 \(top5 \+0\.15\), -0\.20 vs median/);
  assert.match(lines[2], /changed: toe rear 3 → 3\.2 {2}\(gap to P1 vs previous run: \+0\.20\)/);
  // Day 2's run 1 follows day 1's run 2: no same-day tyre delta, but the field delta crosses days.
  assert.match(lines[4], /no setup change {2}\(gap to P1 vs previous run: -0\.30\)/);
  assert.ok(!/vs field/.test(lines[6]), "a run without a sheet carries no field");

  const tyres = renderTyreFieldSection(runs) ?? "";
  assert.match(tyres, /^TYRES, AGAINST THE FIELD/);
  assert.match(tyres, /run 1 best 0\.10 top5 0\.15 {2}· {2}run 2 best 0\.30 \(\+0\.20\) top5 0\.35 \(\+0\.20\)/);
  assert.match(tyres, /run 2 vs run 1: best \+0\.20 \(1 set\)/, "set b has one run with a field, so only set a counts");

  const best = renderBestFieldSection(runs) ?? "";
  assert.match(best, /1\. 0\.00 to P1 {2}P1\/10 {2}2026-09-12 Sat 10:00 {2}\(best 17\.60 on tyre run 1, -0\.30 vs field median\)/);
  assert.match(best, /2\. \+0\.10 to P1 {2}P3\/12/);
  assert.equal(renderBestFieldSection([runs[0]]), null, "one run is not a ranking");
  assert.equal(renderTyreFieldSection([runs[0], runs[3]]), null);

  const block = renderHistoryBlock({ scopeLabel: "x", runs, omittedOlder: 0, lastSetup: null }) ?? "";
  assert.match(block, /"vs field" is from the timing sheet/);
  assert.match(block, /BEST RUNS, AGAINST THE FIELD/);
});

test("a rival named in the question gets a VS section; the RIVALS summary rides whenever sheets exist", () => {
  const tim = (best: number, top5: number) => ({
    ...field(0.2),
    entrants: [
      { name: "Me", isMe: true, best: best - 0.2, top5: top5 - 0.1, cut: false },
      { name: "Tim Hilyear", isMe: false, best, top5, cut: false },
    ],
  });
  const runs = [
    run({ dateYmd: "2026-09-12", clock: "10:00", best: 17.6, field: tim(17.8, 17.9) }),
    run({ dateYmd: "2026-09-12", clock: "12:00", best: 17.7, field: tim(17.9, 18.0) }),
  ];
  const plain = renderHistoryBlock({ scopeLabel: "x", runs, omittedOlder: 0, lastSetup: null }) ?? "";
  assert.match(plain, /RIVALS — .*\n.*\n\nTim Hilyear — 2 shared sessions: best lap -0\.20 on average, top 5 -0\.10/);
  assert.ok(!/^VS /m.test(plain));
  const named = renderHistoryBlock({ scopeLabel: "x", runs, omittedOlder: 0, lastSetup: null, rival: "tim hilyear" }) ?? "";
  assert.match(named, /^VS TIM HILYEAR/m);
  assert.match(named, /Across 2 clean shared sessions: best lap -0\.20 on average, top 5 -0\.10; you were quicker on best lap in 2 of 2\./);
});

test("a stint id groups a set; runs before stint ids chain by car + compound + run number", () => {
  const runs = [
    run({ tyreRun: 1, tyreStintId: "s1" }),
    run({ tyreRun: 2, tyreStintId: "s1" }),
    run({ tyreRun: 1 }), // new rubber, no stint id
    run({ tyreRun: 2 }),
    run({ tyreRun: 3 }),
    run({ tyreRun: 2, tyreTypeId: "other" }), // compound changed — breaks the chain
    run({ tyreRun: 5 }), // gap — breaks the chain
  ];
  const sets = groupTyreSets(runs);
  assert.deepEqual(
    sets.map((s) => s.runs.map((r) => r.tyreRun)),
    [[1, 2], [1, 2, 3], [2], [5]]
  );
});

test("a run 1 inside an existing stint splits the set — the driver's 'new tyres' beats the app's id", () => {
  const runs = [
    run({ tyreRun: 5, tyreStintId: "s1", clock: "09:37" }),
    run({ tyreRun: 6, tyreStintId: "s1", clock: "10:04" }),
    run({ tyreRun: 1, tyreStintId: "s1", clock: "11:42" }),
    run({ tyreRun: 2, tyreStintId: "s1", clock: "12:59" }),
  ];
  const sets = groupTyreSets(runs);
  assert.deepEqual(sets.map((s) => s.runs.map((r) => r.tyreRun)), [[5, 6], [1, 2]]);
});

test("a chain never crosses cars — two cars of one type are two sets of tyres", () => {
  const runs = [
    run({ tyreRun: 1, carId: "car-a" }),
    run({ tyreRun: 1, carId: "car-b" }),
    run({ tyreRun: 2, carId: "car-a" }),
    run({ tyreRun: 2, carId: "car-b" }),
  ];
  const sets = groupTyreSets(runs);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets.map((s) => s.runs.map((r) => r.carId)), [["car-a", "car-a"], ["car-b", "car-b"]]);
});

test("deltas are against run 1 on the same set, signed positive = slower, averaged across sets", () => {
  const runs = [
    run({ tyreRun: 1, tyreStintId: "s1", best: 14.5, top5: 14.7 }),
    run({ tyreRun: 2, tyreStintId: "s1", best: 14.3, top5: 14.5 }),
    run({ tyreRun: 3, tyreStintId: "s1", best: 14.4, top5: 14.6 }),
    run({ tyreRun: 1, tyreStintId: "s2", best: 14.8, top5: 15.0 }),
    run({ tyreRun: 2, tyreStintId: "s2", best: 14.4, top5: 14.7 }),
  ];
  const summary = tyreDeltaSummary(groupTyreSets(runs));
  assert.equal(summary.length, 1, "every pair is same-day, so no second line");
  // run 2: (-0.20 + -0.40) / 2 = -0.30 best; (-0.20 + -0.30) / 2 = -0.25 top5. run 3: -0.10 / +... one set.
  assert.match(summary[0], /run 2 vs run 1: best -0\.30 \(2 sets\), top5 -0\.25/);
  assert.match(summary[0], /run 3 vs run 1: best -0\.10 \(1 set\), top5 -0\.10/);

  const section = renderTyreSection(runs) ?? "";
  assert.match(section, /set 1 .*\n {4}run 1 best 14\.50 top5 14\.70 {2}· {2}run 2 best 14\.30 \(-0\.20\) top5 14\.50 \(-0\.20\)/);
  assert.match(section, /positive = slower/);
});

test("a set the driver was not sure about is shown but never averaged as an absolute run 1", () => {
  const runs = [
    run({ tyreRun: 1, tyreStintId: "s1", tyreAgeKnown: false, best: 14.5 }),
    run({ tyreRun: 2, tyreStintId: "s1", tyreAgeKnown: false, best: 14.2 }),
  ];
  const section = renderTyreSection(runs) ?? "";
  assert.match(section, /run count relative/);
  assert.equal(tyreDeltaSummary(groupTyreSets(runs)).length, 0);
});

test("a set that spans days is flagged, and same-day pairs get their own average", () => {
  const runs = [
    run({ tyreRun: 1, tyreStintId: "s1", best: 14.5, dateYmd: "2026-08-01" }),
    run({ tyreRun: 2, tyreStintId: "s1", best: 14.3, dateYmd: "2026-08-01" }),
    run({ tyreRun: 3, tyreStintId: "s1", best: 14.9, dateYmd: "2026-08-08" }),
  ];
  const section = renderTyreSection(runs) ?? "";
  assert.match(section, /spans 2 days/);
  assert.match(section, /run 3 best 14\.90 \(\+0\.40\) top5 14\.70 \(0\.00\) on 2026-08-08/);
  const summary = tyreDeltaSummary(groupTyreSets(runs));
  assert.equal(summary.length, 2);
  assert.match(summary[1], /Same-day pairs only .*run 2 vs run 1: best -0\.20 \(1 set\)/);
  assert.ok(!/run 3/.test(summary[1]), "the cross-day pair stays out of the same-day line");
});

test("a set that went to another track is marked, and that pair never enters the average", () => {
  const runs = [
    run({ tyreRun: 1, tyreStintId: "s1", best: 15.6, trackName: "TFTR" }),
    run({ tyreRun: 2, tyreStintId: "s1", best: 15.7, trackName: "TFTR" }),
    run({ tyreRun: 3, tyreStintId: "s1", best: 18.1, trackName: "Keilor", dateYmd: "2026-08-08" }),
  ];
  const section = renderTyreSection(runs) ?? "";
  assert.match(section, /run 3 best 18\.10 \(\+2\.50\) .*on 2026-08-08 at Keilor/);
  const summary = tyreDeltaSummary(groupTyreSets(runs));
  assert.match(summary[0], /same track as run 1 — run 2 vs run 1: best \+0\.10 \(1 set\)/);
  assert.ok(!/run 3/.test(summary[0]), "the other-track pair is not a tyre delta");
});

test("new-tyre equivalent takes the average tyre-run loss back out, and ranks the runs", () => {
  const runs = [
    run({ dateYmd: "2026-09-11", clock: "10:00", tyreRun: 1, tyreStintId: "a", best: 17.40, top5: 17.60, tuning: { toe_rear: "3" } }),
    run({ dateYmd: "2026-09-11", clock: "11:00", tyreRun: 2, tyreStintId: "a", best: 17.80, top5: 18.00, tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-11", clock: "12:00", tyreRun: 3, tyreStintId: "a", best: 17.90, top5: 18.05, tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-11", clock: "13:00", tyreRun: 4, tyreStintId: "a", best: 18.30, top5: 18.40, tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-12", clock: "10:00", tyreRun: 1, tyreStintId: "b", best: 17.60, top5: 17.80, tuning: { toe_rear: "3.2" } }),
    run({ dateYmd: "2026-09-12", clock: "11:00", tyreRun: 2, tyreStintId: "b", best: 17.80, top5: 18.00, tuning: { toe_rear: "3.2" } }),
  ];
  const adj = tyreAdjustments(groupTyreSets(runs));
  // run 2 vs run 1: (+0.40, +0.20) → +0.30 best, +0.30 top5, from two sets. Runs 3 and 4 have
  // one set each, and one set's delta is that set's day — no correction is offered for them.
  assert.equal(adj.get(2)?.best.toFixed(2), "0.30");
  assert.equal(adj.get(3), undefined);
  assert.equal(adj.get(4), undefined);

  const lines = renderRunLines(runs, adj);
  assert.match(lines[0], /best 17\.40 {2}top5 17\.60 {2}new-tyre eq 17\.40 \/ 17\.60/, "run 1 corrects by nothing");
  assert.match(lines[1], /best 17\.80 {2}top5 18\.00 {2}new-tyre eq 17\.50 \/ 17\.70/);
  assert.match(lines[2], /changed: toe rear 3 → 3\.2 {2}\(new-tyre eq vs previous run: \+0\.10\)/);
  assert.match(lines[3], /best 17\.90 {2}top5 18\.05 {2}new-tyre eq ≤17\.60 \/ 17\.75/, "past the last averaged run, corrected by it and marked");
  assert.match(lines[4], /no setup change {2}\(new-tyre eq vs previous run: \+0\.10\)/);

  const section = renderBestAdjustedSection(runs, adj) ?? "";
  assert.match(section, /^BEST RUNS, NEW-TYRE EQUIVALENT/);
  assert.match(section, /1\. 17\.40 {2}2026-09-11 Fri 10:00 {2}\(raw 17\.40 on tyre run 1\)/);
  assert.match(section, /2\. 17\.50 {2}2026-09-11 Fri 11:00 {2}\(raw 17\.80 on tyre run 2\)/);
  assert.match(section, /≤17\.60 {2}2026-09-11 Fri 12:00 {2}\(raw 17\.90 on tyre run 3\)/);
  assert.equal(renderBestAdjustedSection(runs, new Map()), null);
});

test("no tyres section without a set of two timed runs", () => {
  assert.equal(renderTyreSection([run({ tyreRun: 1 }), run({ tyreRun: 1 })]), null);
  assert.equal(renderTyreSection([run({ tyreRun: 1, tyreStintId: "s" }), run({ tyreRun: 2, tyreStintId: "s", best: null })]), null);
});

test("run lines carry a 'changed' line only when both sheets are readable", () => {
  const runs = [
    run({ tuning: { arb_front: "1.2" } }),
    run({ tuning: { arb_front: "1.3" } }),
    run({ tuning: {} }),
    run({ tuning: { arb_front: "1.3" } }),
    run({ tuning: { arb_front: "1.30" } }),
  ];
  const lines = renderRunLines(runs);
  const changed = lines.filter((l) => l.startsWith("    "));
  assert.deepEqual(changed, ["    changed: arb front 1.2 → 1.3", "    no setup change"]);
});

test("changes never diff across two physical cars", () => {
  const runs = [
    run({ carId: "car-a", tuning: { arb_front: "1.2" } }),
    run({ carId: "car-b", tuning: { arb_front: "1.4" } }),
    run({ carId: "car-a", tuning: { arb_front: "1.2" } }),
  ];
  const lines = renderRunLines(runs);
  assert.deepEqual(lines.filter((l) => l.startsWith("    ")), ["    no setup change"]);
  assert.match(lines[0], /A800RR/, "two cars in the list: the car is named on every line");
});

test("the day section says how the day moved, first timed run to last", () => {
  const runs = [
    run({ dateYmd: "2026-08-01", best: 14.9, airC: 18 }),
    run({ dateYmd: "2026-08-01", best: 14.4, airC: 24 }),
    run({ dateYmd: "2026-08-08", best: 14.6, airC: 20 }),
  ];
  const section = renderDaySection(runs) ?? "";
  assert.match(section, /2026-08-01 Sat {2}2 runs {2}best of day 14\.40 {2}first timed run best 14\.90 → last 14\.40 \(-0\.50\) {2}air 18–24°C/);
  assert.match(section, /2026-08-08 Sat {2}1 run {2}best of day 14\.60 {2}air 20°C/);
  assert.ok(!/on average/.test(section), "one day with a first→last is not an average");
  assert.equal(renderDaySection([run({})]), null, "one day is not a day table");

  const twoDays = renderDaySection([
    run({ dateYmd: "2026-08-01", best: 14.9 }),
    run({ dateYmd: "2026-08-01", best: 14.4 }),
    run({ dateYmd: "2026-08-08", best: 14.6 }),
    run({ dateYmd: "2026-08-08", best: 14.7 }),
  ]) ?? "";
  assert.match(twoDays, /Across 2 days with two or more timed runs, first → last best lap moved -0\.20 on average \(range -0\.50 to \+0\.10\)/);
});

test("the block names the range, the count, what is not shown, and reads as DRIVER DATA", () => {
  const runs = [run({ tyreRun: 1 }), run({ tyreRun: 2, unconfirmed: true })];
  const block = renderHistoryBlock({
    scopeLabel: "Keilor, 1 Jun – 14 Sep 2026, A800RR",
    runs,
    omittedOlder: 12,
    lastSetup: { carName: "A800RR", dateYmd: "2026-08-01", rows: ["arb front: 1.2"] },
  });
  assert.ok(block);
  assert.ok(block.startsWith("DRIVER DATA — RUNS IN A RANGE. The driver chose this range: Keilor, 1 Jun – 14 Sep 2026, A800RR. 2 runs shown"));
  assert.match(block, /The 12 older runs in the range are not shown/);
  assert.match(block, /unconfirmed/);
  assert.match(block, /SETUP ON THE CAR AT THE LAST RUN SHOWN \(A800RR, 2026-08-01\)/);
  assert.equal(renderHistoryBlock({ scopeLabel: "x", runs: [], omittedOlder: 0, lastSetup: null }), null);
});

test("a front/rear run names both ends on its line; a single-tyre line is untouched", () => {
  const buggy = run({
    carId: "buggy", carName: "CAT PB",
    tyreName: "Cactus Yellow", tyreRun: 2, tyreStintId: "rear-a",
    frontTyreName: "AKA Array Clay", frontTyreRun: 6, frontTyreAgeKnown: false, frontTyreStintId: "front-a",
  });
  const touring = run({ tyreName: "Sorex 28", tyreRun: 3, tyreStintId: "s1" });
  const [buggyLine] = renderRunLines([buggy]);
  assert.match(buggyLine, /front tyre run 6\?  AKA Array Clay  rear tyre run 2  Cactus Yellow/);
  const [touringLine] = renderRunLines([touring]);
  assert.match(touringLine, /tyre run 3  Sorex 28/);
  assert.doesNotMatch(touringLine, /front|rear/);
});

test("the tyre tables follow the REAR set and flag where the fronts changed inside it", () => {
  const rear = { tyreName: "Cactus Yellow", tyreStintId: "rear-a", carId: "buggy" };
  const runs = [
    run({ ...rear, tyreRun: 1, best: 20.0, frontTyreName: "Array Clay", frontTyreRun: 4, frontTyreStintId: "front-a" }),
    run({ ...rear, tyreRun: 2, best: 20.2, frontTyreName: "Array Clay", frontTyreRun: 5, frontTyreStintId: "front-a" }),
    run({ ...rear, tyreRun: 3, best: 20.1, frontTyreName: "Dirt Webs", frontTyreRun: 1, frontTyreStintId: "front-b" }),
  ];
  // One set — the rear's — not split by the front change.
  assert.equal(groupTyreSets(runs).length, 1);
  const section = renderTyreSection(runs)!;
  assert.match(section, /run 2 best 20\.20 /);
  assert.match(section, /run 3 \(front tyres changed\) best 20\.10 /);
  assert.equal(section.match(/front tyres changed/g)?.length, 1, "flagged once, where it happened");
});

test("the front/rear legend appears only when the range holds a front/rear run", () => {
  const base = { scopeLabel: "last 5 runs", omittedOlder: 0, lastSetup: null };
  const onRoad = renderHistoryBlock({ ...base, runs: [run({ tyreRun: 1, tyreStintId: "s1" })] });
  assert.doesNotMatch(onRoad ?? "", /REAR set only/);
  const offRoad = renderHistoryBlock({
    ...base,
    runs: [run({ tyreRun: 1, tyreStintId: "r1", frontTyreName: "Array Clay", frontTyreRun: 1, frontTyreStintId: "f1" })],
  });
  assert.match(offRoad ?? "", /follow the REAR set only/);
});
