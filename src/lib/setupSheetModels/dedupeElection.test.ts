/**
 * Run: `npx tsx src/lib/setupSheetModels/dedupeElection.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareDedupeKeeper,
  electDedupeWinner,
  planSetupSheetModelDedupe,
  type DedupeModelRow,
} from "@/lib/setupSheetModels/dedupeElection";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";

function row(p: Partial<DedupeModelRow> & { id: string }): DedupeModelRow {
  return {
    name: "Mugen MTC3",
    slug: "mugen_mtc3",
    isAuthorized: false,
    fieldCount: 10,
    carCount: 0,
    calibrationCount: 0,
    documentCount: 0,
    updatedAt: 0,
    ...p,
  };
}

test("authorized row wins regardless of data", () => {
  const authorized = row({ id: "auth", isAuthorized: true, fieldCount: 1, carCount: 0 });
  const loaded = row({ id: "loaded", isAuthorized: false, fieldCount: 80, carCount: 9, calibrationCount: 9 });
  assert.equal(electDedupeWinner([loaded, authorized]).id, "auth");
});

test("richer schema beats sparse when both unauthorized", () => {
  const rich = row({ id: "rich", fieldCount: 60 });
  const sparse = row({ id: "sparse", fieldCount: 12, carCount: 5 });
  assert.equal(electDedupeWinner([sparse, rich]).id, "rich");
});

test("more attached data breaks ties at equal schema", () => {
  const a = row({ id: "a", fieldCount: 30, calibrationCount: 1 });
  const b = row({ id: "b", fieldCount: 30, calibrationCount: 0, carCount: 1 });
  // calibrations weighted 2× → a (2) beats b (1)
  assert.equal(electDedupeWinner([a, b]).id, "a");
});

test("canonical slug beats suffixed duplicate at full tie", () => {
  const canonical = row({ id: "c", slug: "mugen_mtc3" });
  const suffixed = row({ id: "s", slug: "mugen_mtc3_2" });
  assert.equal(electDedupeWinner([suffixed, canonical]).id, "c");
});

test("newest updatedAt breaks remaining ties", () => {
  const older = row({ id: "old", updatedAt: 1000 });
  const newer = row({ id: "new", updatedAt: 2000 });
  assert.equal(electDedupeWinner([older, newer]).id, "new");
});

test("comparator is consistent with election", () => {
  const a = row({ id: "a", isAuthorized: true });
  const b = row({ id: "b", isAuthorized: false });
  assert.ok(compareDedupeKeeper(a, b) < 0);
  assert.ok(compareDedupeKeeper(b, a) > 0);
});

test("planSetupSheetModelDedupe groups by normalized name, only multi-row groups", () => {
  const rows = [
    row({ id: "m1", name: "Mugen MTC3", calibrationCount: 1, carCount: 1 }),
    row({ id: "m2", name: "mugen  mtc3", slug: "mugen_mtc3_1", carCount: 1 }),
    row({ id: "x1", name: "Xray T4", slug: "xray_t4" }),
  ];
  const plan = planSetupSheetModelDedupe(rows, (r) => normalizeSetupSheetModelName(r.name));
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.key, "mugen mtc3");
  assert.equal(plan[0]!.winner.id, "m1");
  assert.deepEqual(plan[0]!.losers.map((l) => l.id), ["m2"]);
});

test("planSetupSheetModelDedupe can dedupe by slug", () => {
  const rows = [
    row({ id: "a", name: "Mugen MTC3", slug: "mugen_mtc3" }),
    row({ id: "b", name: "Mugen MTC-3", slug: "mugen_mtc3", fieldCount: 40 }),
  ];
  const plan = planSetupSheetModelDedupe(rows, (r) => r.slug.trim().toLowerCase());
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.winner.id, "b");
});
