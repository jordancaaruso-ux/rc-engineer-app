import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";
import { isDerivedSheetSlug } from "@/lib/setupSheetModels/derivedSheetFingerprint";
import {
  uploadedSheetFailed,
  uploadedSheetStatusWords,
  uploadedSheetTitle,
} from "@/lib/setupDocuments/uploadedSheetStatus";
import { SetupDocumentLibraryClient } from "@/components/setup-documents/SetupDocumentLibraryClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE } from "@/lib/setupDocuments/driverVisibleDocuments";

function formatUtcStamp(iso: string): string {
  // Deterministic SSR+client string (no locale/timezone differences).
  // Example: 2026-03-26 17:20:36Z
  return iso.replace("T", " ").slice(0, 19) + "Z";
}

/**
 * The chassis an upload belongs to, by name. A chassis a racer's own PDF made has a hash for its
 * template key ("sheet_7e5a6425d1a07143"), which the list printed as "Sheet 7E5A6425D1A07143".
 */
function chassisNameFor(doc: {
  setupSheetTemplate: string | null;
  setupSheetModel: { name: string } | null;
  car: { setupSheetModel: { name: string } | null } | null;
  blankSheet: { setupSheetModel: { name: string } | null } | null;
}): string | null {
  const modelName =
    doc.blankSheet?.setupSheetModel?.name ?? doc.setupSheetModel?.name ?? doc.car?.setupSheetModel?.name ?? null;
  if (modelName) return modelName;
  const template = doc.setupSheetTemplate;
  return template && !isDerivedSheetSlug(template) ? labelForSetupSheetTemplate(template) : null;
}

export default async function SetupDocumentsPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Setup documents</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  // Admins keep the pipeline's own words and UTC stamps; racers read plain words in their own time.
  const isAdmin = isAuthAdminEmail(user.email);
  const [documents, cars, displayTimeZone] = await Promise.all([
    prisma.setupDocument.findMany({
    where: { userId: user.id, ...DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sourceType: true,
      parseStatus: true,
      importStatus: true,
      currentStage: true,
      lastCompletedStage: true,
      importErrorMessage: true,
      parserType: true,
      createdAt: true,
      updatedAt: true,
      createdSetupId: true,
      carId: true,
      setupSheetTemplate: true,
      setupSheetModel: { select: { name: true } },
      car: { select: { setupSheetModel: { select: { name: true } } } },
      blankSheet: { select: { setupSheetModelId: true, setupSheetModel: { select: { name: true } } } },
    },
  }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, setupSheetTemplate: true },
    }),
    getExplicitTimeZoneForRunFormatting(),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup documents</h1>
          <p className="page-subtitle">Upload, review, and convert setup sheets into app setups.</p>
        </div>
      </header>
      <SetupDocumentLibraryClient
        cars={cars}
        isAdmin={isAdmin}
        initialDocuments={documents.map(({ setupSheetModel, car, blankSheet, ...d }) => ({
          ...d,
          originalFilename: isAdmin ? d.originalFilename : uploadedSheetTitle(d.originalFilename),
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          createdAtLabel: isAdmin
            ? formatUtcStamp(d.createdAt.toISOString())
            : formatRunCreatedAtDateTime(d.createdAt, displayTimeZone),
          statusWords: uploadedSheetStatusWords({ ...d, blankSheet }),
          statusFailed: uploadedSheetFailed({ ...d, blankSheet }),
          chassisName: chassisNameFor({ setupSheetTemplate: d.setupSheetTemplate, setupSheetModel, car, blankSheet }),
        }))}
      />
    </>
  );
}
