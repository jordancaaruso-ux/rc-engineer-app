import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

/**
 * Move a run to a new position in the owner's chronological list by updating
 * its `sortAt`. The server computes the new timestamp from the user-visible
 * neighbours (the runs currently rendered immediately above and below the
 * dragged row) so the client never has to guess — it just tells us which
 * neighbour IDs bracketed the drop site.
 *
 * Drop rules (all timestamps are in ms since epoch):
 *   - beforeId (newer neighbour above) & afterId (older neighbour below) given:
 *       newSortAt = midpoint(beforeSortAt, afterSortAt)
 *   - only beforeId given (dropped at the tail / older end):
 *       newSortAt = beforeSortAt - 60s  (1 minute older)
 *   - only afterId given (dropped at the head / newer end):
 *       newSortAt = afterSortAt + 60s   (1 minute newer)
 *   - neither given → 400 (no anchor to compute a position from)
 *
 * Collisions (two runs ending up with the exact same ms) are astronomically
 * unlikely at millisecond precision; if it ever happens, the caller can just
 * drag again.
 */

type Body = {
  /**
   * ID of the run currently shown immediately above the drop site
   * (i.e. the newer neighbour — higher sortAt). Optional if dropping at the tail.
   */
  beforeId?: string | null;
  /**
   * ID of the run currently shown immediately below the drop site
   * (i.e. the older neighbour — lower sortAt). Optional if dropping at the head.
   */
  afterId?: string | null;
};

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getOrCreateLocalUser();
  const { id } = await ctx.params;
  const rid = typeof id === "string" ? id.trim() : "";
  if (!rid) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const beforeId = typeof body.beforeId === "string" && body.beforeId.trim() ? body.beforeId.trim() : null;
  const afterId = typeof body.afterId === "string" && body.afterId.trim() ? body.afterId.trim() : null;
  if (!beforeId && !afterId) {
    return NextResponse.json(
      { error: "At least one of beforeId / afterId is required" },
      { status: 400 }
    );
  }
  if (beforeId === rid || afterId === rid) {
    return NextResponse.json(
      { error: "Cannot anchor a reorder to the dragged run itself" },
      { status: 400 }
    );
  }

  const target = await prisma.run.findFirst({
    where: { id: rid, userId: user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const neighbourIds = [beforeId, afterId].filter((v): v is string => !!v);
  const neighbours = await prisma.run.findMany({
    where: { userId: user.id, id: { in: neighbourIds } },
    select: { id: true, sortAt: true },
  });
  const before = beforeId ? neighbours.find((n) => n.id === beforeId) ?? null : null;
  const after = afterId ? neighbours.find((n) => n.id === afterId) ?? null : null;

  if (beforeId && !before) {
    return NextResponse.json({ error: "beforeId not found" }, { status: 404 });
  }
  if (afterId && !after) {
    return NextResponse.json({ error: "afterId not found" }, { status: 404 });
  }

  // Sanity: list is sorted newest-first, so before.sortAt > after.sortAt.
  // If the client passes them reversed we treat it as an error rather than
  // silently swapping — keeps the contract clear.
  if (before && after && before.sortAt.getTime() <= after.sortAt.getTime()) {
    return NextResponse.json(
      { error: "beforeId must be newer than afterId" },
      { status: 400 }
    );
  }

  let newMs: number;
  if (before && after) {
    newMs = Math.floor((before.sortAt.getTime() + after.sortAt.getTime()) / 2);
    // Ensure strict ordering even if the two neighbours are 1 ms apart.
    if (newMs === before.sortAt.getTime()) newMs -= 1;
    if (newMs === after.sortAt.getTime()) newMs += 1;
  } else if (before) {
    newMs = before.sortAt.getTime() - 60_000;
  } else if (after) {
    newMs = after.sortAt.getTime() + 60_000;
  } else {
    // unreachable — we validated above, but narrow for TS
    return NextResponse.json({ error: "No anchor" }, { status: 400 });
  }

  const updated = await prisma.run.update({
    where: { id: target.id },
    data: { sortAt: new Date(newMs) },
    select: { id: true, sortAt: true },
  });

  return NextResponse.json({
    ok: true,
    run: { id: updated.id, sortAt: updated.sortAt.toISOString() },
  });
}
