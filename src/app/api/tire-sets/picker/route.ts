import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { buildTireSetSessionChain } from "@/lib/tires/tireSetSessionChain";

/**
 * Add-run tire picker data: every user-owned set with its derived, zero-typing identity —
 * run count, the session chain it has been run in, last-used instant, and the latest car
 * rating on it. Wear IS the name; nothing here is ever typed by the driver.
 *
 * Semantics match /api/runs/last-tire-run-number: only completed runs claim a run-count
 * slot (max tireRunNumber, else the set's declared initialRunCount); drafts count for
 * recency only so today's in-progress set still sorts first.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [tireSets, runs] = await Promise.all([
    prisma.tireSet.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        setNumber: true,
        initialRunCount: true,
        insertLabel: true,
        wheelLabel: true,
        specificModel: true,
        tireTypeId: true,
        tireType: { select: { id: true, displayName: true, modelCode: true } },
      },
    }),
    prisma.run.findMany({
      where: { userId: user.id, tireSetId: { not: null } },
      select: {
        tireSetId: true,
        tireRunNumber: true,
        loggingComplete: true,
        meetingSessionCode: true,
        meetingSessionType: true,
        sessionLabel: true,
        sessionCompletedAt: true,
        createdAt: true,
        carRating: true,
      },
    }),
  ]);

  const runsBySet = new Map<string, typeof runs>();
  for (const run of runs) {
    if (!run.tireSetId) continue;
    const list = runsBySet.get(run.tireSetId);
    if (list) list.push(run);
    else runsBySet.set(run.tireSetId, [run]);
  }

  const rows = tireSets.map((ts) => {
    const setRuns = runsBySet.get(ts.id) ?? [];
    const completed = setRuns.filter((r) => r.loggingComplete);

    let maxTireRunNumber: number | null = null;
    for (const r of completed) {
      if (maxTireRunNumber == null || r.tireRunNumber > maxTireRunNumber) {
        maxTireRunNumber = r.tireRunNumber;
      }
    }
    const runCount = maxTireRunNumber ?? ts.initialRunCount ?? 0;

    const chainItems = buildTireSetSessionChain(
      completed.map((r) => ({
        meetingSessionCode: r.meetingSessionCode,
        meetingSessionType: r.meetingSessionType,
        sessionLabel: r.sessionLabel,
        when: r.sessionCompletedAt ?? r.createdAt,
      }))
    );

    let lastUsedAt: Date | null = null;
    for (const r of setRuns) {
      const when = r.sessionCompletedAt ?? r.createdAt;
      if (lastUsedAt == null || when.getTime() > lastUsedAt.getTime()) lastUsedAt = when;
    }

    let lastRating: number | null = null;
    let lastRatingAt = 0;
    for (const r of completed) {
      if (r.carRating == null) continue;
      const when = (r.sessionCompletedAt ?? r.createdAt).getTime();
      if (when >= lastRatingAt) {
        lastRatingAt = when;
        lastRating = r.carRating;
      }
    }

    return {
      id: ts.id,
      label: ts.label,
      setNumber: ts.setNumber,
      initialRunCount: ts.initialRunCount,
      insertLabel: ts.insertLabel,
      wheelLabel: ts.wheelLabel,
      specificModel: ts.specificModel,
      tireTypeId: ts.tireTypeId,
      tireType: ts.tireType,
      runCount,
      chainItems,
      lastUsedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
      lastRating,
    };
  });

  return NextResponse.json({ tireSets: rows });
}
