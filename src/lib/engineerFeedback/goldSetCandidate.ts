import "server-only";

import { prisma } from "@/lib/prisma";
import type { EngineerMessageContextSnapshot, PersistedChatExchange } from "@/lib/engineerFeedback/types";
import type { EngineerReviewerResult } from "@/lib/engineerFeedback/reviewerParse";
import {
  hashQuestion,
  shouldCaptureGoldSetCandidate,
  slugifyGoldCaseId,
} from "@/lib/engineerFeedback/goldSetCandidateUtil";

export type { GoldSetCase } from "@/lib/engineerFeedback/goldSetCandidateUtil";
export {
  goldCasesFromCandidates,
  hashQuestion,
  mergeGoldSetCases,
  shouldCaptureGoldSetCandidate,
  slugifyGoldCaseId,
} from "@/lib/engineerFeedback/goldSetCandidateUtil";

export type GoldSetCandidateStatus = "pending" | "promoted" | "dismissed";

export async function captureFounderGoldSetCandidate(params: {
  userId: string;
  userEmail: string | null | undefined;
  exchange: PersistedChatExchange;
}): Promise<{ created: boolean; id?: string }> {
  if (!shouldCaptureGoldSetCandidate(params.userEmail)) {
    return { created: false };
  }

  const ctx = params.exchange.ratingContext;
  const question = ctx.question?.trim() ?? "";
  const answer = ctx.answer?.trim() ?? "";
  if (!question || !answer) return { created: false };

  const questionHash = hashQuestion(question);

  try {
    const row = await prisma.engineerGoldSetCandidate.create({
      data: {
        userId: params.userId,
        threadId: params.exchange.threadId,
        assistantMessageId: params.exchange.assistantMessageId,
        status: "pending",
        question,
        questionHash,
        answer,
        runId: ctx.runId ?? null,
        compareRunId: ctx.compareRunId ?? null,
        kbSections: ctx.kbSections ?? [],
        source: ctx.source ?? null,
      },
      select: { id: true },
    });
    return { created: true, id: row.id };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return { created: false };
    throw err;
  }
}

export function reviewerFromJson(value: unknown): EngineerReviewerResult | null {
  if (!value || typeof value !== "object") return null;
  const scoreRaw = (value as { score?: unknown }).score;
  const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
  if (!Number.isFinite(score)) return null;
  const tagsRaw = (value as { tags?: unknown }).tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is EngineerReviewerResult["tags"][number] => typeof t === "string")
    : [];
  const rationaleRaw = (value as { rationale?: unknown }).rationale;
  const rationale = typeof rationaleRaw === "string" ? rationaleRaw : "";
  return { score: Math.min(5, Math.max(1, Math.round(score))), tags, rationale };
}

export function formatGoldSetReviewMarkdown(
  rows: Array<{
    id: string;
    question: string;
    answer: string;
    runId: string | null;
    compareRunId: string | null;
    createdAt: Date;
    promotedCaseId: string | null;
    reviewerJson: unknown;
    status: string;
  }>
): string {
  const lines = [
    "# Engineer gold-set review",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  for (const row of rows) {
    const label = row.promotedCaseId ?? row.id.slice(0, 8);
    const date = row.createdAt.toISOString().slice(0, 10);
    lines.push(`## ${label} (${date})`);
    lines.push(`**Status:** ${row.status}`);
    lines.push(`**Question:** ${row.question}`);
    lines.push(
      `**Run:** \`${row.runId ?? "—"}\` | **Compare:** \`${row.compareRunId ?? "—"}\``
    );
    lines.push(`**Answer:** ${row.answer}`);
    const review = reviewerFromJson(row.reviewerJson);
    if (review) {
      lines.push(`**Reviewer:** ${review.score}/5 — ${review.tags.join(", ") || "—"}`);
      lines.push(`**Rationale:** ${review.rationale}`);
    } else {
      lines.push("**Reviewer:** _(not run)_");
    }
    lines.push("**Promote:** [ ]");
    lines.push("");
  }

  return lines.join("\n");
}

export type GoldSetCandidateRow = {
  id: string;
  status: GoldSetCandidateStatus;
  question: string;
  answer: string;
  runId: string | null;
  compareRunId: string | null;
  kbSections: string[];
  source: string | null;
  threadId: string;
  assistantMessageId: string;
  createdAt: string;
  updatedAt: string;
  promotedCaseId: string | null;
  promotedAt: string | null;
  reviewer: EngineerReviewerResult | null;
  reviewerReviewedAt: string | null;
};

export function serializeGoldSetCandidate(row: {
  id: string;
  status: string;
  question: string;
  answer: string;
  runId: string | null;
  compareRunId: string | null;
  kbSections: unknown;
  source: string | null;
  threadId: string;
  assistantMessageId: string;
  createdAt: Date;
  updatedAt: Date;
  promotedCaseId: string | null;
  promotedAt: Date | null;
  reviewerJson: unknown;
  reviewerReviewedAt: Date | null;
}): GoldSetCandidateRow {
  const kbSections = Array.isArray(row.kbSections)
    ? row.kbSections.filter((s): s is string => typeof s === "string")
    : [];
  return {
    id: row.id,
    status: row.status as GoldSetCandidateStatus,
    question: row.question,
    answer: row.answer,
    runId: row.runId,
    compareRunId: row.compareRunId,
    kbSections,
    source: row.source,
    threadId: row.threadId,
    assistantMessageId: row.assistantMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    promotedCaseId: row.promotedCaseId,
    promotedAt: row.promotedAt?.toISOString() ?? null,
    reviewer: reviewerFromJson(row.reviewerJson),
    reviewerReviewedAt: row.reviewerReviewedAt?.toISOString() ?? null,
  };
}

export async function nextPromotedCaseId(question: string): Promise<string> {
  const promoted = await prisma.engineerGoldSetCandidate.findMany({
    where: { promotedCaseId: { not: null } },
    select: { promotedCaseId: true },
  });
  const taken = new Set(
    promoted.map((r) => r.promotedCaseId).filter((id): id is string => Boolean(id))
  );
  return slugifyGoldCaseId(question, taken);
}

export function snapshotFromCandidate(row: {
  question: string;
  answer: string;
  runId: string | null;
  compareRunId: string | null;
  kbSections: unknown;
  source: string | null;
}): EngineerMessageContextSnapshot {
  const kbSections = Array.isArray(row.kbSections)
    ? row.kbSections.filter((s): s is string => typeof s === "string")
    : [];
  return {
    question: row.question,
    answer: row.answer,
    runId: row.runId,
    compareRunId: row.compareRunId,
    kbSections,
    source: row.source ?? undefined,
  };
}
