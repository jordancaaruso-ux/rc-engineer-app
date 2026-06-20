import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import { nextPromotedCaseId, reviewerFromJson, serializeGoldSetCandidate } from "@/lib/engineerFeedback/goldSetCandidate";
import { reviewerPassesShipBar } from "@/lib/engineerFeedback/reviewerParse";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    minScore?: unknown;
    sinceDays?: unknown;
  };

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (action !== "promote-reviewed") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const minScoreRaw = body.minScore;
  const minScore =
    typeof minScoreRaw === "number"
      ? minScoreRaw
      : typeof minScoreRaw === "string"
        ? Number(minScoreRaw)
        : 4;
  const sinceDaysRaw = body.sinceDays;
  const sinceDays =
    typeof sinceDaysRaw === "number"
      ? sinceDaysRaw
      : typeof sinceDaysRaw === "string"
        ? Number(sinceDaysRaw)
        : 7;
  const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000);

  const pending = await prisma.engineerGoldSetCandidate.findMany({
    where: {
      status: "pending",
      createdAt: { gte: since },
      reviewerReviewedAt: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  const promoted = [];
  for (const row of pending) {
    const review = reviewerFromJson(row.reviewerJson);
    if (!review) continue;
    if (review.score < minScore) continue;
    if (!reviewerPassesShipBar(review)) continue;

    const caseId = await nextPromotedCaseId(row.question);
    const saved = await prisma.engineerGoldSetCandidate.update({
      where: { id: row.id },
      data: {
        status: "promoted",
        promotedAt: new Date(),
        promotedCaseId: caseId,
      },
    });
    promoted.push(serializeGoldSetCandidate(saved));
  }

  return NextResponse.json({ promoted: promoted.length, candidates: promoted });
}
