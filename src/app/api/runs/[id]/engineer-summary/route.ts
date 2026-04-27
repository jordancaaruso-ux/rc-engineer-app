import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import {
  getOrComputeEngineerSummaryForRun,
  getOrComputeEngineerSummaryForRunPair,
} from "@/lib/engineerPhase5/loadEngineerSummaryForRun";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const force = sp.get("force") === "1";
  const compareRunId = sp.get("compareRunId")?.trim() ?? "";

  if (compareRunId) {
    const pair = await getOrComputeEngineerSummaryForRunPair(user.id, id, compareRunId);
    if (!pair) {
      return NextResponse.json(
        {
          error:
            "Runs not found or compare not allowed (peer must be a linked teammate or share a pilot team; same track as primary for non-owner compare).",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ summary: pair.summary, cached: false, compareMode: true as const });
  }

  const result = await getOrComputeEngineerSummaryForRun(user.id, id, { force });
  if (!result) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ summary: result.summary, cached: result.cached, compareMode: false as const });
}
