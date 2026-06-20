import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import {
  hashQuestion,
  nextPromotedCaseId,
  serializeGoldSetCandidate,
} from "@/lib/engineerFeedback/goldSetCandidate";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    question?: unknown;
    caseId?: unknown;
  } | null;

  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const existing = await prisma.engineerGoldSetCandidate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "dismiss") {
    const updated = await prisma.engineerGoldSetCandidate.update({
      where: { id },
      data: { status: "dismissed" },
    });
    return NextResponse.json({ candidate: serializeGoldSetCandidate(updated) });
  }

  if (action === "promote") {
    const caseId =
      typeof body?.caseId === "string" && body.caseId.trim()
        ? body.caseId.trim().slice(0, 64)
        : await nextPromotedCaseId(existing.question);
    const updated = await prisma.engineerGoldSetCandidate.update({
      where: { id },
      data: {
        status: "promoted",
        promotedAt: new Date(),
        promotedCaseId: caseId,
      },
    });
    return NextResponse.json({ candidate: serializeGoldSetCandidate(updated) });
  }

  if (action === "edit") {
    const question =
      typeof body?.question === "string" && body.question.trim()
        ? body.question.trim().slice(0, 4096)
        : null;
    if (!question) {
      return NextResponse.json({ error: "question is required for edit" }, { status: 400 });
    }
    const updated = await prisma.engineerGoldSetCandidate.update({
      where: { id },
      data: { question, questionHash: hashQuestion(question) },
    });
    return NextResponse.json({ candidate: serializeGoldSetCandidate(updated) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
