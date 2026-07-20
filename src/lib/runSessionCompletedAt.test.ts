/**
 * Run: `npx tsx src/lib/runSessionCompletedAt.test.ts`
 * Covers the importedLapSets path only (no DB) — the ids fallback needs Prisma.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRunSessionCompletedAtFromUpsertBody } from "@/lib/runSessionCompletedAt";

const FAKE_UTC_WALL_CLOCK = "2026-07-19T16:36:19.000Z"; // LiveRC "4:36 PM" stored as-if-UTC
const SYDNEY = "Australia/Sydney"; // AEST +10 in July

function liveRcSet(overrides: Record<string, unknown> = {}) {
  return {
    isPrimaryUser: true,
    sessionCompletedAt: FAKE_UTC_WALL_CLOCK,
    sourceUrl: "https://tftr.liverc.com/results/?p=view_race_result&id=1",
    sessionCompletedAtIsWallClock: true,
    ...overrides,
  };
}

test("LiveRC wall clock + tz → converted to the real instant", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody(
    "u1",
    { importedLapSets: [liveRcSet()] },
    { userTimeZone: SYDNEY }
  );
  assert.equal(d?.toISOString(), "2026-07-19T06:36:19.000Z");
});

test("import-time fallback (not wall clock) is already real — untouched", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody(
    "u1",
    { importedLapSets: [liveRcSet({ sessionCompletedAtIsWallClock: false })] },
    { userTimeZone: SYDNEY }
  );
  assert.equal(d?.toISOString(), FAKE_UTC_WALL_CLOCK);
});

test("missing flag (older payloads) → no conversion", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody(
    "u1",
    { importedLapSets: [liveRcSet({ sessionCompletedAtIsWallClock: undefined })] },
    { userTimeZone: SYDNEY }
  );
  assert.equal(d?.toISOString(), FAKE_UTC_WALL_CLOCK);
});

test("Speedhive times are real instants — untouched even with the flag", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody(
    "u1",
    {
      importedLapSets: [
        liveRcSet({ sourceUrl: "https://speedhive.mylaps.com/practice/4591" }),
      ],
    },
    { userTimeZone: SYDNEY }
  );
  assert.equal(d?.toISOString(), FAKE_UTC_WALL_CLOCK);
});

test("no timezone cookie → no conversion (stable fallback)", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody("u1", {
    importedLapSets: [liveRcSet()],
  });
  assert.equal(d?.toISOString(), FAKE_UTC_WALL_CLOCK);
});

test("primary set wins over non-primary", async () => {
  const d = await resolveRunSessionCompletedAtFromUpsertBody(
    "u1",
    {
      importedLapSets: [
        liveRcSet({ isPrimaryUser: false, sessionCompletedAt: "2026-07-19T10:00:00.000Z" }),
        liveRcSet(),
      ],
    },
    { userTimeZone: SYDNEY }
  );
  assert.equal(d?.toISOString(), "2026-07-19T06:36:19.000Z");
});
