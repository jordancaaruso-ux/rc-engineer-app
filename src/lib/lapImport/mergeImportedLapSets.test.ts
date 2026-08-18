/**
 * Run: `npx tsx src/lib/lapImport/mergeImportedLapSets.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getBestLap, getIncludedLaps } from "@/lib/lapAnalysis";
import {
  mergeImportedLapSetsByDriver,
  type MergeableLapSet,
} from "@/lib/lapImport/mergeImportedLapSets";

type Set_ = MergeableLapSet & { id: string; sourceUrl?: string | null };

function set(
  id: string,
  driverName: string,
  times: number[],
  opts?: {
    isPrimaryUser?: boolean;
    sessionCompletedAt?: string | null;
    sourceUrl?: string;
    included?: boolean[];
  }
): Set_ {
  return {
    id,
    driverName,
    normalizedName: driverName.toLowerCase(),
    isPrimaryUser: opts?.isPrimaryUser ?? false,
    sessionCompletedAt: opts?.sessionCompletedAt ?? null,
    sourceUrl: opts?.sourceUrl ?? null,
    laps: times.map((t, i) => ({
      lapNumber: i + 1,
      lapTimeSeconds: t,
      isIncluded: opts?.included?.[i] ?? true,
    })),
  };
}

test("single import is returned untouched, by reference", () => {
  const a = set("a", "Jordan Caruso", [19.1, 18.7], { isPrimaryUser: true });
  const b = set("b", "Lucas Urbain", [19.4, 19.0]);
  const out = mergeImportedLapSetsByDriver([a, b]);

  assert.equal(out.length, 2);
  assert.equal(out[0], a, "unmerged sets must be the same object");
  assert.equal(out[1], b);
});

test("empty input", () => {
  assert.deepEqual(mergeImportedLapSetsByDriver([]), []);
});

test("two halves of one driver join, renumbered from 1", () => {
  const first = set("a", "Jordan Caruso", [19.84, 18.92, 18.61], {
    isPrimaryUser: true,
    sessionCompletedAt: "2026-08-18T04:14:00.000Z",
    sourceUrl: "https://liverc.com/first",
  });
  const second = set("b", "Jordan Caruso", [19.35, 18.41], {
    isPrimaryUser: true,
    sessionCompletedAt: "2026-08-18T04:29:00.000Z",
    sourceUrl: "https://liverc.com/second",
  });

  const out = mergeImportedLapSetsByDriver([first, second]);
  assert.equal(out.length, 1);
  const merged = out[0]!;

  assert.deepEqual(
    merged.laps.map((l) => l.lapNumber),
    [1, 2, 3, 4, 5],
    "lap numbers must be sequential — both halves number from 1"
  );
  assert.deepEqual(
    merged.laps.map((l) => l.lapTimeSeconds),
    [19.84, 18.92, 18.61, 19.35, 18.41]
  );
  assert.equal(merged.id, "a", "keeps the earliest half's identity");
  assert.equal(merged.sourceUrl, "https://liverc.com/first");
});

test("the best lap of the run can come from the second half", () => {
  const first = set("a", "Jordan Caruso", [19.84, 18.92], {
    sessionCompletedAt: "2026-08-18T04:14:00.000Z",
  });
  const second = set("b", "Jordan Caruso", [18.41, 18.58], {
    sessionCompletedAt: "2026-08-18T04:29:00.000Z",
  });

  const merged = mergeImportedLapSetsByDriver([first, second])[0]!;
  assert.equal(getBestLap(merged.laps), 18.41);
  assert.equal(getIncludedLaps(merged.laps).length, 4, "no lap lost to the lap-0 filter");
});

test("halves join in on-track order, not array order", () => {
  const later = set("b", "Jordan Caruso", [18.41], {
    sessionCompletedAt: "2026-08-18T04:29:00.000Z",
  });
  const earlier = set("a", "Jordan Caruso", [19.84], {
    sessionCompletedAt: "2026-08-18T04:14:00.000Z",
  });

  const merged = mergeImportedLapSetsByDriver([later, earlier])[0]!;
  assert.deepEqual(merged.laps.map((l) => l.lapTimeSeconds), [19.84, 18.41]);
  assert.equal(merged.id, "a");
});

test("excluded laps stay excluded through the join", () => {
  const first = set("a", "Jordan Caruso", [19.84, 40.2], {
    sessionCompletedAt: "2026-08-18T04:14:00.000Z",
    included: [true, false],
  });
  const second = set("b", "Jordan Caruso", [18.41], {
    sessionCompletedAt: "2026-08-18T04:29:00.000Z",
  });

  const merged = mergeImportedLapSetsByDriver([first, second])[0]!;
  assert.deepEqual(merged.laps.map((l) => l.isIncluded), [true, false, true]);
  assert.equal(getIncludedLaps(merged.laps).length, 2);
});

test("rivals in both halves collapse to one row each", () => {
  const out = mergeImportedLapSetsByDriver([
    set("a1", "Jordan Caruso", [19.8], { isPrimaryUser: true, sessionCompletedAt: "2026-08-18T04:14:00.000Z" }),
    set("a2", "Lucas Urbain", [19.9], { sessionCompletedAt: "2026-08-18T04:14:00.000Z" }),
    set("b1", "Jordan Caruso", [18.4], { isPrimaryUser: true, sessionCompletedAt: "2026-08-18T04:29:00.000Z" }),
    set("b2", "Lucas Urbain", [19.5], { sessionCompletedAt: "2026-08-18T04:29:00.000Z" }),
  ]);

  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.driverName), ["Jordan Caruso", "Lucas Urbain"]);
  assert.equal(out.every((s) => s.laps.length === 2), true);
});

test("primary survives when only one half marked it", () => {
  const merged = mergeImportedLapSetsByDriver([
    set("a", "Jordan Caruso", [19.8], { sessionCompletedAt: "2026-08-18T04:14:00.000Z" }),
    set("b", "Jordan Caruso", [18.4], { isPrimaryUser: true, sessionCompletedAt: "2026-08-18T04:29:00.000Z" }),
  ])[0]!;
  assert.equal(merged.isPrimaryUser, true);
});

test("name matching is case and whitespace insensitive", () => {
  const out = mergeImportedLapSetsByDriver([
    { ...set("a", "Jordan Caruso", [19.8]), normalizedName: null },
    { ...set("b", "  jordan caruso ", [18.4]), normalizedName: null },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.laps.length, 2);
});

test("sets with no time still join, after the timed ones", () => {
  const timed = set("a", "Jordan Caruso", [19.8], {
    sessionCompletedAt: "2026-08-18T04:14:00.000Z",
  });
  const untimed = set("b", "Jordan Caruso", [18.4]);
  const merged = mergeImportedLapSetsByDriver([untimed, timed])[0]!;
  assert.deepEqual(merged.laps.map((l) => l.lapTimeSeconds), [19.8, 18.4]);
});
