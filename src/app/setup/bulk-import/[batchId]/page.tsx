import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { BulkImportBatchClient } from "@/components/setup/BulkImportBatchClient";

export default async function BulkImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Import batch</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  const { batchId } = await params;
  const user = await requireCurrentUser();
  const [batch, cars] = await Promise.all([
    prisma.setupImportBatch.findFirst({
    where: { id: batchId, userId: user.id },
    select: {
      id: true,
      name: true,
      calibrationProfile: { select: { name: true, sourceType: true } },
      _count: { select: { documents: true } },
    },
  }),
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!batch) notFound();

  const sub =
    batch.calibrationProfile != null
      ? `${batch._count.documents} PDF(s) · optional batch default: ${batch.calibrationProfile.name} (${batch.calibrationProfile.sourceType})`
      : `${batch._count.documents} PDF(s) · open a file to choose calibration and parse`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{batch.name || "Import batch"}</h1>
          <p className="page-subtitle">{sub}</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link href="/setup/bulk-import" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            All batches
          </Link>
          <Link href="/setup" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Setup
          </Link>
        </div>
      </header>
      <section className="page-body">
        <BulkImportBatchClient batchId={batch.id} cars={cars} />
      </section>
    </>
  );
}
