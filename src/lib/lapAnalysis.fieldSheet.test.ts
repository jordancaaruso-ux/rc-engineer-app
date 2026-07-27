/**
 * Run: `npx tsx src/lib/lapAnalysis.fieldSheet.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_LAPS_FOR_FIELD_RANK,
  computeFieldSheet,
  lapRowsFromTimesAndFlags,
  type FieldSheetDriverInput,
} from "@/lib/lapAnalysis";

/** Twelve laps around a target, fast-first so avg top 10 is well defined. */
function laps(base: number, spread = 0.05): number[] {
  return Array.from({ length: 12 }, (_, i) => base + (i % 4) * spread);
}

function driver(
  id: string,
  position: number,
  times: number[],
  isUser = false
): FieldSheetDriverInput {
  return { id, name: `${id.toUpperCase()} Surname`, position, isUser, rows: lapRowsFromTimesAndFlags(times) };
}

test("ranks best / pace / consistency independently, and anchors on you", () => {
  const sheet = computeFieldSheet([
    driver("lead", 1, laps(19.0)),
    // You: quickest single lap of the three, but a scrappy run drags the average.
    driver("you", 2, [18.9, ...laps(19.4), 21.2], true),
    driver("third", 3, laps(19.3)),
  ]);

  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rankedCount, 3);
  // Classification order is preserved regardless of metric.
  assert.deepEqual(
    sheet.rows.map((r) => r.id),
    ["lead", "you", "third"]
  );

  const you = sheet.you;
  assert.ok(you, "you row resolved");
  assert.equal(you!.id, "you");
  assert.equal(you!.rankByBest, 1, "fastest single lap in the field");
  assert.equal(you!.rankByPace, 3, "but slowest race pace");
  assert.equal(you!.rankByConsistency, 3, "and least consistent");
});

test("ties share a rank and the next value skips", () => {
  const same = laps(19.0);
  const sheet = computeFieldSheet([
    driver("a", 1, same),
    driver("b", 2, [...same]),
    driver("c", 3, laps(19.5)),
  ]);
  const byId = new Map(sheet.rows.map((r) => [r.id, r]));
  assert.equal(byId.get("a")!.rankByPace, 1);
  assert.equal(byId.get("b")!.rankByPace, 1, "identical pace shares P1");
  assert.equal(byId.get("c")!.rankByPace, 3, "next value skips to P3");
});

test("a short run is excluded from the ranking instead of topping it", () => {
  // Three blistering laps then a crash — raw pace would beat the whole field.
  const sheet = computeFieldSheet([
    driver("lead", 1, laps(19.0)),
    driver("you", 2, laps(19.2), true),
    driver("dnf", 3, [18.2, 18.3, 18.2]),
  ]);

  const dnf = sheet.rows.find((r) => r.id === "dnf")!;
  assert.equal(dnf.eligible, false);
  assert.equal(dnf.rankByBest, null);
  assert.equal(dnf.rankByPace, null, "an unranked run cannot hold a pace rank");
  assert.equal(dnf.mistakeCount, null, "too few laps for the mistake rule");
  assert.ok(dnf.bestLap != null, "its metrics are still computed for display");
  assert.equal(sheet.rankedCount, 2);
  assert.ok(dnf.lapCount < MIN_LAPS_FOR_FIELD_RANK);

  // The leader keeps P1 — the crashed-out car did not displace anyone.
  assert.equal(sheet.rows.find((r) => r.id === "lead")!.rankByPace, 1);
});

test("next ahead on pace is the driver one place up, with a negative gap", () => {
  const sheet = computeFieldSheet([
    driver("lead", 1, laps(19.0)),
    driver("ahead", 2, laps(19.2)),
    driver("you", 3, laps(19.4), true),
    driver("behind", 4, laps(19.6)),
  ]);

  assert.equal(sheet.nextAheadOnPace?.id, "ahead", "not the overall leader");
  assert.equal(sheet.runnerUpOnPace, null);
  assert.ok(sheet.paceGapSeconds != null && sheet.paceGapSeconds < 0, "negative = they are faster");
  assert.ok(Math.abs(sheet.paceGapSeconds! + 0.2) < 0.01);
});

