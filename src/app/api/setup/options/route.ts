import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/** Setup-source options for Log your run flow. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;

  const downloaded = await prisma.setupDocument.findMany({
    where: { userId: user.id, createdSetupId: { not: null }, setupImportBatchId: null },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      originalFilename: true,
      createdAt: true,
      createdSetupId: true,
      createdSetup: { select: { data: true, carId: true } },
    },
  });

  const mapped = downloaded
    .filter((d) => d.createdSetup)
    .map((d) => ({
      id: d.id,
      originalFilename: d.originalFilename,
      createdAt: d.createdAt,
      setupData: d.createdSetup!.data,
      carId: d.createdSetup!.carId ?? null,
      /** SetupSnapshot id for baseline merge when logging a run from this download. */
      baselineSetupSnapshotId: d.createdSetupId,
    }));

  const downloadedSetups = carId
    ? mapped.filter((d) => d.carId === carId)
    : mapped;

  return NextResponse.json({ downloadedSetups });
}
