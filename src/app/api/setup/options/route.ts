import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { canonicalSetupTemplateForUserCarId, carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import { carIdSupportsSheetUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";

function jsonObjectNonEmpty(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;
}

/** Setup-source options for Log your run flow. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const carId = searchParams.get("carId")?.trim() || null;

  const downloaded = await prisma.setupDocument.findMany({
    where: {
      userId: userId,
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

  const currentTemplate = carId ? await canonicalSetupTemplateForUserCarId(userId, carId) : null;
  /** Unassigned setups apply to any car; typed documents match the car's canonical template. */
  const scopeCarIds = carId ? await carIdsSharingSetupTemplate(userId, carId) : null;
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

  // The car's setup library comes first: a setup the driver built and named is a better default
  // baseline than a document they once imported. Same option shape so the run form's existing
  // baseline wiring (`applyDownloadedSetupOnly` → `setupBaselineSnapshotId`) handles both — a
  // library row is simply its own baseline.
  const librarySetups = carId
    ? await prisma.setupSnapshot.findMany({
        where: { userId: userId, carId, isLibrary: true },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, name: true, createdAt: true, data: true },
      })
    : [];

  const libraryOptions = librarySetups
    .filter((s) => jsonObjectNonEmpty(s.data))
    .map((s) => ({
      id: s.id,
      originalFilename: s.name ?? "Untitled setup",
      createdAt: s.createdAt,
      setupData: s.data,
      carId,
      documentSetupTemplate: null,
      baselineSetupSnapshotId: s.id,
      kind: "library" as const,
    }));

  return NextResponse.json({
    downloadedSetups: [
      ...libraryOptions,
      ...downloadedSetups.map((d) => ({ ...d, kind: "document" as const })),
    ],
    // Upload only reads values on a calibrated chassis; the run form hides the prompt otherwise.
    supportsSheetUpload: await carIdSupportsSheetUpload(userId, carId),
  });
}
