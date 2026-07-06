/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChatMode.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineerChatModePromptAddon,
  parseChoiceChipsFromReply,
  parseEngineerChatMode,
} from "@/lib/engineerPhase5/engineerChatMode";

test("parseEngineerChatMode accepts known modes and defaults to normal", () => {
  assert.equal(parseEngineerChatMode("quick"), "quick");
  assert.equal(parseEngineerChatMode("deep"), "deep");
  assert.equal(parseEngineerChatMode("normal"), "normal");
  assert.equal(parseEngineerChatMode("QUICK"), "normal");
  assert.equal(parseEngineerChatMode(undefined), "normal");
  assert.equal(parseEngineerChatMode(42), "normal");
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
