import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";

function jsonObjectNonEmpty(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;
}

/** Setup-source options for Log your run flow. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;

  const downloaded = await prisma.setupDocument.findMany({
    where: {
      userId: user.id,
      parseStatus: { in: ["PARSED", "PARTIAL"] },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      originalFilename: true,
      createdAt: true,
      createdSetupId: true,
      parsedDataJson: true,
      createdSetup: { select: { data: true, carId: true } },
    },
  });

  const mapped = downloaded.flatMap((d) => {
    const snap = d.createdSetup;
    const snapData = snap?.data;
    const hasSnapData = jsonObjectNonEmpty(snapData);
    const hasParsed = jsonObjectNonEmpty(d.parsedDataJson);
    if (!hasSnapData && !hasParsed) return [];

    const setupData = hasSnapData
      ? snapData
      : normalizeSetupSnapshotForStorage(normalizeParsedSetupData(d.parsedDataJson));

    const carFromSnap = snap?.carId ?? null;
    return [
      {
        id: d.id,
        originalFilename: d.originalFilename,
        createdAt: d.createdAt,
        setupData,
        carId: carFromSnap,
        baselineSetupSnapshotId: d.createdSetupId,
      },
    ];
  });

  /** Snapshots with no car still apply to any selected car; assigned cars only match that car. */
  const downloadedSetups = carId
    ? mapped.filter((d) => d.carId == null || d.carId === carId)
    : mapped;

  return NextResponse.json({ downloadedSetups });
}
