/**
 * Run: `npx tsx src/lib/engineerPhase5/slimEngineerChatContextForApi.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { slimEngineerChatContextForApi } from "@/lib/engineerPhase5/slimEngineerChatContextForApi";

test("compact spread rows and cap digest size", () => {
  const huge = {
    richEngineerContext: {
      setupVsSpread: {
        note: "x".repeat(5000),
        rows: Array.from({ length: 40 }, (_, i) => ({
          parameterKey: `k${i}`,
          label: `L${i}`,
          currentDisplay: "1",
          spreadSource: "community",
          positionBand: "mid",
          spread: { median: 1, mean: 1, iqr: 0.1, sampleCount: 100, valueHistogram: [1, 2, 3] },
          gripTrendSignal: {
            magnitude: "material",
            direction: "up",
            delta: 1,
            cliffsDelta: 0.5,
            quartilesDisjoint: true,
          },
          gripTrend: { low: { median: 1, p25: 1, p75: 1 } },
          topValues: [{ value: "7k", count: 50, frequency: 0.5 }],
        })),
        siblingCarCount: 1,
        communitySpreadAvailable: true,
        communityContext: { label: "test" },
        truncated: false,
      },
      vehicleDynamicsKb: [{ title: "t", excerpt: "e".repeat(3000), sourcePath: "a.md" }],
    },
    paceVsFieldRunDigest: {
      rows: Array.from({ length: 50 }, (_, i) => ({ runId: `r${i}`, gapUserMinusFieldMeanSeconds: -1 })),
    },
    engineeringBrain: {
      promptLines: ["line"],
      engineeringRead: { recommendationStrategy: { mode: "verify" }, runQuality: { huge: true } },
    },
    defaultDashboardContext: {
      thingsToTry: Array.from({ length: 25 }, (_, i) => ({ id: String(i), text: "try" })),
    },
  };

  const rawLen = JSON.stringify(huge).length;
  const { context, trimmed, jsonChars } = slimEngineerChatContextForApi(huge, {
    maxJsonChars: 8_000,
  });
  assert.ok(trimmed);
  assert.ok(jsonChars <= 8_000);
  assert.ok(jsonChars < rawLen || rawLen > 8_000);
  const rich = context.richEngineerContext as {
    setupVsSpread: { rows: unknown[] };
    vehicleDynamicsKb: Array<{ excerpt: string }>;
  };
  assert.ok(rich.setupVsSpread.rows.length <= 22);
  assert.ok(rich.vehicleDynamicsKb[0].excerpt.length < 500);
});

console.log("slimEngineerChatContextForApi.test.ts OK");
