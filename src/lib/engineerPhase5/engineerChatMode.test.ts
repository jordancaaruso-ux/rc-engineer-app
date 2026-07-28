/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChatMode.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineerChatModePromptAddon,
  inferEngineerChatMode,
  parseChoiceChipsFromReply,
  parseEngineerChatModeHint,
} from "@/lib/engineerPhase5/engineerChatMode";

const NOW = Date.parse("2026-07-28T18:00:00.000Z");
const agoMs = (hours: number) => NOW - hours * 60 * 60 * 1000;
const isoAgo = (hours: number) => new Date(agoMs(hours)).toISOString();

test("hint parser takes only the three known values, else null", () => {
  assert.equal(parseEngineerChatModeHint("quick"), "quick");
  assert.equal(parseEngineerChatModeHint("deep"), "deep");
  assert.equal(parseEngineerChatModeHint("normal"), "normal");
  // Anything unrecognised must be null, not "normal" — null means "infer it", and
  // silently defaulting would strip the inference away on every malformed hint.
  assert.equal(parseEngineerChatModeHint("QUICK"), null);
  assert.equal(parseEngineerChatModeHint(undefined), null);
  assert.equal(parseEngineerChatModeHint(42), null);
});

test("a run logged an hour ago means the driver is still at the track", () => {
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: isoAgo(1), latestRunEventId: null, nowMs: NOW }),
    "quick"
  );
});

test("an event run from this morning is a debrief, not trackside", () => {
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: isoAgo(9), latestRunEventId: "evt1", nowMs: NOW }),
    "deep"
  );
});

test("the same gap without an event stays normal — practice alone is not a debrief", () => {
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: isoAgo(9), latestRunEventId: null, nowMs: NOW }),
    "normal"
  );
});

test("a cold week and a driver with no runs both fall back to normal", () => {
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: isoAgo(24 * 9), latestRunEventId: "evt1", nowMs: NOW }),
    "normal"
  );
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: null, latestRunEventId: null, nowMs: NOW }),
    "normal"
  );
});

test("junk and future timestamps never throw or classify", () => {
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: "not-a-date", latestRunEventId: null, nowMs: NOW }),
    "normal"
  );
  assert.equal(
    inferEngineerChatMode({ latestRunCreatedAtIso: isoAgo(-5), latestRunEventId: null, nowMs: NOW }),
    "normal"
  );
});

test("an inferred contract is never named to the driver", () => {
  for (const mode of ["quick", "deep"] as const) {
    assert.match(engineerChatModePromptAddon(mode), /HOW YOU GOT THIS ANSWER MODE/);
    assert.match(engineerChatModePromptAddon(mode), /follow the MESSAGE, not the mode/);
  }
});

test("quick addon carries the trackside contract", () => {
  const addon = engineerChatModePromptAddon("quick");
  assert.match(addon, /ANSWER MODE — QUICK/);
  assert.match(addon, /150 words/);
  assert.match(addon, /No change/);
  assert.match(addon, /TAP-TO-ANSWER/);
});

test("deep addon carries the at-home contract", () => {
  const addon = engineerChatModePromptAddon("deep");
  assert.match(addon, /ANSWER MODE — DEEP/);
  assert.match(addon, /what-ifs|what if/i);
  assert.match(addon, /TAP-TO-ANSWER/);
});

test("normal addon is chip instructions only — no mode contract", () => {
  const addon = engineerChatModePromptAddon("normal");
  assert.doesNotMatch(addon, /ANSWER MODE/);
  assert.match(addon, /TAP-TO-ANSWER/);
});

test("parseChoiceChipsFromReply extracts trailing marker and strips it", () => {
  const reply =
    "Sounds like mid-corner push. Where is it worst?\n[[choices: Entry | Mid-corner | Exit | Everywhere]]";
  const parsed = parseChoiceChipsFromReply(reply);
  assert.deepEqual(parsed.choices, ["Entry", "Mid-corner", "Exit", "Everywhere"]);
  assert.equal(parsed.text, "Sounds like mid-corner push. Where is it worst?");
});

test("parseChoiceChipsFromReply ignores replies without a marker", () => {
  const parsed = parseChoiceChipsFromReply("Thicker front oil, one step (per damper-oil.md).");
  assert.equal(parsed.choices, null);
  assert.equal(parsed.text, "Thicker front oil, one step (per damper-oil.md).");
});

test("marker mid-message is not treated as chips", () => {
  const reply = "[[choices: A | B]] is the marker format.\nReal advice follows here.";
  const parsed = parseChoiceChipsFromReply(reply);
  assert.equal(parsed.choices, null);
  assert.equal(parsed.text, reply);
});

test("single-option and empty markers are stripped but produce no chips", () => {
  const parsed = parseChoiceChipsFromReply("Which end?\n[[choices: Front]]");
  assert.equal(parsed.choices, null);
  assert.equal(parsed.text, "Which end?");
});

test("caps at 5 options and drops over-long ones", () => {
  const parsed = parseChoiceChipsFromReply(
    `Pick one:\n[[choices: A | B | C | D | E | F | ${"x".repeat(60)}]]`
  );
  assert.deepEqual(parsed.choices, ["A", "B", "C", "D", "E"]);
});

console.log("engineerChatMode.test.ts OK");
