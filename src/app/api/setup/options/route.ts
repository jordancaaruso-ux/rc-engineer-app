import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { canonicalSetupTemplateForUserCarId, carIdsSharingSetupTemplate } from "@/lib/carSetupScope";
import { carIdSupportsSheetUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import {
  setupDocumentBelongsToCar,
  type PickerCarScope,
} from "@/lib/setup/savedSetupPickerScope";

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

  // Chassis identity of the selected car — resolved first so the document query can be
  // narrowed in SQL (otherwise `take: 80` can drop this car's sheets behind other chassis).
  const [carRow, currentTemplate, scopeCarIds] = carId
    ? await Promise.all([
        prisma.car.findFirst({
          where: { id: carId, userId },
          select: { setupSheetModelId: true },
        }),
        canonicalSetupTemplateForUserCarId(userId, carId),
        carIdsSharingSetupTemplate(userId, carId),
      ])
    : [null, null, null];

  const carScope: PickerCarScope | null = carId
    ? {
        setupSheetModelId: carRow?.setupSheetModelId ?? null,
        setupSheetTemplate: currentTemplate,
        siblingCarIds: new Set(scopeCarIds ?? [carId]),
      }
    : null;

  const carIsTyped =
    carScope != null &&
    (carScope.setupSheetModelId != null || carScope.setupSheetTemplate != null);

  /** Superset of what `setupDocumentBelongsToCar` accepts; exact precedence is applied below. */
  const documentScopeWhere =
    carScope && carIsTyped
      ? {
          OR: [
            ...(carScope.setupSheetModelId
              ? [{ setupSheetModelId: carScope.setupSheetModelId }]
              : []),
            ...(carScope.setupSheetTemplate
              ? [
                  {
                    setupSheetTemplate: {
                      equals: carScope.setupSheetTemplate,
                      mode: "insensitive" as const,
                    },
                  },
                ]
              : []),
            { carId: { in: [...carScope.siblingCarIds] } },
          ],
        }
      : {};

  const downloaded = await prisma.setupDocument.findMany({
    where: {
      userId: userId,
      parseStatus: { in: ["PARSED", "PARTIAL"] },
      ...documentScopeWhere,
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
      setupSheetModelId: true,
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
        documentSetupSheetModelId: d.setupSheetModelId ?? null,
        baselineSetupSnapshotId: d.createdSetupId,
      },
    ];
  });

  // A document only shows on cars of its own chassis type; see savedSetupPickerScope.
  const downloadedSetups = mapped.filter((d) =>
    setupDocumentBelongsToCar(
      {
        carId: d.carId,
        setupSheetModelId: d.documentSetupSheetModelId,
        setupSheetTemplate: d.documentSetupTemplate,
      },
      carScope
    )
  );

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
