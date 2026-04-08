import type { ActionItemSourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Trim + lowercase for dedupe (exact match only). */
export function normalizeActionItemKey(text: string): string {
  return text.trim().toLowerCase();
}

/** Split "Things to try" textarea into bullet lines (• prefix optional). */
export function parseThingsToTryLines(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.replace(/^\s*•\s?/, "").trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Single source of truth: active ActionItem rows match the current bullet list.
 * New rows use `newItemSource`; existing normKeys are left unchanged (type/run link preserved).
 */
export async function reconcileUserActionItemsFromLines(params: {
  userId: string;
  rawSuggested: string | null | undefined;
  newItemSource: { sourceType: ActionItemSourceType; sourceRunId: string | null };
}): Promise<void> {
  const lines = parseThingsToTryLines(params.rawSuggested ?? null);
  const wantedKeys = lines.map((t) => normalizeActionItemKey(t)).filter(Boolean);

  if (wantedKeys.length === 0) {
    await prisma.actionItem.updateMany({
      where: { userId: params.userId, isArchived: false },
      data: { isArchived: true },
    });
  } else {
    await prisma.actionItem.updateMany({
      where: {
        userId: params.userId,
        isArchived: false,
        NOT: { normKey: { in: wantedKeys } },
      },
      data: { isArchived: true },
    });
  }

  for (const text of lines) {
    const normKey = normalizeActionItemKey(text);
    if (!normKey) continue;

    const existing = await prisma.actionItem.findFirst({
      where: {
        userId: params.userId,
        normKey,
        isArchived: false,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.actionItem.create({
      data: {
        userId: params.userId,
        text: text.trim(),
        normKey,
        sourceType: params.newItemSource.sourceType,
        sourceRunId: params.newItemSource.sourceRunId,
      },
    });
  }
}

export async function syncActionItemsFromRun(params: {
  userId: string;
  runId: string;
  suggestedChanges: string | null | undefined;
}): Promise<void> {
  await reconcileUserActionItemsFromLines({
    userId: params.userId,
    rawSuggested: params.suggestedChanges,
    newItemSource: { sourceType: "RUN", sourceRunId: params.runId },
  });
}

/** Persist “Things to try” while editing Log your run (before save). */
export async function syncActionItemsFromLogFormDraft(params: {
  userId: string;
  suggestedChanges: string | null | undefined;
}): Promise<void> {
  await reconcileUserActionItemsFromLines({
    userId: params.userId,
    rawSuggested: params.suggestedChanges,
    newItemSource: { sourceType: "MANUAL", sourceRunId: null },
  });
}
