/**
 * Run: `npx tsx src/lib/lapImport/computeImportedSessionFieldStats.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeImportedSessionFieldStatsFromDrivers } from "@/lib/lapImport/computeImportedSessionFieldStats";

const tight = [15.0, 15.1, 15.0, 15.2, 15.1, 15.0];

test("field driver stats use median-band outlier exclusion", () => {
  const stats = computeImportedSessionFieldStatsFromDrivers([
    { driverId: "a", driverName: "A", normalizedName: "a", laps: tight },
    {
      driverId: "b",
      driverName: "B",
      normalizedName: "b",
      laps: [...tight, 30.0],
    },
  ]);
  assert.ok(stats);
  const b = stats.drivers.find((d) => d.driverId === "b")!;
  const a = stats.drivers.find((d) => d.driverId === "a")!;
  assert.equal(b.lapCount, 6);
  assert.ok(b.avgTop5Seconds != null && a.avgTop5Seconds != null);
  assert.ok(Math.abs(b.avgTop5Seconds! - a.avgTop5Seconds!) < 0.05);
  assert.ok(stats.field.meanAvgTop5Seconds != null);
  assert.ok(Math.abs(stats.field.meanAvgTop5Seconds! - a.avgTop5Seconds!) < 0.05);
});

console.log("computeImportedSessionFieldStats.test.ts OK");
