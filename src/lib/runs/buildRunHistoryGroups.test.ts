/**
 * Run: `npx tsx src/lib/runs/buildRunHistoryGroups.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunHistoryGroups } from "@/lib/runs/buildRunHistoryGroups";

test("buildRunHistoryGroups groups by event and orders newest first", () => {
  const runs = [
    {
      id: "r1",
      createdAt: new Date("2025-03-01T10:00:00Z"),
      sortAt: new Date("2025-03-01T10:00:00Z"),
      eventId: "e1",
      trackNameSnapshot: null,
      event: {
        name: "Spring Meet",
        startDate: new Date("2025-03-01"),
        endDate: new Date("2025-03-01"),
        track: { name: "TFTR" },
      },
    },
    {
      id: "r2",
      createdAt: new Date("2025-02-01T10:00:00Z"),
      sortAt: new Date("2025-02-01T10:00:00Z"),
      eventId: null,
      trackNameSnapshot: "Home",
      track: { name: "Home" },
      event: null,
    },
  ];
  const groups = buildRunHistoryGroups(runs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.id, "event-e1");
  assert.equal(groups[0]!.type, "Race Meeting");
  assert.equal(groups[1]!.type, "Testing");
});
