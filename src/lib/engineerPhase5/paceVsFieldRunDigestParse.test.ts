/**
 * Run: `npx tsx src/lib/engineerPhase5/paceVsFieldRunDigestParse.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePaceVsFieldRunDigestPayload,
  parsePaceVsFieldRunDigestSubsetPayload,
} from "@/lib/engineerPhase5/paceVsFieldRunDigestParse";
import type { PaceVsFieldRunDigestRowV1 } from "@/lib/engineerPhase5/paceVsFieldRunDigestTypes";

function sampleRow(over: Partial<PaceVsFieldRunDigestRowV1> = {}): PaceVsFieldRunDigestRowV1 {
  return {
    runId: "r1",
    sortIso: "2026-01-15T10:00:00.000Z",
    displayDay: "2026-01-15",
    carId: "c1",
    carName: "Car",
    trackName: "T",
    eventId: "e1",
    eventName: "Event",
    sessionSummary: "Practice",
    importedLapTimeSessionId: "s1",
    avgTop10UserSeconds: 18,
    avgTop10FieldMeanSeconds: 18.5,
    gapUserMinusFieldMeanSeconds: -0.5,
    rankInField: 2,
    fieldEntrantCountForMetric: 5,
    sessionDriverCount: 5,
    ...over,
  };
}

test("parsePaceVsFieldRunDigestSubsetPayload accepts valid subset", () => {
  const s = parsePaceVsFieldRunDigestSubsetPayload({
    version: 1,
    generatedAtIso: "2026-01-20T00:00:00.000Z",
    parentDigestGeneratedAtIso: "2026-01-19T12:00:00.000Z",
    filterSummary: "Event · 1 run",
    metric: "avg_top_10_vs_field_mean",
    gapMeaning: "user_seconds_minus_field_mean_positive_slower",
    rows: [sampleRow()],
  });
  assert.ok(s);
  assert.equal(s?.rows.length, 1);
});

test("parsePaceVsFieldRunDigestSubsetPayload rejects empty rows", () => {
  assert.equal(
    parsePaceVsFieldRunDigestSubsetPayload({
      version: 1,
      generatedAtIso: "2026-01-20T00:00:00.000Z",
      parentDigestGeneratedAtIso: "2026-01-19T12:00:00.000Z",
      filterSummary: "x",
      metric: "avg_top_10_vs_field_mean",
      gapMeaning: "user_seconds_minus_field_mean_positive_slower",
      rows: [],
    }),
    null
  );
});

test("parsePaceVsFieldRunDigestPayload requires row shape", () => {
  assert.equal(
    parsePaceVsFieldRunDigestPayload({
      version: 1,
      generatedAtIso: "x",
      metric: "avg_top_10_vs_field_mean",
      gapMeaning: "user_seconds_minus_field_mean_positive_slower",
      scope: "account",
      scopeCarId: null,
      anchorRunId: null,
      scannedRunCount: 1,
      includedRunCount: 1,
      omittedAfterCap: 0,
      truncatedScan: false,
      rows: [{ runId: "r1", gapUserMinusFieldMeanSeconds: 0.1 }],
    }),
    null
  );
  assert.ok(
    parsePaceVsFieldRunDigestPayload({
      version: 1,
      generatedAtIso: "2026-01-19T12:00:00.000Z",
      metric: "avg_top_10_vs_field_mean",
      gapMeaning: "user_seconds_minus_field_mean_positive_slower",
      scope: "account",
      scopeCarId: null,
      anchorRunId: null,
      scannedRunCount: 1,
      includedRunCount: 1,
      omittedAfterCap: 0,
      truncatedScan: false,
      rows: [sampleRow()],
    })
  );
});
