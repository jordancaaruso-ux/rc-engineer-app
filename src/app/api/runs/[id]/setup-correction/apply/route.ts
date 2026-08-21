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
 * Carrying a correction the driver just made onto the later runs that inherited it.
 *
 * The run ids come from the client, but nothing about them is trusted: each is
 * re-loaded scoped to this user, this car, and `sortAt` strictly after the run the
 * correction started from. An id that fails any of those is dropped silently
 * rather than 400ing the whole request — the list was built from a page that may
 * be a minute stale, and one deleted run should not cost the driver the other six.
 *
 * All of it lands in ONE transaction. A half-applied cascade is a run history that
 * disagrees with itself, which is the exact state this feature exists to fix.
 *
 * The write is field-level on purpose: later runs have their own setups, and the
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
    select: { id: true, carId: true, sortAt: true },
  });
  if (!anchor?.carId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const targets = await prisma.run.findMany({
    where: {
      id: { in: runIds },
      userId,
      carId: anchor.carId,
      sortAt: { gt: anchor.sortAt },
    },
    select: runSelectForSetupCorrection,
    orderBy: { sortAt: "asc" },
  });

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const updatedRunIds: string[] = [];
  for (const run of targets) {
    const built = await buildSetupCorrectionWrites({ userId, run, key, value });
    // Null means the run already held that value — a tick that writes nothing.
    if (!built) continue;
    writes.push(...built.writes);
    updatedRunIds.push(run.id);
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
    await clearEngineerReadsReferencing(userId, updatedRunIds);
    revalidateAfterRunMutation(userId);
  }

  return NextResponse.json({ ok: true, updatedRunIds });
}
