import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const tireSetId = searchParams.get("tireSetId");
  const excludeRunId = searchParams.get("excludeRunId");

  if (!tireSetId) {
    return NextResponse.json(
      { error: "tireSetId is required" },
      { status: 400 }
    );
  }

  // Only completed runs claim a tire-run slot. Drafts are previews of
  // intent — if the driver abandons a draft or loops a draft→complete
  // cycle, we don't want the draft's provisional tireRunNumber feeding
  // back into this counter and inflating the next run's number by +1.
  // `excludeRunId` lets an edit-in-progress exclude itself so re-saving
  // a completed run doesn't bump its own slot either.
  const last = await prisma.run.findFirst({
    where: {
      userId: user.id,
      tireSetId,
      loggingComplete: true,
      ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { tireRunNumber: true },
  });

  if (last?.tireRunNumber != null) {
    return NextResponse.json({ lastTireRunNumber: last.tireRunNumber });
  }

  const tireSet = await prisma.tireSet.findFirst({
    where: { id: tireSetId, userId: user.id },
    select: { initialRunCount: true },
  });

  return NextResponse.json({ lastTireRunNumber: tireSet?.initialRunCount ?? 0 });
}

