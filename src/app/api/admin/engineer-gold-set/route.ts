import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireAdminApiUser } from "@/lib/engineerFeedback/requireAdminApiUser";
import { serializeGoldSetCandidate } from "@/lib/engineerFeedback/goldSetCandidate";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const auth = await requireAdminApiUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status")?.trim() || "pending";
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;
  const cursor = searchParams.get("cursor")?.trim() || null;

  const rows = await prisma.engineerGoldSetCandidate.findMany({
    where: status === "all" ? undefined : { status },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return NextResponse.json({
    candidates: items.map(serializeGoldSetCandidate),
    nextCursor,
  });
}
