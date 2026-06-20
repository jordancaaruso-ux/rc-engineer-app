import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

const TIRE_SET_SELECT = {
  id: true,
  label: true,
  setNumber: true,
  initialRunCount: true,
  insertLabel: true,
  wheelLabel: true,
  specificModel: true,
  tireTypeId: true,
  tireType: { select: { id: true, displayName: true, modelCode: true } },
} as const;

/** Tire sets from the user's recent runs (most recently used first). */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const recentRuns = await prisma.run.findMany({
    where: {
      userId: user.id,
      tireSetId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      tireSet: { select: TIRE_SET_SELECT },
    },
  });

  const seen = new Set<string>();
  const tireSets: Array<{
    id: string;
    label: string;
    setNumber: number;
    initialRunCount: number;
    insertLabel: string | null;
    wheelLabel: string | null;
    specificModel: string | null;
    tireTypeId: string | null;
    tireType: { id: string; displayName: string; modelCode: string } | null;
  }> = [];
  for (const run of recentRuns) {
    const ts = run.tireSet;
    if (!ts || seen.has(ts.id)) continue;
    seen.add(ts.id);
    tireSets.push(ts);
    if (tireSets.length >= 8) break;
  }

  return NextResponse.json({ tireSets });
}
