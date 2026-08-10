import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { SetupDocumentLibraryClient } from "@/components/setup-documents/SetupDocumentLibraryClient";
import { CardPanel } from "@/components/ui/CardPanel";
import { DRIVER_VISIBLE_SETUP_DOCUMENT_WHERE } from "@/lib/setupDocuments/driverVisibleDocuments";

function formatUtcStamp(iso: string): string {
  // Deterministic SSR+client string (no locale/timezone differences).
  // Example: 2026-03-26 17:20:36Z
  return iso.replace("T", " ").slice(0, 19) + "Z";
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
  const [documents, cars] = await Promise.all([
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
    },
  }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, setupSheetTemplate: true },
    }),
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
        initialDocuments={documents.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          createdAtLabel: formatUtcStamp(d.createdAt.toISOString()),
        }))}
      />
    </>
  );
}

