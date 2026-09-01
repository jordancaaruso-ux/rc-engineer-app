import "server-only";

import { prisma } from "@/lib/prisma";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";
import {
  DEMO_DATE_TABLES,
  DEMO_RECENCY_LAG_DAYS,
  computeDemoShiftMs,
  placeDemoThread,
  shouldApplyDemoShift,
} from "@/lib/demo/demoDateShift";

/**
 * Slide the demo season forward so it never ages out of the app's rolling windows
 * (`demoDateShift.ts` explains why this exists at all).
 *
 * Raw SQL rather than Prisma writes, and deliberately so: this is one arithmetic UPDATE per
 * table over rows the demo account owns — no reads, no round trip per row, nothing to hold in
 * memory. 178 runs and their laps move in well under a second, which is what makes it safe to
 * run on a schedule against production.
 *
 * SAFETY. Every table and column name comes from the frozen `DEMO_DATE_TABLES` manifest, never
 * from an argument, so the identifier interpolation below cannot be reached by anything a
 * caller controls. The only bound values are the delta and the demo user id. The WHERE clause
 * is scoped to the demo account on every table — there is no code path here that can touch a
 * real driver's rows, which is the property that matters most when this runs unattended.
 */

export type DemoDateShiftResult = {
  /** Whether rows were actually moved (a small drift is skipped — see `shouldApplyDemoShift`). */
  applied: boolean;
  deltaMs: number;
  /** Days the season moved, signed and rounded — the number worth logging. */
  deltaDays: number;
  newestRunBefore: string | null;
  newestRunAfter: string | null;
  rowsByTable: Record<string, number>;
};

/** The demo's newest run by `sortAt` — the anchor the whole season is positioned against. */
async function findDemoNewestRunAt(userId: string): Promise<Date | null> {
  const newest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: { sortAt: true },
  });
  return newest?.sortAt ?? null;
}

/**
 * Apply a known delta. Split out from `refreshDemoSeasonDates` so the seed can reuse the exact
 * same SQL for its one-off anchoring pass instead of growing a second implementation that
 * drifts from this one.
 */
export async function applyDemoDateShift(input: {
  deltaMs: number;
  userId?: string;
}): Promise<Record<string, number>> {
  const userId = input.userId ?? demoCatalogUserId();
  const seconds = input.deltaMs / 1000;
  const rowsByTable: Record<string, number> = {};

  for (const spec of DEMO_DATE_TABLES) {
    // `make_interval(secs => …)` takes a double, so sub-second precision survives and there is
    // no string-concatenated interval literal to get wrong. NULL + interval is NULL, which is
    // exactly right for every optional column — no per-column guard needed.
    const sets = spec.columns
      .map((c) => `"${c}" = "${c}" + make_interval(secs => $1)`)
      .join(", ");
    const where =
      spec.scope === "user"
        ? `"userId" = $2`
        : spec.scope === "run"
          ? `"runId" IN (SELECT "id" FROM "Run" WHERE "userId" = $2)`
          : `"threadId" IN (SELECT "id" FROM "EngineerChatThread" WHERE "userId" = $2)`;

    rowsByTable[spec.table] = await prisma.$executeRawUnsafe(
      `UPDATE "${spec.table}" SET ${sets} WHERE ${where}`,
      seconds,
      userId,
    );
  }

  return rowsByTable;
}

/**
 * Put the Engineer conversations back on the calendar after a re-seed.
 *
 * The season anchor is the newest RUN; conversations are not bound to that timeline and in the
 * real source account run a month past it (the founder stopped racing and kept asking questions).
 * `placeDemoThread` explains the two rules; this is the pass that applies them.
 *
 * SEED ONLY. After this the thread set is correct relative to the runs, and the nightly refresh
 * moves everything together by one delta, which preserves it. Running this again would be
 * harmless but pointless.
 */
