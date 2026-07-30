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
  parseFeedbackFilterArgs,
  filterInboxEntries,
  feedbackFilterSummary,
  type FeedbackInboxEntry,
} from "@/lib/engineerFeedback/exportFeedbackInboxUtil";
import {
  ENGINEER_PROMPT_LABEL,
  formatEngineerPromptVersion,
} from "@/lib/engineerPhase5/promptVersion";

function entry(overrides: Partial<FeedbackInboxEntry> = {}): FeedbackInboxEntry {
  return {
    timestamp: "2026-06-20T12:00:00.000Z",
    userEmail: "founder@example.com",
    score: 5,
    note: null,
    question: "Q?",
    answer: "A.",
    runId: null,
    compareRunId: null,
    kbSections: [],
    promptVersion: null,
    messageId: "msg_1",
    threadId: "thread_1",
    ratingId: "rating_1",
    ...overrides,
  };
}

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
        promptVersion: "2026-07-30+deadbeef",
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
  assert.equal(entry.promptVersion, "2026-07-30+deadbeef");
});

test("ratingRowToInboxEntry leaves promptVersion null for pre-stamp answers", () => {
  const mapped = ratingRowToInboxEntry({
    id: "rating_old",
    stars: 7,
    note: null,
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    user: { email: "founder@example.com" },
    message: {
      id: "msg_old",
      content: "Older answer.",
      metadataJson: { question: "Q?" },
      thread: { id: "thread_old", primaryRunId: null, compareRunId: null },
    },
  });
  assert.equal(mapped.promptVersion, null);
});

test("serializeInboxJsonl emits one JSON object per line", () => {
  const lines = serializeInboxJsonl([entry({ score: 3, runId: "run_a" })]).trim();

  assert.equal(lines.split("\n").length, 1);
  const parsed = JSON.parse(lines) as { score: number; messageId: string };
  assert.equal(parsed.score, 3);
  assert.equal(parsed.messageId, "msg_1");
});

test("serializeInboxMarkdown includes score and question", () => {
  const md = serializeInboxMarkdown([
    entry({
      score: 2,
      note: "Wrong physics",
      question: "Should I add front toe?",
      answer: "Yes, add toe.",
      kbSections: ["toe-front"],
      promptVersion: "2026-07-30+deadbeef",
    }),
  ]);

  assert.match(md, /score 2\/10/);
  assert.match(md, /Should I add front toe\?/);
  assert.match(md, /Wrong physics/);
  assert.match(md, /Prompt version:\*\* `2026-07-30\+deadbeef`/);
  assert.doesNotMatch(md, /Partial export/);
});

test("serializeInboxMarkdown flags a filtered export as partial", () => {
  const md = serializeInboxMarkdown([entry()], { filterSummary: "4 most recent" });
  assert.match(md, /\*\*Partial export — filtered to 4 most recent\.\*\*/);
});

test("serializeInboxMarkdown says no match rather than no ratings when filtered", () => {
  assert.match(serializeInboxMarkdown([], { filterSummary: "4 most recent" }), /No ratings matched/);
  assert.match(serializeInboxMarkdown([]), /No ratings yet/);
});

test("parseFeedbackFilterArgs reads space- and equals-separated flags", () => {
  assert.deepEqual(parseFeedbackFilterArgs(["--limit", "4"]), { limit: 4 });
  assert.deepEqual(parseFeedbackFilterArgs(["--limit=4"]), { limit: 4 });
  assert.equal(parseFeedbackFilterArgs(["--prompt-version=v1"]).promptVersion, "v1");
  assert.equal(
    parseFeedbackFilterArgs(["--since", "2026-07-30"]).since?.toISOString(),
    "2026-07-30T00:00:00.000Z"
  );
  assert.deepEqual(parseFeedbackFilterArgs([]), {});
});

test("parseFeedbackFilterArgs combines flags and does not treat a value as a flag", () => {
  const filter = parseFeedbackFilterArgs(["--since", "2026-07-30", "--limit", "2"]);
  assert.equal(filter.limit, 2);
  assert.equal(filter.since?.toISOString(), "2026-07-30T00:00:00.000Z");
});

test("parseFeedbackFilterArgs throws instead of silently exporting everything", () => {
  assert.throws(() => parseFeedbackFilterArgs(["--limit", "0"]), /Bad --limit/);
  assert.throws(() => parseFeedbackFilterArgs(["--limit", "two"]), /Bad --limit/);
  assert.throws(() => parseFeedbackFilterArgs(["--since", "notadate"]), /Bad --since/);
  assert.throws(() => parseFeedbackFilterArgs(["--limit"]), /Missing value/);
  assert.throws(() => parseFeedbackFilterArgs(["--newest", "4"]), /Unknown flag/);
});

test("filterInboxEntries applies promptVersion then limit, newest-first", () => {
  const entries = [
    entry({ ratingId: "r1", promptVersion: "v2" }),
    entry({ ratingId: "r2", promptVersion: "v1" }),
    entry({ ratingId: "r3", promptVersion: "v2" }),
  ];
  assert.deepEqual(
    filterInboxEntries(entries, { promptVersion: "v2" }).map((e) => e.ratingId),
    ["r1", "r3"]
  );
  assert.deepEqual(
    filterInboxEntries(entries, { limit: 2 }).map((e) => e.ratingId),
    ["r1", "r2"]
  );
  assert.deepEqual(
    filterInboxEntries(entries, { promptVersion: "v2", limit: 1 }).map((e) => e.ratingId),
    ["r1"]
  );
  assert.equal(filterInboxEntries(entries).length, 3);
});

test("feedbackFilterSummary is null when nothing is filtered", () => {
  assert.equal(feedbackFilterSummary({}), null);
  assert.match(feedbackFilterSummary({ limit: 4 }) ?? "", /4 most recent/);
});

test("engineer prompt version is a stable label+fingerprint", () => {
  const a = formatEngineerPromptVersion(ENGINEER_PROMPT_LABEL, "prompt text");
  const b = formatEngineerPromptVersion(ENGINEER_PROMPT_LABEL, "prompt text");
  const c = formatEngineerPromptVersion(ENGINEER_PROMPT_LABEL, "prompt text edited");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, new RegExp(`^${ENGINEER_PROMPT_LABEL}\\+[0-9a-f]{8}$`));
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
