import {
  type ActionItemListKind,
  type ActionItemSourceType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Trim + lowercase for dedupe (exact match only) within a list kind. */
export function normalizeActionItemKey(text: string): string {
  return text.trim().toLowerCase();
}

export function parseActionItemListQuery(v: string | null): ActionItemListKind {
  const t = (v ?? "").toLowerCase();
  if (t === "do" || t === "things_to_do" || t === "prerun") return "THINGS_TO_DO";
  if (t === "try" || t === "things_to_try" || t === "") return "THINGS_TO_TRY";
  return "THINGS_TO_TRY";
}

/** Split bullet textarea into lines (• prefix optional). */
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
 * Single list kind: active ActionItem rows match the current bullet list.
 * New rows use `newItemSource`; existing normKeys are left unchanged (type/run link preserved).
 */
export async function reconcileUserActionItemsFromLines(params: {
  userId: string;
  rawSuggested: string | null | undefined;
  newItemSource: { sourceType: ActionItemSourceType; sourceRunId: string | null };
  listKind: ActionItemListKind;
}): Promise<void> {
  const lines = parseThingsToTryLines(params.rawSuggested ?? null);
  const wantedKeysInOrder: string[] = [];
  const seen = new Set<string>();
  for (const text of lines) {
    const k = normalizeActionItemKey(text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    wantedKeysInOrder.push(k);
  }

  if (wantedKeysInOrder.length === 0) {
    await prisma.actionItem.updateMany({
      where: { userId: params.userId, listKind: params.listKind, isArchived: false },
      data: { isArchived: true },
    });
    return;
  }

  await prisma.actionItem.updateMany({
    where: {
      userId: params.userId,
      listKind: params.listKind,
      isArchived: false,
      NOT: { normKey: { in: wantedKeysInOrder } },
    },
    data: { isArchived: true },
  });

  for (const text of lines) {
    const normKey = normalizeActionItemKey(text);
    if (!normKey) continue;

    const existing = await prisma.actionItem.findFirst({
      where: {
        userId: params.userId,
        listKind: params.listKind,
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
        listKind: params.listKind,
        sortOrder: 0,
        sourceType: params.newItemSource.sourceType,
        sourceRunId: params.newItemSource.sourceRunId,
      },
    });
  }

  const items = await prisma.actionItem.findMany({
    where: {
      userId: params.userId,
      listKind: params.listKind,
      isArchived: false,
      normKey: { in: wantedKeysInOrder },
    },
    select: { id: true, normKey: true },
  });
  const byKey = new Map(items.map((i) => [i.normKey, i.id]));
  const sortUpdates = wantedKeysInOrder
    .map((k, i) => {
      const id = byKey.get(k);
      if (!id) return null;
      return prisma.actionItem.update({ where: { id }, data: { sortOrder: i } });
    })
    .filter((p): p is NonNullable<typeof p> => p != null);
  if (sortUpdates.length > 0) {
    await prisma.$transaction(sortUpdates);
  }
}

export async function syncActionItemsFromRun(params: {
  userId: string;
  runId: string;
  suggestedChanges: string | null | undefined;
  suggestedPreRun?: string | null | undefined;
}): Promise<void> {
  const src = { sourceType: "RUN" as const, sourceRunId: params.runId };
  await reconcileUserActionItemsFromLines({
    userId: params.userId,
    rawSuggested: params.suggestedChanges,
    newItemSource: src,
    listKind: "THINGS_TO_TRY",
  });
  if (params.suggestedPreRun !== undefined) {
    await reconcileUserActionItemsFromLines({
      userId: params.userId,
      rawSuggested: params.suggestedPreRun,
      newItemSource: src,
      listKind: "THINGS_TO_DO",
    });
  }
}

/**
 * Debounced client sync: only keys present on `params` are reconciled so the other
 * list is not cleared before it hydrates (use `hasOwnProperty` / build partial objects).
 */
export async function syncActionItemsFromLogFormDraft(params: {
  userId: string;
  suggestedChanges?: string | null;
  suggestedPreRun?: string | null;
}): Promise<void> {
  const src = { sourceType: "MANUAL" as const, sourceRunId: null as string | null };
  if (Object.prototype.hasOwnProperty.call(params, "suggestedChanges")) {
    await reconcileUserActionItemsFromLines({
      userId: params.userId,
      rawSuggested: params.suggestedChanges,
      newItemSource: src,
      listKind: "THINGS_TO_TRY",
    });
  }
  if (Object.prototype.hasOwnProperty.call(params, "suggestedPreRun")) {
    await reconcileUserActionItemsFromLines({
      userId: params.userId,
      rawSuggested: params.suggestedPreRun,
      newItemSource: src,
      listKind: "THINGS_TO_DO",
    });
  }
}

export async function reorderUserActionItems(params: {
  userId: string;
  listKind: ActionItemListKind;
  orderedIds: string[];
}): Promise<void> {
  if (params.orderedIds.length === 0) return;
  if (new Set(params.orderedIds).size !== params.orderedIds.length) {
    throw new Error("Duplicate id in order");
  }
  const rows = await prisma.actionItem.findMany({
    where: {
      id: { in: params.orderedIds },
      userId: params.userId,
      listKind: params.listKind,
      isArchived: false,
    },
    select: { id: true },
  });
  if (rows.length !== params.orderedIds.length) {
    throw new Error("Invalid or mismatched action item ids");
  }
  await prisma.$transaction(
    params.orderedIds.map((id, i) =>
      prisma.actionItem.update({
        where: { id },
        data: { sortOrder: i },
      })
    )
  );
}
