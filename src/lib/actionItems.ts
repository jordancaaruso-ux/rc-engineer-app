import { type ActionItemListKind } from "@prisma/client";
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
