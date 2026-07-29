import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Rows per round-trip. Small enough that a rebuild never materializes the whole corpus of
 * parsed setup sheets at once, large enough that the per-query overhead stays irrelevant.
 */
const AGGREGATION_DOC_PAGE_SIZE = 200;

export type AggregationSourceDoc = {
  id: string;
  parsedDataJson: Prisma.JsonValue | null;
  carId: string | null;
  createdSetup: { carId: string | null; data: Prisma.JsonValue } | null;
};

/**
 * Cursor-page setup documents for an aggregation rebuild, yielding one doc at a time.
 *
 * Rebuilds accumulate into order-independent per-parameter buckets, so streaming the docs is
 * equivalent to loading them all up front — but peak memory and the time a single query holds
 * the connection stay flat as the document corpus grows. Callers should pass a `where` that
 * already excludes docs the rebuild would skip, so the fat `parsedDataJson` blob is never
 * fetched for a row that gets dropped on arrival.
 */
export async function* iterateAggregationSourceDocs(
  where: Prisma.SetupDocumentWhereInput
): AsyncGenerator<AggregationSourceDoc> {
  let cursor: string | null = null;

  for (;;) {
    const page: AggregationSourceDoc[] = await prisma.setupDocument.findMany({
      where,
      orderBy: { id: "asc" },
      take: AGGREGATION_DOC_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        parsedDataJson: true,
        carId: true,
        createdSetup: { select: { carId: true, data: true } },
      },
    });

    if (page.length === 0) return;
    for (const doc of page) yield doc;
    if (page.length < AGGREGATION_DOC_PAGE_SIZE) return;

    cursor = page[page.length - 1].id;
  }
}
