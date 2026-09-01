import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import type { Prisma } from "@prisma/client";
import { setupKeyIsInlineEditable } from "@/lib/setup/inlineEditableKeys";
import {
  buildSetupCorrectionWrites,
  clearEngineerReadsReferencing,
  runSelectForSetupCorrection,
} from "@/lib/runs/applySetupCorrection";

/**
 * Carrying a correction the driver just made onto the other runs that inherited it.
 *
 * The run ids come from the client, but nothing about them is trusted: each is
 * re-loaded scoped to this user, to this run's car, and never to the anchor itself.
 * An id that fails any of those is dropped rather than 400ing the whole request —
 * the list was built from a page that may be a minute stale, and one deleted run
 * should not cost the driver the other six. What it must NOT do is drop them
 * quietly; see the response note below.
 *
 * ============================== WHY IT IS NO LONGER "LATER RUNS ONLY" ==============================
 *
 * This used to filter `sortAt: { gt: anchor.sortAt }`, from when the cascade only
 * walked forwards. The walk learned to go backwards on 2026-08-21 and this did not,
 * so every EARLIER run a driver ticked was silently discarded — and earlier runs are
 * never ticked by the rule, so the only ticks on that side are deliberate ones. The
 * backward half of the feature therefore did nothing at all from the day it shipped,
 * while reporting "those runs already said that" (founder-reported, 2026-08-24).
 *
 * The car scope is the guard that matters and it is untouched: a correction may never
 * reach a run on another car, and the anchor is excluded because it already holds the
 * value. Direction was never protecting anything — `planSetupCascadeCandidates` decides
 * how far the offer reaches, on both sides, and the driver confirms it.
 *
 * All of it lands in ONE transaction. A half-applied cascade is a run history that
 * disagrees with itself, which is the exact state this feature exists to fix.
 *
 * The write is field-level on purpose: other runs have their own setups, and the
 * only thing that may move on them is the key being corrected.
 */

type Params = { params: Promise<{ id: string }> };

const MAX_RUNS = 200;

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
    value?: unknown;
    runIds?: unknown;
  } | null;

  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const rawValue = body?.value;
  const value =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? String(rawValue)
      : typeof rawValue === "string"
        ? rawValue.trim()
        : null;
  const runIds = Array.isArray(body?.runIds)
    ? [...new Set(body.runIds.filter((r): r is string => typeof r === "string" && r.length > 0))]
    : [];

  if (!key || value == null || value.length > 120) {
    return NextResponse.json({ error: "A setup key and a value are required" }, { status: 400 });
  }
  if (!setupKeyIsInlineEditable(key)) {
    return NextResponse.json(
      { error: "That field is edited on the setup sheet, not here" },
      { status: 400 }
    );
  }
  if (runIds.length === 0) {
    return NextResponse.json({ error: "No runs were chosen" }, { status: 400 });
  }
  if (runIds.length > MAX_RUNS) {
    return NextResponse.json({ error: "Too many runs in one correction" }, { status: 400 });
  }

  const anchor = await prisma.run.findFirst({
    where: { id, userId },
    // No `sortAt`: the targets are no longer filtered by direction, so nothing reads it.
    select: { id: true, carId: true },
  });
  if (!anchor?.carId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const targets = await prisma.run.findMany({
    where: {
      id: { in: runIds },
      userId,
      carId: anchor.carId,
      // Both sides of the correction — see the header. The anchor is excluded because
      // it already holds the value; letting it through would only mint a no-op snapshot.
      NOT: { id: anchor.id },
    },
    select: runSelectForSetupCorrection,
    orderBy: { sortAt: "asc" },
  });

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const updatedRunIds: string[] = [];
  /** Found and owned, but already holding the corrected value — a tick that writes nothing. */
  const unchangedRunIds: string[] = [];
  for (const run of targets) {
    const built = await buildSetupCorrectionWrites({ userId, run, key, value });
    if (!built) {
      unchangedRunIds.push(run.id);
      continue;
    }
    writes.push(...built.writes);
    updatedRunIds.push(run.id);
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
    await clearEngineerReadsReferencing(userId, updatedRunIds);
    revalidateAfterRunMutation(userId);
  }

  /*
   * Ticked, but never reached: deleted since the sheet was drawn, on another car, or the
   * anchor itself. Named rather than folded into "nothing to change", because those two
   * outcomes read identically to a driver and mean opposite things — one says the history
   * already agrees, the other says the app did not do what was asked. Conflating them is
   * how a wholly dead backward cascade went unnoticed for three days.
   */
  const reached = new Set([...updatedRunIds, ...unchangedRunIds]);
  const droppedRunIds = runIds.filter((rid) => !reached.has(rid));

  return NextResponse.json({ ok: true, updatedRunIds, unchangedRunIds, droppedRunIds });
}
