import { Prisma } from "@prisma/client";

/**
 * The Starter tier's one choke point (docs/STARTER_TIER_PLAN.md).
 *
 * A Starter member sees their fifteen most recent runs; everything older carries a
 * `Run.hiddenByPlanAt` stamp (set by `applyRunWindow`, never by hand). Runs are read in well over
 * a hundred places across sixty-odd files, and a `where` added to each of them is a week of edits
 * with a leak guaranteed somewhere. So the filter lives on the client instead: every read
 * operation on the `run` model has `hiddenByPlanAt: null` ANDed into its `where`, and the
 * exported `prisma` cannot see a hidden run at all.
 *
 * Always AND, never merge: a caller's own `hiddenByPlanAt` condition is kept and the null test is
 * added beside it, so nothing that goes through `prisma.run` can widen the view. The three
 * internals that must see everything use `runsIncludingHidden` (src/lib/prisma.ts).
 *
 * What this cannot see: a run read THROUGH a relation (`setupSnapshot.runs`, `track.runs`,
 * `_count.runs`). Those resolve inside the parent's query and carry an explicit
 * `where: { hiddenByPlanAt: null }` by hand — the list is in the plan. Writes are untouched: a
 * hidden run cannot be edited or deleted through the API anyway, because every route does a
 * scoped read of it first, which now misses.
 */

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

type WhereLike = { AND?: unknown } & Record<string, unknown>;

/**
 * `where` with the visibility test ANDed on. Pure, so the shape is unit-testable without a
 * database. `findUnique` needs its unique key at the top level, which is why this keeps the
 * caller's keys where they are and only appends to `AND` rather than wrapping the whole clause.
 */
export function scopeWhereToVisibleRuns(where: WhereLike | undefined): WhereLike {
  const existing =
    where?.AND == null ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...(where ?? {}), AND: [...existing, { hiddenByPlanAt: null }] };
}

export const runWindowExtension = Prisma.defineExtension({
  name: "runWindow",
  query: {
    run: {
      $allOperations({ operation, args, query }) {
        if (!READ_OPERATIONS.has(operation)) return query(args);
        const scoped = {
          ...(args as object),
          where: scopeWhereToVisibleRuns((args as { where?: WhereLike }).where),
        };
        return query(scoped as typeof args);
      },
    },
  },
});
