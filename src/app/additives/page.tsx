import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { ensureSeedAdditiveTypes } from "@/lib/additives/ensureSeedAdditiveTypes";
import { additiveIdsUsedByOthers } from "@/lib/additives/additiveUsage";
import { compareAdditiveNames } from "@/lib/additives/additiveOrder";
import { AdditiveGaragePanel } from "@/components/additives/AdditiveGaragePanel";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { CATALOG_BACK_PARAM, safeCatalogBackHref } from "@/lib/catalogReturn";

export const revalidate = 30;

export default async function AdditivesPage(props: {
  /**
   * `back=/paddock` is stamped on by the Paddock additive band. Anything else — the Settings
   * row, a shared link, a cold launch — falls back to Settings, where this page is filed.
   */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const resolvedSearch = (await props.searchParams) ?? {};
  const backHref = safeCatalogBackHref(resolvedSearch[CATALOG_BACK_PARAM]);

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href={backHref} />
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

  const user = await requireCurrentUser();
  const isAdmin = isAuthAdminEmail(user.email);
  const count = await prisma.additiveType.count();
  if (count === 0) {
    await ensureSeedAdditiveTypes();
  }
  // Sorted here, not by the database: it puts upper case first, and the panel re-sorts ignoring case.
  const additiveTypeRows = (
    await prisma.additiveType.findMany({
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, modelCode: true, verifiedAt: true, createdByUserId: true },
    })
  ).sort(compareAdditiveNames);
  // Who added each row stays on the server; the panel only learns which ones are this driver's,
  // and which of those another driver already uses (so they're locked, and it says why).
  const additiveTypes = additiveTypeRows.map(({ createdByUserId: _maker, ...t }) => ({
    ...t,
    verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
  }));
  const ownIds = additiveTypeRows.filter((t) => t.createdByUserId === user.id).map((t) => t.id);
  const ownInUseIds = isAdmin ? [] : [...(await additiveIdsUsedByOthers(ownIds, user.id))];

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={backHref} />
          <div>
            <h1 className="page-title">Additives</h1>
            <p className="page-subtitle">Tire additive catalog.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div>
          <AdditiveGaragePanel
            initialAdditiveTypes={additiveTypes}
            isAdmin={isAdmin}
            ownIds={ownIds}
            ownInUseIds={ownInUseIds}
          />
        </div>
      </section>
    </>
  );
}
