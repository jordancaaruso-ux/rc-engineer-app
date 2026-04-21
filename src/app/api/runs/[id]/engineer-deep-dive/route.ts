import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import {
  ENGINEER_DEEP_DIVE_VERSION,
  type EngineerDeepDiveAnswersV1,
} from "@/lib/engineerPhase5/engineerRunSummaryTypes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const run = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: { engineerDeepDiveJson: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ deepDive: run.engineerDeepDiveJson ?? null });
}

export async function POST(req: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dominantIssue = typeof body.dominantIssue === "string" ? body.dominantIssue.trim() : "";
  const severityFeel =
    body.severityFeel === "mild" || body.severityFeel === "moderate" || body.severityFeel === "severe"
      ? body.severityFeel
      : null;
  const feelVsPrior = typeof body.feelVsPrior === "string" ? body.feelVsPrior.trim() : "";
  const freeText = typeof body.freeText === "string" ? body.freeText.trim() : undefined;
  const referenceRunId =
    typeof body.referenceRunId === "string" && body.referenceRunId.trim() ? body.referenceRunId.trim() : null;

  if (!dominantIssue || !severityFeel || !feelVsPrior) {
    return NextResponse.json(
      { error: "dominantIssue, severityFeel, and feelVsPrior are required" },
      { status: 400 }
    );
  }

  const existing = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const payload: EngineerDeepDiveAnswersV1 = {
    version: ENGINEER_DEEP_DIVE_VERSION,
    dominantIssue,
    severityFeel,
    feelVsPrior,
    freeText: freeText || undefined,
    completedAtIso: new Date().toISOString(),
    referenceRunId,
  };

  await prisma.run.update({
    where: { id },
    data: { engineerDeepDiveJson: payload as object },
  });

  return NextResponse.json({ ok: true, deepDive: payload });
}
