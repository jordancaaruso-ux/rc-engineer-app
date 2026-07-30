import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { adminFeedbackRatingWhere } from "@/lib/engineerFeedback/adminFeedbackAccess";
import {
  feedbackFilterSummary,
  filterInboxEntries,
  ratingRowToInboxEntry,
  serializeInboxJsonl,
  serializeInboxMarkdown,
  type FeedbackInboxEntry,
  type FeedbackInboxFilter,
} from "@/lib/engineerFeedback/exportFeedbackInboxUtil";

export {
  feedbackFilterSummary,
  filterInboxEntries,
  isFeedbackFilesystemExportMode,
  parseFeedbackFilterArgs,
  ratingRowToInboxEntry,
  serializeInboxJsonl,
  serializeInboxMarkdown,
  type FeedbackInboxEntry,
  type FeedbackInboxFilter,
} from "@/lib/engineerFeedback/exportFeedbackInboxUtil";

export const FEEDBACK_INBOX_DIR = path.join(process.cwd(), "docs/engineer-feedback");
export const FEEDBACK_INBOX_JSONL = path.join(FEEDBACK_INBOX_DIR, "inbox.jsonl");
export const FEEDBACK_INBOX_MD = path.join(FEEDBACK_INBOX_DIR, "inbox.md");

export async function fetchFeedbackInboxEntries(
  filter: FeedbackInboxFilter = {}
): Promise<FeedbackInboxEntry[]> {
  const rows = await prisma.engineerMessageRating.findMany({
    where: {
      ...adminFeedbackRatingWhere(),
      ...(filter.since ? { updatedAt: { gte: filter.since } } : {}),
    },
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

  return filterInboxEntries(rows.map(ratingRowToInboxEntry), filter);
}

export async function writeFeedbackInboxFiles(
  entries?: FeedbackInboxEntry[],
  filter: FeedbackInboxFilter = {}
): Promise<{
  jsonlPath: string;
  mdPath: string;
  count: number;
}> {
  const resolved = entries ?? (await fetchFeedbackInboxEntries(filter));
  const filterSummary = feedbackFilterSummary(filter);
  await fs.mkdir(FEEDBACK_INBOX_DIR, { recursive: true });
  await fs.writeFile(FEEDBACK_INBOX_JSONL, serializeInboxJsonl(resolved), "utf8");
  await fs.writeFile(FEEDBACK_INBOX_MD, serializeInboxMarkdown(resolved, { filterSummary }), "utf8");
  return { jsonlPath: FEEDBACK_INBOX_JSONL, mdPath: FEEDBACK_INBOX_MD, count: resolved.length };
}
