import type { ReactNode } from "react";
import Link from "next/link";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { BulkImportHubClient } from "@/components/setup/BulkImportHubClient";

export default async function BulkImportPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Bulk setup import</h1>
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
  const batches = await prisma.setupImportBatch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      createdAt: true,
      calibrationProfile: { select: { name: true } },
      _count: { select: { documents: true } },
    },
  });

  const batchRows = batches.map((b) => ({
    ...b,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Bulk setup import</h1>
          <p className="page-subtitle">
            Create a named batch, upload PDFs, then open each file to try calibrations and parse. Confirm accurate parses
            for a future aggregation dataset.
          </p>
        </div>
        <Link href="/setup" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted self-start">
          Back to Setup
        </Link>
      </header>
      <section className="page-body">
        <BulkImportHubClient initialBatches={batchRows} />
      </section>
    </>
  );
}
