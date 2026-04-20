import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { computePersistedRunLapSummary } from "@/lib/lapAnalysis";

export const dynamic = "force-dynamic";

/**
 * One-shot backfill for the new `bestLapSeconds` / `avgTop5LapSeconds`
 * columns on `Run`. Scans rows where either column is null and materializes
 * the summary from the stored `lapTimes` / `lapSession` JSON.
 *
 * This is intentionally a manual endpoint (NOT called on page render) so it
 * can't be accidentally re-introduced into the hot path — the previous
 * on-render backfill for name snapshots was the single biggest cause of the
 * Sessions page feeling slow.
 *
 * Usage: POST `/api/runs/backfill-lap-summary` once per environment after
 * running the migration. Accepts an optional `{ "limit": 2000 }` body to
 * cap the batch.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const user = await getOrCreateLocalUser();

  let limit = 2000;
  try {
    const body = (await request.json().catch(() => null)) as
      | { limit?: unknown }
      | null;
    if (
      body &&
      typeof body.limit === "number" &&
      Number.isFinite(body.limit) &&
      body.limit > 0
    ) {
      limit = Math.min(Math.floor(body.limit), 10_000);
    }
  } catch {
    /* ignore */
  }

  const rows = await prisma.run.findMany({
    where: {
      userId: user.id,
      OR: [{ bestLapSeconds: null }, { avgTop5LapSeconds: null }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      lapTimes: true,
      lapSession: true,
      bestLapSeconds: true,
      avgTop5LapSeconds: true,
    },
  });

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const next = computePersistedRunLapSummary(row);
    if (
      next.bestLapSeconds === row.bestLapSeconds &&
      next.avgTop5LapSeconds === row.avgTop5LapSeconds
    ) {
      skipped += 1;
      continue;
    }
    await prisma.run.update({
      where: { id: row.id },
      data: {
        bestLapSeconds: next.bestLapSeconds,
        avgTop5LapSeconds: next.avgTop5LapSeconds,
      },
    });
    updated += 1;
  }

  return NextResponse.json({
    scanned: rows.length,
    updated,
    skipped,
    limit,
  });
}
