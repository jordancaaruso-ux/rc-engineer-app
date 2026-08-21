/**
 * Run: `npm run test:engineer-thread-preview`
 *
 * The history card quotes these two strings straight onto the page, so the thing worth
 * guarding is that neither can print markup at a driver: a preview showing `**Front droop**`
 * or a stray `[[choices:…]]` marker reads as a bug, and the answer is where all the markdown
 * lives.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineerAnswerPreviewFromContent,
  engineerThreadTitleFromContent,
} from "@/lib/engineerFeedback/threadTitle";

test("a title is the question on one line, and never empty", () => {
  assert.equal(engineerThreadTitleFromContent("  Loose on\n  entry  "), "Loose on entry");
  assert.equal(engineerThreadTitleFromContent("   "), "New chat");
  const long = engineerThreadTitleFromContent("x".repeat(200));
  assert.ok(long.length <= 72 && long.endsWith("…"));
});

test("an answer preview carries the words and none of the markup", () => {
  const reply = [
    "## What to change",
    "",
    "Go **1mm thinner** on the front droop — it slows the front's weight transfer, so the",
    "car takes longer to roll onto the outside front tyre.",
    "",
    "- Front droop: 3.0 → 2.0mm",
    "- Leave the rear alone",
    "",
    "See [the droop note](/kb/droop) for why.",
    "",
    "[[choices:Try it|Something else]]",
  ].join("\n");

  const preview = engineerAnswerPreviewFromContent(reply);
  assert.ok(preview);
  for (const forbidden of ["**", "##", "[[choices", "](", "- Front"]) {
    assert.ok(!preview.includes(forbidden), `preview still carries ${forbidden}: ${preview}`);
  }
  assert.ok(preview.startsWith("What to change"), preview);
  assert.ok(preview.includes("1mm thinner"), "the words survive, only the emphasis goes");
});

test("a long answer is cut to one readable snippet", () => {
  const preview = engineerAnswerPreviewFromContent(`${"word ".repeat(200)}`);
  assert.ok(preview);
  assert.ok(preview.length <= 150, `too long for two lines: ${preview.length}`);
  assert.ok(preview.endsWith("…"));
});

test("a table-only or empty answer previews as nothing rather than punctuation", () => {
  assert.equal(engineerAnswerPreviewFromContent("   \n\n  "), null);
  assert.equal(engineerAnswerPreviewFromContent("| a | b |\n| - | - |"), null);
});
