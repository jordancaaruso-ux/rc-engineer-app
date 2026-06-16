import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

/** Distinct tire types from the user's recent runs (most recently used first). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const recentRuns = await prisma.run.findMany({
    where: {
      userId: user.id,
      tireSet: { tireTypeId: { not: null } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      tireSet: {
        select: {
          tireType: { select: TIRE_TYPE_SELECT },
        },
      },
    },
  });

  const seen = new Set<string>();
  const tireTypes: Array<{ id: string; displayName: string; modelCode: string }> = [];
  for (const run of recentRuns) {
    const tt = run.tireSet?.tireType;
    if (!tt || seen.has(tt.id)) continue;
    seen.add(tt.id);
    tireTypes.push(tt);
    if (tireTypes.length >= 8) break;
  }

  return NextResponse.json({ tireTypes });
}