test("leading on pace flips to the margin over the runner-up", () => {
  const sheet = computeFieldSheet([
    driver("you", 1, laps(19.0), true),
    driver("second", 2, laps(19.3)),
    driver("third", 3, laps(19.6)),
  ]);

  assert.equal(sheet.nextAheadOnPace, null);
  assert.equal(sheet.runnerUpOnPace?.id, "second");
  assert.ok(sheet.paceGapSeconds != null && sheet.paceGapSeconds > 0, "positive = you are clear");
  assert.equal(sheet.you!.rankByPace, 1);
});

test("your manual lap exclusions move your row", () => {
  const yourTimes = [...laps(19.0), 24.0];
  const withDisaster = computeFieldSheet([
    driver("lead", 1, laps(19.0)),
    driver("you", 2, yourTimes, true),
  ]);
  // Same laps, but the 24.0s is manually excluded on the run — as the stat wells see it.
  const perLap = yourTimes.map((_, i) => ({ isIncluded: i !== yourTimes.length - 1 }));
  const withExclusion = computeFieldSheet([
    driver("lead", 1, laps(19.0)),
    {
      id: "you",
      name: "YOU Surname",
      position: 2,
      isUser: true,
      rows: lapRowsFromTimesAndFlags(yourTimes, perLap),
    },
  ]);

  const before = withDisaster.you!;
  const after = withExclusion.you!;
  assert.equal(before.lapCount, 13);
  assert.equal(after.lapCount, 12, "the excluded lap is gone from the count");
  assert.ok(
    after.consistencyScore! > before.consistencyScore!,
    "dropping the disaster lap improves consistency"
  );
  assert.ok(after.mistakeCount! < before.mistakeCount!, "and removes the mistake");
  assert.equal(before.bestLap, after.bestLap, "best lap is untouched by a slow exclusion");
});

test("field averages cover ranked drivers only", () => {
  const sheet = computeFieldSheet([
    driver("a", 1, laps(19.0)),
    driver("b", 2, laps(19.4), true),
    // Three flying laps then out — must not drag the averages down.
    driver("dnf", 3, [17.0, 17.1, 17.0]),
  ]);

  const byId = new Map(sheet.rows.map((r) => [r.id, r]));
  const a = byId.get("a")!;
  const b = byId.get("b")!;

  assert.equal(sheet.averages.driverCount, 2, "the crashed-out car is not averaged in");
  assert.ok(sheet.averages.bestLap != null);
  assert.ok(
    Math.abs(sheet.averages.bestLap! - (a.bestLap! + b.bestLap!) / 2) < 1e-9,
    "mean of the two ranked bests"
  );
  assert.ok(
    sheet.averages.bestLap! > 17.5,
    "a 17.0s three-lap run did not pull the field average under it"
  );
  assert.ok(
    Math.abs(sheet.averages.avgTop10! - (a.pace! + b.pace!) / 2) < 1e-9,
    "avgTop10 average matches the pace column it mirrors"
  );
  assert.ok(sheet.averages.lapCount != null && sheet.averages.lapCount === 12);
  assert.ok(sheet.averages.stintSeconds != null && sheet.averages.stintSeconds > 200);
  assert.ok(sheet.averages.consistencyScore != null);
  assert.ok(sheet.averages.median != null);
  assert.ok(sheet.averages.avgTop5 != null);
});

test("field averages are null, not zero, with nothing ranked", () => {
  const sheet = computeFieldSheet([
    driver("a", 1, [19.0, 19.1]),
    driver("b", 2, [19.4, 19.5], true),
  ]);
  assert.equal(sheet.averages.driverCount, 0);
  assert.equal(sheet.averages.bestLap, null, "no ranked driver means no average, not 0");
  assert.equal(sheet.averages.consistencyScore, null);
  assert.equal(sheet.averages.mistakeCount, null);
});

test("a field of one produces no ranks", () => {
  const sheet = computeFieldSheet([driver("solo", 1, laps(19.0), true)]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.you!.rankByPace, null, "P1 of 1 is not information");
  assert.equal(sheet.nextAheadOnPace, null);
  assert.equal(sheet.runnerUpOnPace, null);
  assert.equal(sheet.paceGapSeconds, null);
});

console.log("lapAnalysis.fieldSheet.test.ts OK");
