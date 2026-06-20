import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import {
  formatGoldSetReviewMarkdown,
  goldCasesFromCandidates,
  serializeGoldSetCandidate,
} from "@/lib/engineerFeedback/goldSetCandidate";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format")?.trim() || "markdown";
  const status = searchParams.get("status")?.trim() || "pending";

  const rows = await prisma.engineerGoldSetCandidate.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  if (format === "json") {
    const cases = goldCasesFromCandidates(rows);
    return NextResponse.json({
      version: 1,
      generatedAtIso: new Date().toISOString(),
      cases,
      candidates: rows.map(serializeGoldSetCandidate),
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const markdown = formatGoldSetReviewMarkdown(rows);
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="engineer-eval-review-${stamp}.md"`,
    },
  });
}
