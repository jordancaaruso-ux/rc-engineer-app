import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Full imported lap sets + laps for a single run. Used by Sessions history and
 * the lap column-compare modal after the list query omits nested laps to keep
 * SSR fast.
 *
 * Access matches `viewerMayAccessRun`, the same gate the run page and the
 * setup-snapshot route already use, rather than `userId: viewer`. Scoping this
 * one to the owner was left behind when team sharing landed, and the result was
 * that a teammate's session opened fine, showed its setup fine, and then failed
 * "Run not found" the moment you tapped Laptimes — the one tab that needs this
 * endpoint. A run the viewer may not see 404s exactly like one that doesn't
 * exist, so this never confirms a private run by its error.
 */
export async function GET(_req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.run.findFirst({
    where: { id },
    select: {
      id: true,
      userId: true,
      shareWithTeam: true,
      importedLapSets: {
        orderBy: { createdAt: "asc" },
        include: {
          laps: { orderBy: { lapNumber: "asc" } },
        },
      },
    },
  });
  if (!run || !(await viewerMayAccessRun(userId, run))) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ sets: run.importedLapSets });
}
