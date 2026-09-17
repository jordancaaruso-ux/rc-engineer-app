import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { parseLiveRcSessionDisplayTimeToUtcIso } from "@/lib/lapUrlParsers/livercSessionTime";

/**
 * LiveRC prints the track's wall clock with no zone; it is stored as that wall clock written as
 * UTC whatever zone the server runs in. A dev box at UTC+9:30 used to store every time 9.5 hours
 * early (SA State Titles, 2026-09-16), so each case runs in several server zones.
 */

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ["UTC", "Australia/Adelaide", "Australia/Sydney", "America/Los_Angeles"];

const CASES: Array<[string, string]> = [
  ["Sep 12, 2026 at 9:48am", "2026-09-12T09:48:00.000Z"],
  ["Sep 12, 2026 at 5:29pm", "2026-09-12T17:29:00.000Z"],
  ["September 13, 2026 (Sunday) at 10:57:58am", "2026-09-13T10:57:58.000Z"],
  ["4/8/2025 2:30 PM", "2025-04-08T14:30:00.000Z"],
  ["Sep 11, 2026", "2026-09-11T00:00:00.000Z"],
  // A string that names its own zone is a real instant and is left alone.
  ["2026-09-12T09:48:00Z", "2026-09-12T09:48:00.000Z"],
];

for (const zone of ZONES) {
  test(`LiveRC wall clock is stored as written, server in ${zone}`, () => {
    process.env.TZ = zone;
    for (const [raw, want] of CASES) {
      assert.equal(parseLiveRcSessionDisplayTimeToUtcIso(raw), want, raw);
    }
  });
}

test("unreadable text gives null", () => {
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso("Race Results"), null);
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso(""), null);
});
