import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Full imported lap sets + laps for a single run. Used by Sessions history
 * after the list query omits nested laps to keep SSR fast.
 */
export async function GET(_req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      importedLapSets: {
        orderBy: { createdAt: "asc" },
        include: {
          laps: { orderBy: { lapNumber: "asc" } },
        },
      },
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ sets: run.importedLapSets });
}
