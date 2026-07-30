/**
 * Pure shaping/serialization for the feedback inbox export. Kept free of prisma and
 * fs so it is unit-testable; the DB + file side lives in exportFeedbackInbox.ts.
 */
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
  promptVersion: string | null;
  messageId: string;
  threadId: string;
  ratingId: string;
};

/**
 * Narrows an export to one batch of ratings. Entries are newest-first, so `limit`
 * means "the N most recent that match the other filters".
 */
export type FeedbackInboxFilter = {
  since?: Date;
  limit?: number;
  promptVersion?: string;
};

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
    promptVersion: ctx.promptVersion ?? null,
    messageId: row.message.id,
    threadId: row.message.thread.id,
    ratingId: row.id,
  };
}

/** Human-readable description of an export's filters, or null when unfiltered. */
export function feedbackFilterSummary(filter: FeedbackInboxFilter): string | null {
  const parts: string[] = [];
  if (filter.limit !== undefined) parts.push(`${filter.limit} most recent`);
  if (filter.since) parts.push(`rated on or after ${filter.since.toISOString()}`);
  if (filter.promptVersion) parts.push(`prompt version \`${filter.promptVersion}\``);
  return parts.length ? parts.join(" · ") : null;
}

/** Applies the filters that cannot be pushed into the query (snapshot JSON, then limit). */
export function filterInboxEntries(
  entries: FeedbackInboxEntry[],
  filter: FeedbackInboxFilter = {}
): FeedbackInboxEntry[] {
  let out = entries;
  if (filter.promptVersion) {
    out = out.filter((e) => e.promptVersion === filter.promptVersion);
  }
  if (filter.limit !== undefined) {
    out = out.slice(0, Math.max(0, filter.limit));
  }
  return out;
}

function startOfLocalDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Parses `--since <iso|YYYY-MM-DD|today> --limit <n> --prompt-version <v>` for the
 * export script. Throws on anything it does not understand rather than exporting
 * the whole history by accident.
 */
export function parseFeedbackFilterArgs(argv: string[]): FeedbackInboxFilter {
  const filter: FeedbackInboxFilter = {};
  const valueFor = (raw: string, index: number): string => {
    const inline = raw.indexOf("=");
    const value = inline >= 0 ? raw.slice(inline + 1) : argv[index + 1];
    if (!value) throw new Error(`Missing value for ${inline >= 0 ? raw.slice(0, inline) : raw}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const flag = raw.split("=")[0];
    const consumesNext = !raw.includes("=");
    if (flag === "--since") {
      const value = valueFor(raw, i);
      const parsed = value === "today" ? startOfLocalDay() : new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new Error(`Bad --since date: ${value}`);
      filter.since = parsed;
    } else if (flag === "--limit") {
      const value = valueFor(raw, i);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Bad --limit: ${value}`);
      filter.limit = parsed;
    } else if (flag === "--prompt-version") {
      filter.promptVersion = valueFor(raw, i);
    } else {
      throw new Error(`Unknown flag: ${flag}`);
    }
    if (consumesNext) i += 1;
  }
  return filter;
}

export function serializeInboxJsonl(entries: FeedbackInboxEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

export function serializeInboxMarkdown(
  entries: FeedbackInboxEntry[],
  opts: { filterSummary?: string | null } = {}
): string {
  const generatedAt = new Date().toISOString();
  const lines: string[] = [
    "# Engineer feedback inbox",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.",
    "",
  ];

  if (opts.filterSummary) {
    lines.push(
      `**Partial export — filtered to ${opts.filterSummary}.** This is not the full rating history; re-run without filters for everything.`,
      ""
    );
  }

  if (entries.length === 0) {
    lines.push(opts.filterSummary ? "_No ratings matched the filter._" : "_No ratings yet._", "");
    return lines.join("\n");
  }

  for (const e of entries) {
    lines.push(`## ${e.timestamp} — score ${e.score}/10`);
    lines.push("");
    lines.push(`- **User:** ${e.userEmail ?? "(unknown)"}`);
    lines.push(`- **Message:** \`${e.messageId}\` · **Thread:** \`${e.threadId}\``);
    if (e.runId) lines.push(`- **Run:** \`${e.runId}\`${e.compareRunId ? ` · **Compare:** \`${e.compareRunId}\`` : ""}`);
    if (e.kbSections.length) lines.push(`- **KB sections:** ${e.kbSections.join(", ")}`);
    if (e.promptVersion) lines.push(`- **Prompt version:** \`${e.promptVersion}\``);
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
