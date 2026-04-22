import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { canonicalSetupTemplateForUserCarId, carIdsSharingSetupTemplate } from "@/lib/carSetupScope";

function jsonObjectNonEmpty(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;
}

/** Setup-source options for Log your run flow. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      carId: true,
      setupSheetTemplate: true,
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

    const carFromSnap = snap?.carId ?? d.carId ?? null;
    return [
      {
        id: d.id,
        originalFilename: d.originalFilename,
        createdAt: d.createdAt,
        setupData,
        carId: carFromSnap,
        documentSetupTemplate: d.setupSheetTemplate ?? null,
        baselineSetupSnapshotId: d.createdSetupId,
      },
    ];
  });

  const currentTemplate = carId ? await canonicalSetupTemplateForUserCarId(user.id, carId) : null;
  /** Unassigned setups apply to any car; typed documents match the car's canonical template. */
  const scopeCarIds = carId ? await carIdsSharingSetupTemplate(user.id, carId) : null;
  const scopeSet = scopeCarIds ? new Set(scopeCarIds) : null;
  const downloadedSetups =
    !carId || !scopeSet
      ? mapped
      : mapped.filter((d) => {
          if (d.documentSetupTemplate) {
            if (currentTemplate) {
              return d.documentSetupTemplate === currentTemplate;
            }
            return false;
          }
          return d.carId == null || (d.carId != null && scopeSet.has(d.carId));
        });

  return NextResponse.json({ downloadedSetups });
}
