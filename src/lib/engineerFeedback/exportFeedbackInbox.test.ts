/**
 * Run: npx tsx src/lib/engineerFeedback/exportFeedbackInbox.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ratingRowToInboxEntry,
  serializeInboxJsonl,
  serializeInboxMarkdown,
  isFeedbackFilesystemExportMode,
} from "@/lib/engineerFeedback/exportFeedbackInbox";

test("ratingRowToInboxEntry maps DB row to inbox shape", () => {
  const entry = ratingRowToInboxEntry({
    id: "rating_1",
    stars: 4,
    note: "Missed compare context",
    updatedAt: new Date("2026-06-20T12:00:00.000Z"),
    user: { email: "founder@example.com" },
    message: {
      id: "msg_1",
      content: "Try more rear camber.",
      metadataJson: {
        question: "Why is it loose mid?",
        kbSections: ["camber-rear"],
        runId: "run_a",
        compareRunId: "run_b",
      },
      thread: { id: "thread_1", primaryRunId: "run_a", compareRunId: "run_b" },
    },
  });

  assert.equal(entry.score, 4);
  assert.equal(entry.userEmail, "founder@example.com");
  assert.equal(entry.question, "Why is it loose mid?");
  assert.equal(entry.messageId, "msg_1");
  assert.equal(entry.threadId, "thread_1");
  assert.deepEqual(entry.kbSections, ["camber-rear"]);
});

test("serializeInboxJsonl emits one JSON object per line", () => {
  const lines = serializeInboxJsonl([
    {
      timestamp: "2026-06-20T12:00:00.000Z",
      userEmail: "founder@example.com",
      score: 3,
      note: null,
      question: "Q?",
      answer: "A.",
      runId: "run_a",
      compareRunId: null,
      kbSections: [],
      messageId: "msg_1",
      threadId: "thread_1",
      ratingId: "rating_1",
    },
  ]).trim();

  assert.equal(lines.split("\n").length, 1);
  const parsed = JSON.parse(lines) as { score: number; messageId: string };
  assert.equal(parsed.score, 3);
  assert.equal(parsed.messageId, "msg_1");
});

test("serializeInboxMarkdown includes score and question", () => {
  const md = serializeInboxMarkdown([
    {
      timestamp: "2026-06-20T12:00:00.000Z",
      userEmail: "founder@example.com",
      score: 2,
      note: "Wrong physics",
      question: "Should I add front toe?",
      answer: "Yes, add toe.",
      runId: null,
      compareRunId: null,
      kbSections: ["toe-front"],
      messageId: "msg_2",
      threadId: "thread_2",
      ratingId: "rating_2",
    },
  ]);

  assert.match(md, /score 2\/10/);
  assert.match(md, /Should I add front toe\?/);
  assert.match(md, /Wrong physics/);
});

test("isFeedbackFilesystemExportMode is true only in development", () => {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  env.NODE_ENV = "development";
  assert.equal(isFeedbackFilesystemExportMode(), true);
  env.NODE_ENV = "production";
  assert.equal(isFeedbackFilesystemExportMode(), false);
  env.NODE_ENV = original;
});
