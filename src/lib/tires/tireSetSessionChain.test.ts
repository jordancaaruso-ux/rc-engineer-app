/**
 * Run: `npx tsx src/lib/tires/tireSetSessionChain.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chainItemForRun,
  buildTireSetSessionChain,
  formatSessionChain,
} from "@/lib/tires/tireSetSessionChain";

// Local-time constructors keep dates deterministic across zones.
const jul3 = new Date(2026, 6, 3);
const jul4 = new Date(2026, 6, 4);

test("meeting session code wins over everything", () => {
  const item = chainItemForRun({
    meetingSessionCode: "A1",
    sessionLabel: "My warmup",
    meetingSessionType: "RACE",
    when: jul3,
  });
  assert.equal(item, "A1");
});

test("session label used when no meeting code", () => {
  const item = chainItemForRun({
    meetingSessionCode: null,
    sessionLabel: "Shakedown",
    meetingSessionType: "PRACTICE",
    when: jul3,
  });
  assert.equal(item, "Shakedown");
});

test("meeting type maps to a short code when no text was given", () => {
  assert.equal(chainItemForRun({ meetingSessionType: "QUALIFYING", when: jul3 }), "Q");
  assert.equal(chainItemForRun({ meetingSessionType: "RACE", when: jul3 }), "R");
  assert.equal(chainItemForRun({ meetingSessionType: "PRACTICE", when: jul3 }), "P");
  assert.equal(chainItemForRun({ meetingSessionType: "SEEDING", when: jul3 }), "S");
});

test("OTHER meeting type has no mapped code (custom text lives in the code) → date fallback", () => {
  assert.equal(chainItemForRun({ meetingSessionType: "OTHER", when: jul3 }), "Jul 3");
});

test("date fallback used when nothing else present", () => {
  assert.equal(chainItemForRun({ when: new Date(2026, 0, 25) }), "Jan 25");
});

test("whitespace-only fields fall through to the next source", () => {
  assert.equal(
    chainItemForRun({ meetingSessionCode: "   ", sessionLabel: "Q2", when: jul3 }),
    "Q2"
  );
});

test("long free text is clipped for row display", () => {
  assert.equal(
    chainItemForRun({ meetingSessionCode: "Club night round 4", when: jul3 }),
    "Club nigh…"
  );
});

test("chain is chronological regardless of input order", () => {
  const chain = buildTireSetSessionChain([
    { meetingSessionCode: "Q2", when: jul4 },
    { meetingSessionCode: "Q1", when: jul3 },
  ]);
  assert.deepEqual(chain, ["Q1", "Q2"]);
});

test("consecutive duplicates collapse (unlabeled test-day runs read as one date)", () => {
  const chain = buildTireSetSessionChain([
    { when: jul3 },
    { when: new Date(2026, 6, 3, 14) },
    { when: new Date(2026, 6, 3, 16) },
    { meetingSessionCode: "A1", when: jul4 },
  ]);
  assert.deepEqual(chain, ["Jul 3", "A1"]);
});

test("non-consecutive repeats are kept (set returned to after another session)", () => {
  const chain = buildTireSetSessionChain([
    { meetingSessionType: "PRACTICE", when: jul3 },
    { meetingSessionType: "QUALIFYING", when: new Date(2026, 6, 3, 12) },
    { meetingSessionType: "PRACTICE", when: new Date(2026, 6, 3, 15) },
  ]);
  assert.deepEqual(chain, ["P", "Q", "P"]);
});

test("formatSessionChain joins short chains and trims long ones with an ellipsis", () => {
  assert.equal(formatSessionChain([]), "");
  assert.equal(formatSessionChain(["Q1", "Q2"]), "Q1 Q2");
  assert.equal(formatSessionChain(["P", "Q1", "Q2", "A1"]), "… Q1 Q2 A1");
});
