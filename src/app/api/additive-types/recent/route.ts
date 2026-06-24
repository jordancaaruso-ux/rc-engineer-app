import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

const ADDITIVE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

/** Distinct additive types from the user's recent runs (most recently used first). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const recentRuns = await prisma.run.findMany({
    where: {
      userId: user.id,
      additiveTypeId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      additiveType: { select: ADDITIVE_TYPE_SELECT },
    },
  });

  const seen = new Set<string>();
  const additiveTypes: Array<{ id: string; displayName: string; modelCode: string }> = [];
  for (const run of recentRuns) {
    const at = run.additiveType;
    if (!at || seen.has(at.id)) continue;
    seen.add(at.id);
    additiveTypes.push(at);
    if (additiveTypes.length >= 8) break;
  }

  return NextResponse.json({ additiveTypes });
}
