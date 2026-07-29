import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns } from "@/lib/teammateRunAccess";
import { setupSheetScopeFromCar } from "@/lib/setupCompare/setupSheetScope";

/**
 * The viewer's own standalone setup-sheet documents (library uploads + PetitRC
 * downloads, `setupImportBatchId: null`) that share the anchor run car's setup
 * sheet scope and carry usable parsed values — pickable as a compare baseline
 * alongside "my runs" / "teammate runs". Documents are private per user
 * (see docs/cross-account-setup-sharing.md), so this only ever returns the
 * caller's own library, regardless of who owns the anchor run.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const anchor = await prisma.run.findFirst({
    where: { id: runId },
    select: {
      userId: true,
      car: { select: { setupSheetModelId: true, setupSheetTemplate: true } },
    },
  });
  if (!anchor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (anchor.userId !== userId) {
    const canView = await canViewPeerRuns(userId, anchor.userId);
    if (!canView) {
      return NextResponse.json({ error: "Not allowed to view this run" }, { status: 403 });
    }
  }

  const scope = setupSheetScopeFromCar(anchor.car);
  if (!scope) return NextResponse.json({ documents: [] });

  const scopeWhere = scope.setupSheetModelId
    ? { setupSheetModelId: scope.setupSheetModelId }
    : { setupSheetTemplate: { equals: scope.setupSheetTemplate!, mode: "insensitive" as const } };

  const docs = await prisma.setupDocument.findMany({
    where: {
      userId: userId,
      setupImportBatchId: null,
      parseStatus: { in: ["PARSED", "PARTIAL"] },
      ...scopeWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      originalFilename: true,
      sourceType: true,
      sourceSite: true,
      sourceUrl: true,
      createdAt: true,
      setupSheetTemplate: true,
      parsedDataJson: true,
    },
  });

  // Only surface documents that actually carry setup values to diff against.
  const documents = docs.filter((d) => {
    const data = d.parsedDataJson;
    return (
      data != null &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data as Record<string, unknown>).length > 0
    );
  });

  return NextResponse.json({ documents });
}
