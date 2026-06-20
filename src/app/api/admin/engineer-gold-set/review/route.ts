import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import { reviewEngineerAnswer } from "@/lib/engineerFeedback/reviewEngineerAnswer";
import { serializeGoldSetCandidate } from "@/lib/engineerFeedback/goldSetCandidate";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    ids?: unknown;
    allPending?: unknown;
  };

  const ids = Array.isArray(body.ids)
    ? body.ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : [];
  const allPending = body.allPending === true;

  const rows =
    allPending || ids.length === 0
      ? await prisma.engineerGoldSetCandidate.findMany({
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: allPending ? 100 : 0,
        })
      : await prisma.engineerGoldSetCandidate.findMany({
          where: { id: { in: ids } },
        });

  if (rows.length === 0) {
    return NextResponse.json({ reviewed: 0, candidates: [] });
  }

  const updated = [];
  for (const row of rows) {
    const kbSections = Array.isArray(row.kbSections)
      ? row.kbSections.filter((s): s is string => typeof s === "string")
      : [];
    const review = await reviewEngineerAnswer({
      question: row.question,
      answer: row.answer,
      kbSections,
      runId: row.runId,
      compareRunId: row.compareRunId,
    });
    const saved = await prisma.engineerGoldSetCandidate.update({
      where: { id: row.id },
      data: {
        reviewerJson: review,
        reviewerReviewedAt: new Date(),
      },
    });
    updated.push(serializeGoldSetCandidate(saved));
  }

  return NextResponse.json({ reviewed: updated.length, candidates: updated });
}
