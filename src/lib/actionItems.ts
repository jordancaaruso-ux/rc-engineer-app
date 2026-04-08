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

export async function syncActionItemsFromRun(params: {
  userId: string;
  runId: string;
  suggestedChanges: string | null | undefined;
}): Promise<void> {
  const lines = parseThingsToTryLines(params.suggestedChanges ?? null);
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
        sourceType: "RUN",
        sourceRunId: params.runId,
      },
    });
  }
}
