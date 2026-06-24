/**
 * Run: `npx tsx src/lib/events/splitEventsForPicker.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEventDateYmd } from "@/lib/eventDateParse";
import { splitEventsForPicker } from "@/lib/events/splitEventsForPicker";

test("splitEventsForPicker treats future end dates as upcoming", () => {
  const { upcoming, past } = splitEventsForPicker(
    [
      {
        startDate: parseEventDateYmd("2026-07-01"),
        endDate: parseEventDateYmd("2026-07-02"),
      },
    ],
    "2026-06-24"
  );
  assert.equal(upcoming.length, 1);
  assert.equal(past.length, 0);
});

test("splitEventsForPicker keeps in-progress multi-day events upcoming", () => {
  const { upcoming, past } = splitEventsForPicker(
    [
      {
        startDate: parseEventDateYmd("2026-06-20"),
        endDate: parseEventDateYmd("2026-06-28"),
      },
    ],
    "2026-06-24"
  );
  assert.equal(upcoming.length, 1);
  assert.equal(past.length, 0);
});

test("splitEventsForPicker moves ended events to past", () => {
  const { upcoming, past } = splitEventsForPicker(
    [
      {
        startDate: parseEventDateYmd("2026-06-01"),
        endDate: parseEventDateYmd("2026-06-02"),
      },
    ],
    "2026-06-24"
  );
  assert.equal(upcoming.length, 0);
  assert.equal(past.length, 1);
});
