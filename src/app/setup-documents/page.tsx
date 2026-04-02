import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { SetupDocumentLibraryClient } from "@/components/setup-documents/SetupDocumentLibraryClient";

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
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const documents = await prisma.setupDocument.findMany({
    where: { userId: user.id, setupImportBatchId: null },
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
    },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Setup documents</h1>
          <p className="page-subtitle">Upload, review, and convert setup sheets into app setups.</p>
        </div>
      </header>
      <SetupDocumentLibraryClient
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

