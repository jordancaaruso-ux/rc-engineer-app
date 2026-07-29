/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChoiceChips.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChoiceChipsFromReply } from "@/lib/engineerPhase5/engineerChoiceChips";

test("parseChoiceChipsFromReply extracts trailing marker and strips it", () => {
  const reply = "Where does it push — entry or mid?\n[[choices: Entry | Mid-corner | Exit | Everywhere]]";
  const parsed = parseChoiceChipsFromReply(reply);
  assert.equal(parsed.text, "Where does it push — entry or mid?");
  assert.deepEqual(parsed.choices, ["Entry", "Mid-corner", "Exit", "Everywhere"]);
});

test("parseChoiceChipsFromReply ignores replies without a marker", () => {
  const parsed = parseChoiceChipsFromReply("Thicker front oil, one step.");
  assert.equal(parsed.choices, null);
});

test("marker mid-reply is not treated as chips (final line only)", () => {
  const reply = "Options like [[choices: A | B]] belong at the end.\nMore prose after.";
  const parsed = parseChoiceChipsFromReply(reply);
  assert.equal(parsed.choices, null);
});

test("single option collapses to no chips", () => {
  const parsed = parseChoiceChipsFromReply("Which end?\n[[choices: Front]]");
  assert.equal(parsed.choices, null);
  assert.equal(parsed.text, "Which end?");
});

test("chips cap at five and drop empty/oversized entries", () => {
  const parsed = parseChoiceChipsFromReply(
    "Pick one\n[[choices: A | B | C | D | E | F | | " + "x".repeat(50) + "]]"
  );
  assert.deepEqual(parsed.choices, ["A", "B", "C", "D", "E"]);
});

console.log("engineerChoiceChips.test.ts OK");