export async function settleDemoThreadDates(input?: {
  now?: Date;
  /** How far behind now the newest conversation sits. Hours, not days — a question asked this
   *  morning is a good look on a demo; a run logged this morning invites "is this live data?". */
  lagHours?: number;
}): Promise<{ threads: number; movedForRunOrder: number; newestAfter: string | null }> {
  const userId = demoCatalogUserId();
  const now = input?.now ?? new Date();
  const lagHours = input?.lagHours ?? 6;

  const threads = await prisma.engineerChatThread.findMany({
    where: { userId },
    select: { id: true, createdAt: true, updatedAt: true, primaryRunId: true },
  });
  if (threads.length === 0) return { threads: 0, movedForRunOrder: 0, newestAfter: null };

  // Rule 1's anchor: the newest timestamp anywhere in the thread set, `updatedAt` included —
  // a thread whose last reply is newer than its creation is the one that would poke into the
  // future first.
  const newestAt = new Date(
    Math.max(...threads.map((t) => Math.max(t.createdAt.getTime(), t.updatedAt.getTime()))),
  );
  const threadSetDeltaMs = now.getTime() - lagHours * 60 * 60 * 1000 - newestAt.getTime();

  const anchorRunIds = threads.map((t) => t.primaryRunId).filter((id): id is string => Boolean(id));
  const anchorRuns = anchorRunIds.length
    ? await prisma.run.findMany({
        where: { id: { in: anchorRunIds }, userId },
        select: { id: true, sortAt: true },
      })
    : [];
  const runAtById = new Map(anchorRuns.map((r) => [r.id, r.sortAt]));

  let movedForRunOrder = 0;
  for (const thread of threads) {
    const anchorRunAt = thread.primaryRunId ? runAtById.get(thread.primaryRunId) ?? null : null;
    const deltaMs = placeDemoThread({
      threadAt: thread.createdAt,
      threadSetDeltaMs,
      anchorRunAt,
    });
    if (deltaMs !== threadSetDeltaMs) movedForRunOrder += 1;
    if (deltaMs === 0) continue;
    const seconds = deltaMs / 1000;
    await prisma.$executeRawUnsafe(
      `UPDATE "EngineerChatThread"
         SET "createdAt" = "createdAt" + make_interval(secs => $1),
             "updatedAt" = "updatedAt" + make_interval(secs => $1)
       WHERE "id" = $2 AND "userId" = $3`,
      seconds,
      thread.id,
      userId,
    );
    // Messages move with their thread, so the conversation's own pacing survives.
    await prisma.$executeRawUnsafe(
      `UPDATE "EngineerChatMessage"
         SET "createdAt" = "createdAt" + make_interval(secs => $1)
       WHERE "threadId" = $2`,
      seconds,
      thread.id,
    );
  }

  const newest = await prisma.engineerChatThread.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return {
    threads: threads.length,
    movedForRunOrder,
    newestAfter: newest?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Read the season's current position, work out how far it has drifted, and move it if the
 * drift is worth a write. Idempotent and self-correcting: if the schedule misses a fortnight,
 * the next call catches the whole fortnight up in one shift.
 */
export async function refreshDemoSeasonDates(input?: {
  now?: Date;
  lagDays?: number;
  /** Move it regardless of how small the drift is — the seed's anchoring pass wants this. */
  force?: boolean;
}): Promise<DemoDateShiftResult> {
  const userId = demoCatalogUserId();
  const now = input?.now ?? new Date();
  const newestRunBefore = await findDemoNewestRunAt(userId);

  const deltaMs = computeDemoShiftMs({
    newestRunAt: newestRunBefore,
    now,
    lagDays: input?.lagDays ?? DEMO_RECENCY_LAG_DAYS,
  });
  const deltaDays = Math.round((deltaMs / (24 * 60 * 60 * 1000)) * 10) / 10;

  // No runs at all (a box with no demo seeded) leaves deltaMs at 0 and falls through here.
  if (!input?.force && !shouldApplyDemoShift(deltaMs)) {
    return {
      applied: false,
      deltaMs,
      deltaDays,
      newestRunBefore: newestRunBefore?.toISOString() ?? null,
      newestRunAfter: newestRunBefore?.toISOString() ?? null,
      rowsByTable: {},
    };
  }

  const rowsByTable = await applyDemoDateShift({ deltaMs, userId });

  return {
    applied: true,
    deltaMs,
    deltaDays,
    newestRunBefore: newestRunBefore?.toISOString() ?? null,
    newestRunAfter: await findDemoNewestRunAt(userId).then((d) => d?.toISOString() ?? null),
    rowsByTable,
  };
}
