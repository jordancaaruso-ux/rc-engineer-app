import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { adminFeedbackRatingWhere } from "@/lib/engineerFeedback/adminFeedbackAccess";
import type { EngineerMessageContextSnapshot } from "@/lib/engineerFeedback/types";

export type FeedbackInboxEntry = {
  timestamp: string;
  userEmail: string | null;
  score: number;
  note: string | null;
  question: string | null;
  answer: string | null;
  runId: string | null;
  compareRunId: string | null;
  kbSections: string[];
  messageId: string;
  threadId: string;
  ratingId: string;
};

export const FEEDBACK_INBOX_DIR = path.join(process.cwd(), "docs/engineer-feedback");
export const FEEDBACK_INBOX_JSONL = path.join(FEEDBACK_INBOX_DIR, "inbox.jsonl");
export const FEEDBACK_INBOX_MD = path.join(FEEDBACK_INBOX_DIR, "inbox.md");

/** Local dev writes repo files; production returns a downloadable zip. */
export function isFeedbackFilesystemExportMode(): boolean {
  return process.env.NODE_ENV === "development";
}

function snapshotFromRow(
  snapshot: unknown,
  messageContent: string,
  thread: { primaryRunId: string | null; compareRunId: string | null }
): EngineerMessageContextSnapshot {
  const base: EngineerMessageContextSnapshot = {
    answer: messageContent,
    runId: thread.primaryRunId,
    compareRunId: thread.compareRunId,
  };
  if (!snapshot || typeof snapshot !== "object") return base;
  return { ...base, ...(snapshot as EngineerMessageContextSnapshot) };
}

export function ratingRowToInboxEntry(row: {
  id: string;
  stars: number;
  note: string | null;
  updatedAt: Date;
  user: { email: string | null };
  message: {
    id: string;
    content: string;
    metadataJson: unknown;
    thread: { id: string; primaryRunId: string | null; compareRunId: string | null };
  };
}): FeedbackInboxEntry {
  const ctx = snapshotFromRow(row.message.metadataJson, row.message.content, row.message.thread);
  return {
    timestamp: row.updatedAt.toISOString(),
    userEmail: row.user.email,
    score: row.stars,
    note: row.note,
    question: ctx.question ?? null,
    answer: ctx.answer ?? row.message.content,
    runId: ctx.runId ?? row.message.thread.primaryRunId,
    compareRunId: ctx.compareRunId ?? row.message.thread.compareRunId,
    kbSections: ctx.kbSections ?? [],
    messageId: row.message.id,
    threadId: row.message.thread.id,
    ratingId: row.id,
  };
}

export function serializeInboxJsonl(entries: FeedbackInboxEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

export function serializeInboxMarkdown(entries: FeedbackInboxEntry[]): string {
  const generatedAt = new Date().toISOString();
  const lines: string[] = [
    "# Engineer feedback inbox",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.",
    "",
  ];

  if (entries.length === 0) {
    lines.push("_No ratings yet._", "");
    return lines.join("\n");
  }

  for (const e of entries) {
    lines.push(`## ${e.timestamp} — score ${e.score}/10`);
    lines.push("");
    lines.push(`- **User:** ${e.userEmail ?? "(unknown)"}`);
    lines.push(`- **Message:** \`${e.messageId}\` · **Thread:** \`${e.threadId}\``);
    if (e.runId) lines.push(`- **Run:** \`${e.runId}\`${e.compareRunId ? ` · **Compare:** \`${e.compareRunId}\`` : ""}`);
    if (e.kbSections.length) lines.push(`- **KB sections:** ${e.kbSections.join(", ")}`);
    lines.push("");
    lines.push("**Question:**");
    lines.push("");
    lines.push(e.question ?? "(not captured)");
    lines.push("");
    lines.push("**Answer:**");
    lines.push("");
    lines.push(e.answer ?? "(not captured)");
    lines.push("");
    if (e.note) {
      lines.push("**Note:**");
      lines.push("");
      lines.push(e.note);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export async function fetchFeedbackInboxEntries(): Promise<FeedbackInboxEntry[]> {
  const rows = await prisma.engineerMessageRating.findMany({
    where: adminFeedbackRatingWhere(),
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stars: true,
      note: true,
      updatedAt: true,
      user: { select: { email: true } },
      message: {
        select: {
          id: true,
          content: true,
          metadataJson: true,
          thread: {
            select: {
              id: true,
              primaryRunId: true,
              compareRunId: true,
            },
          },
        },
      },
    },
  });

  return rows.map(ratingRowToInboxEntry);
}

export async function writeFeedbackInboxFiles(entries?: FeedbackInboxEntry[]): Promise<{
  jsonlPath: string;
  mdPath: string;
  count: number;
}> {
  const resolved = entries ?? (await fetchFeedbackInboxEntries());
  await fs.mkdir(FEEDBACK_INBOX_DIR, { recursive: true });
  await fs.writeFile(FEEDBACK_INBOX_JSONL, serializeInboxJsonl(resolved), "utf8");
  await fs.writeFile(FEEDBACK_INBOX_MD, serializeInboxMarkdown(resolved), "utf8");
  return { jsonlPath: FEEDBACK_INBOX_JSONL, mdPath: FEEDBACK_INBOX_MD, count: resolved.length };
}
