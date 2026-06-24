import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { ensureSeedAdditiveTypes } from "@/lib/additives/ensureSeedAdditiveTypes";
import { AdditiveGaragePanel } from "@/components/additives/AdditiveGaragePanel";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

export const revalidate = 30;

export default async function AdditivesPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
            <div>
              <h1 className="page-title">Additives</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage additives.
          </CardPanel>
        </section>
      </>
    );
  }

  await requireCurrentUser();
  const count = await prisma.additiveType.count();
  if (count === 0) {
    await ensureSeedAdditiveTypes();
  }
  const additiveTypes = await prisma.additiveType.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, modelCode: true },
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
          <div>
            <h1 className="page-title">Additives</h1>
            <p className="page-subtitle">Tire additive catalog.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <AdditiveGaragePanel initialAdditiveTypes={additiveTypes} />
        </div>
      </section>
    </>
  );
}
